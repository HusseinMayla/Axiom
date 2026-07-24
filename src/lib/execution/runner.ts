import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { dockerAvailability, runDocker, sanitize } from "@/lib/execution/docker";
import type { AvailableRepository } from "@/lib/github/app";

const WORKSPACE_PATH = "/workspace";
const IMAGE = "node:22-bookworm";
const NPM_CACHE_VOLUME = "axiom-npm-cache";
// The first Docker run may need to download the Node image. This is deliberately
// longer than normal command limits, while all in-container work remains bounded.
const WORKSPACE_START_TIMEOUT_MS = 10 * 60_000;
// GitHub-hosted runners start with an empty workspace. Give ordinary agent
// commands room to complete, and dependency/scaffolding commands extra time
// for a cold package download, while retaining a finite per-step limit.
const DEFAULT_STEP_TIMEOUT_MS = 5 * 60_000;
const DEPENDENCY_STEP_TIMEOUT_MS = 8 * 60_000;
const MAX_DIFF_CHARS = 48_000;
const BLOCKED_PATH_PARTS = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "coverage"]);
export const WORKSPACE_TREE_IGNORES = [
  ".git (repository metadata)",
  "node_modules (installed package contents)",
  "vendor (third-party dependencies)",
  "dist, build, .next, coverage (generated output)",
  ".env*, *.pem, *.key (secrets and credentials)",
];
const BLOCKED_PATH_SPECS = [...BLOCKED_PATH_PARTS].flatMap((part) => [
  ":(exclude)" + part + "/**",
  ":(exclude)**/" + part + "/**",
]);

export type ExecutionSession = {
  containerName: string;
  branchName: string;
  baseSha: string;
};

export type ValidationResult = { command: string; exitCode: number; output: string };
export type DeveloperCommandResult = ValidationResult;

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

function safeRelativePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !parts.some((part) => part === "" || part === "." || part === ".." || BLOCKED_PATH_PARTS.has(part.toLowerCase()))
    && !basename(normalized).toLowerCase().startsWith(".env")
    && !normalized.toLowerCase().endsWith(".pem")
    && !normalized.toLowerCase().endsWith(".key");
}

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function exec(session: ExecutionSession, args: string[], timeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
  const result = await runDocker(["exec", "-w", WORKSPACE_PATH, session.containerName, ...args], timeoutMs);
  return { ...result, output: sanitize((result.stdout + "\n" + result.stderr).trim()) };
}

async function execShell(session: ExecutionSession, script: string, timeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
  return exec(session, ["bash", "-lc", script], timeoutMs);
}

export async function createExecutionSession({
  taskId,
  repository,
  installationToken,
  existingBranchName,
}: {
  taskId: string;
  repository: AvailableRepository;
  installationToken: string;
  existingBranchName?: string | null;
}): Promise<ExecutionSession> {
  const availability = await dockerAvailability();
  if (!availability.available) throw new Error(availability.reason);

  const shortTaskId = taskId.replace(/-/g, "").slice(0, 12);
  const branchName = existingBranchName || "axiom/task-" + shortTaskId;
  const containerName = "axiom-" + safeName(shortTaskId);
  await destroyExecutionSession({ containerName });
  const runResult = await runDocker([
    "run", "-d", "--rm", "--name", containerName,
    "-v", NPM_CACHE_VOLUME + ":/root/.npm",
    "-e", "GITHUB_TOKEN",
    "-e", "CI=true",
    "-e", "DEBIAN_FRONTEND=noninteractive",
    "-e", "npm_config_yes=true",
    "-w", WORKSPACE_PATH,
    IMAGE,
    "sleep", "infinity",
  ], WORKSPACE_START_TIMEOUT_MS, { GITHUB_TOKEN: installationToken });
  if (runResult.exitCode !== 0) throw new Error(sanitize(runResult.stderr || runResult.stdout || "Could not start the Docker workspace."));

  const provisional: ExecutionSession = { containerName, branchName, baseSha: "" };
  try {
    const defaultBranch = shellQuote(repository.defaultBranch);
    const checkout = existingBranchName
      ? "if git ls-remote --exit-code --heads origin " + shellQuote(branchName) + " >/dev/null 2>&1; then git fetch origin " + shellQuote(branchName) + " && git checkout -B " + shellQuote(branchName) + " " + shellQuote("origin/" + branchName) + "; else git checkout " + defaultBranch + " && git checkout -b " + shellQuote(branchName) + "; fi"
      : "if git ls-remote --exit-code --heads origin " + defaultBranch + " >/dev/null 2>&1; then git checkout " + defaultBranch + " && git checkout -b " + shellQuote(branchName) + "; else git checkout --orphan " + defaultBranch + " && git config user.name 'Axiom Worker' && git config user.email 'axiom-worker@local' && git commit --allow-empty -m 'Axiom: Initialize repository' && git push -u origin " + defaultBranch + " && git checkout -b " + shellQuote(branchName) + "; fi";
    const clone = await execShell(provisional, [
      "git clone https://x-access-token:${GITHUB_TOKEN}@github.com/" + repository.owner + "/" + repository.name + ".git .",
      checkout,
      "git config user.name 'Axiom Worker'",
      "git config user.email 'axiom-worker@local'",
    ].join(" && "));
    if (clone.exitCode !== 0) throw new Error(clone.output || "Could not clone the connected repository.");

    const sha = await exec(provisional, ["git", "rev-parse", "HEAD"]);
    if (sha.exitCode !== 0) throw new Error(sha.output || "Could not read the base commit.");
    return { ...provisional, baseSha: sha.stdout.trim() };
  } catch (error) {
    await destroyExecutionSession(provisional);
    throw error;
  }
}

export async function writeTaskFiles(
  session: ExecutionSession,
  edits: Array<{ path: string; content: string }>,
) {
  if (edits.length === 0) return;
  if (edits.length > 20) throw new Error("A task execution may write at most 20 files.");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "axiom-edit-"));
  try {
    for (const [index, edit] of edits.entries()) {
      if (!safeRelativePath(edit.path)) {
        throw new Error("The developer attempted to write to an unsafe workspace path: " + edit.path);
      }
      const temporaryFile = join(temporaryDirectory, String(index));
      await writeFile(temporaryFile, edit.content, "utf8");
      const containerFile = "/tmp/axiom-edit-" + index;
      const copy = await runDocker(["cp", temporaryFile, session.containerName + ":" + containerFile]);
      if (copy.exitCode !== 0) throw new Error(sanitize(copy.stderr || "Could not copy an edit into the Docker workspace."));
      const destination = WORKSPACE_PATH + "/" + edit.path.replace(/\\/g, "/");
      const apply = await execShell(session, "mkdir -p " + shellQuote(posix.dirname(destination)) + " && cat " + shellQuote(containerFile) + " > " + shellQuote(destination));
      if (apply.exitCode !== 0) throw new Error(apply.output || "Could not apply an edit in the Docker workspace.");
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function changedPaths(session: ExecutionSession) {
  const [tracked, untracked] = await Promise.all([
    exec(session, ["git", "diff", "--name-only", "--no-ext-diff"]),
    exec(session, ["git", "ls-files", "--others", "--exclude-standard", "--", ".", ...BLOCKED_PATH_SPECS]),
  ]);
  if (tracked.exitCode !== 0) throw new Error(tracked.output || "Could not inspect changed tracked files.");
  if (untracked.exitCode !== 0) throw new Error(untracked.output || "Could not inspect new task files.");
  return [...new Set((tracked.stdout + "\n" + untracked.stdout).split(/\r?\n/).map((path) => path.trim()).filter(Boolean))].sort();
}

export async function readTaskFiles(session: ExecutionSession, paths: string[]) {
  const validPaths = paths.filter(safeRelativePath).slice(0, 16);
  const fileGroups = await Promise.all(validPaths.map(async (path) => {
    const files: Array<{ path: string; content: string }> = [];
    const fullPath = WORKSPACE_PATH + "/" + path.replace(/\\/g, "/");
    const script = [
      "if [ -f " + shellQuote(fullPath) + " ]; then",
      "  cat " + shellQuote(fullPath) + ";",
      "elif [ -d " + shellQuote(fullPath) + " ]; then",
      "  find " + shellQuote(fullPath) + " -maxdepth 3 -type f ! -path '*/.*' ! -path '*/node_modules/*' | head -n 12 | while read -r f; do",
      "    echo \"===AXIOM_FILE_HEADER: \${f#" + WORKSPACE_PATH + "/}===\";",
      "    cat \"$f\";",
      "  done;",
      "fi",
    ].join("\n");
    const result = await exec(session, ["bash", "-lc", script], 30_000);
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      if (result.stdout.includes("===AXIOM_FILE_HEADER: ")) {
        const blocks = result.stdout.split("===AXIOM_FILE_HEADER: ");
        for (const block of blocks) {
          if (!block.trim()) continue;
          const firstLineEnd = block.indexOf("===");
          if (firstLineEnd !== -1) {
            const relPath = block.slice(0, firstLineEnd).trim();
            const content = block.slice(firstLineEnd + 4).trimStart();
            if (relPath && safeRelativePath(relPath)) {
              files.push({ path: relPath, content: content.slice(0, 20_000) });
            }
          }
        }
      } else {
        files.push({ path, content: result.stdout.slice(0, 20_000) });
      }
    }
    return files;
  }));
  return fileGroups.flat();
}

export async function readWorkspaceTree(session: ExecutionSession) {
  const result = await execShell(session, [
    "find . -maxdepth 3 -mindepth 1",
    "  ! -path './.git/*' ! -path './node_modules/*' ! -path './vendor/*' ! -path './dist/*' ! -path './build/*' ! -path './.next/*' ! -path './coverage/*'",
    "  ! -name '.env*' ! -name '*.pem' ! -name '*.key'",
    "  -print | sed 's#^./##' | sort | head -n 800",
  ].join(" "), 30_000);
  if (result.exitCode !== 0) throw new Error(result.output || "Could not inspect the workspace tree.");
  return sanitize(result.stdout).slice(0, 24_000);
}

export async function readDiff(session: ExecutionSession) {
  const result = await exec(session, ["git", "diff", "--no-ext-diff", "--unified=3"]);
  if (result.exitCode !== 0) throw new Error(result.output || "Could not read the task diff.");
  return sanitize(result.stdout).slice(-MAX_DIFF_CHARS);
}

export async function prepareWorkspaceDependencies(session: ExecutionSession, synchronizeLockfile = false): Promise<ValidationResult | null> {
  const packageManager = await execShell(session, [
    "if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then echo npm;",
    "elif [ -f pnpm-lock.yaml ]; then echo pnpm;",
    "elif [ -f yarn.lock ]; then echo yarn;",
    "elif [ -f package.json ]; then echo npm-install; fi",
  ].join(" "), 30_000);
  if (packageManager.exitCode !== 0) throw new Error(packageManager.output || "Could not identify the workspace package manager.");

  const commandByManager: Record<string, string> = {
    npm: synchronizeLockfile ? "npm install" : "npm ci",
    "npm-install": "npm install",
    pnpm: synchronizeLockfile ? "corepack pnpm install" : "corepack pnpm install --frozen-lockfile",
    yarn: synchronizeLockfile ? "corepack yarn install" : "corepack yarn install --immutable",
  };
  const command = commandByManager[packageManager.stdout.trim()];
  if (!command) return null;

  const result = await execShell(session, command, DEPENDENCY_STEP_TIMEOUT_MS);
  return { command, exitCode: result.exitCode, output: result.output };
}

const NON_INTERACTIVE_FLAGS: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /^npx\s/, flag: "-y" },
  { pattern: /^npm create\s/, flag: "--yes" },
  { pattern: /^npm init\s/, flag: "--yes" },
  { pattern: /^yarn create\s/, flag: "--yes" },
  { pattern: /^apt-get\s/, flag: "-y" },
];

function ensureNonInteractive(command: string): string {
  let result = command;
  for (const { pattern, flag } of NON_INTERACTIVE_FLAGS) {
    if (pattern.test(result) && !result.includes(flag)) {
      result = result.replace(pattern, (match) => match + flag + " ");
    }
  }
  if (/(?:create-vite|create vite|vite@latest)/i.test(result) && !result.includes("--overwrite")) {
    // Inject --overwrite right after the create-vite invocation rather than appending to end of shell chain
    if (/\bnpm\s+create\s+/i.test(result)) {
      result = result.replace(/(npm\s+create\s+(?:--yes\s+)?[\w@/.+-]+)/i, "$1 -- --overwrite");
    } else {
      result = result.replace(/(create-vite|create vite|vite@latest)/i, "$1 --overwrite");
    }
  }
  if (/(?:create-next-app)/i.test(result) && !result.includes("--yes")) {
    result = result.replace(/(create-next-app)/i, "$1 --yes");
  }
  return result;
}

function isLongRunningCommand(command: string): boolean {
  return /^(npm\s+(install|ci|create)|npx\s|yarn\s+(install|add)|pnpm\s+(install|add)|corepack\s)/i.test(command);
}

export async function runDeveloperCommands(session: ExecutionSession, commands: string[]): Promise<DeveloperCommandResult[]> {
  const results: DeveloperCommandResult[] = [];
  for (const command of commands.slice(0, 8)) {
    const sanitized = ensureNonInteractive(command);
    try {
      const timeout = isLongRunningCommand(sanitized) ? DEPENDENCY_STEP_TIMEOUT_MS : DEFAULT_STEP_TIMEOUT_MS;
      const result = await execShell(session, sanitized, timeout);

      // If the command failed and looks like a scaffolding tool, auto-run --help
      if (result.exitCode !== 0) {
        const helpOutput = await tryGetHelp(session, sanitized);
        if (helpOutput) {
          result.output += "\n\n--- AUTO-ATTACHED: help output for this tool ---\n" + helpOutput;
        }
      }

      results.push({ command: sanitized, exitCode: result.exitCode, output: result.output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Try to get --help even after a timeout/crash
      let helpHint = "";
      const helpOutput = await tryGetHelp(session, sanitized).catch(() => null);
      if (helpOutput) {
        helpHint = "\n\n--- AUTO-ATTACHED: help output for this tool ---\n" + helpOutput;
      }

      results.push({
        command: sanitized,
        exitCode: 124,
        output: "Command timed out or crashed: " + message + "\nThe workspace is still intact." + helpHint,
      });
    }
  }
  return results;
}

async function tryGetHelp(session: ExecutionSession, command: string): Promise<string | null> {
  // Extract the base tool name from the command to run --help on
  const scaffoldMatch = command.match(/(?:npx\s+(?:-y\s+)?|npm\s+create\s+(?:--yes\s+)?)([\w@/.+-]+)/i);
  if (!scaffoldMatch) return null;

  let tool = scaffoldMatch[1];
  if (/^vite(?:@.*)?$/i.test(tool)) {
    tool = "create-vite@latest";
  }

  const helpCmd = tool.includes("@") || tool.includes("/")
    ? "npx -y " + tool + " --help"
    : tool + " --help";

  try {
    const result = await execShell(session, helpCmd, 15_000);
    if (result.exitCode === 0 && result.stdout.trim().length > 20) {
      return sanitize(result.stdout).slice(0, 4_000);
    }
  } catch {
    // --help timed out or crashed, ignore
  }
  return null;
}

export async function runValidations(session: ExecutionSession, commands: string[]) {
  const results: ValidationResult[] = [];
  for (const command of commands.slice(0, 8)) {
    try {
      const result = await execShell(session, command, DEFAULT_STEP_TIMEOUT_MS);
      results.push({ command, exitCode: result.exitCode, output: result.output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        command,
        exitCode: 124,
        output: "Validation command execution failed: " + message,
      });
    }
  }
  return results;
}

export async function commitAndPush(session: ExecutionSession, objective: string, paths: string[]) {
  if (paths.length === 0) throw new Error("The task produced no changed files to commit.");
  const add = await exec(session, ["git", "add", "--all", "--", ...paths], 5 * 60_000);
  if (add.exitCode !== 0) throw new Error(add.output || "Could not stage the task change.");
  const commit = await exec(session, ["git", "commit", "-m", "Axiom: " + objective.slice(0, 120)]);
  if (commit.exitCode !== 0) throw new Error(commit.output || "Could not commit the task change.");
  const push = await exec(session, ["git", "push", "-u", "origin", session.branchName]);
  if (push.exitCode !== 0) throw new Error(push.output || "Could not push the task branch.");
  const head = await exec(session, ["git", "rev-parse", "HEAD"]);
  if (head.exitCode !== 0) throw new Error(head.output || "Could not read the task branch commit.");
  return head.stdout.trim();
}

export async function destroyExecutionSession(session: Pick<ExecutionSession, "containerName">) {
  await runDocker(["rm", "-f", session.containerName], 30_000).catch(() => undefined);
}

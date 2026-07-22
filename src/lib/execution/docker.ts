import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type DockerAvailability =
  | { available: true; version: string }
  | { available: false; reason: string; diagnostic: string };

const MAX_OUTPUT_CHARS = 24_000;
const WINDOWS_DOCKER_PATH = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const WINDOWS_DOCKER_BIN = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
const DOCKER_HOST_UNAVAILABLE = "Axiom cannot reach Docker on the execution host. Start Docker Desktop on that host, or contact the host administrator.";

function dockerCommand() {
  if (process.platform === "win32" && existsSync(WINDOWS_DOCKER_PATH)) return WINDOWS_DOCKER_PATH;
  return "docker";
}

function dockerEnvironment(environment?: Record<string, string>): NodeJS.ProcessEnv {
  if (process.platform !== "win32" || !existsSync(WINDOWS_DOCKER_PATH)) return { ...process.env, ...environment };
  const currentPath = process.env.Path ?? process.env.PATH ?? "";
  return {
    ...process.env,
    ...environment,
    Path: WINDOWS_DOCKER_BIN + ";" + currentPath,
  };
}

function run(command: string, args: string[], timeoutMs = 30_000, environment?: Record<string, string>): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env: dockerEnvironment(environment) });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(command + " " + args.slice(0, 5).join(" ") + " timed out after " + Math.round(timeoutMs / 1000) + " seconds."));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + String(chunk)).slice(-MAX_OUTPUT_CHARS); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-MAX_OUTPUT_CHARS); });
    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode: number | null) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

export async function dockerAvailability(): Promise<DockerAvailability> {
  try {
    const result = await run(dockerCommand(), ["info", "--format", "{{.ServerVersion}}"], 8_000);
    if (result.exitCode === 0) return { available: true, version: result.stdout.trim() };
    const diagnostic = sanitize(result.stderr || result.stdout || "docker info exited with code " + result.exitCode + ".");
    console.warn("Axiom could not reach the Docker execution host:", diagnostic);
    return { available: false, reason: DOCKER_HOST_UNAVAILABLE, diagnostic };
  } catch (error) {
    const diagnostic = sanitize(error instanceof Error ? error.message : String(error));
    console.warn("Axiom could not invoke Docker on the execution host:", diagnostic);
    return { available: false, reason: DOCKER_HOST_UNAVAILABLE, diagnostic };
  }
}

export async function runDocker(args: string[], timeoutMs = 120_000, environment?: Record<string, string>) {
  return run(dockerCommand(), args, timeoutMs, environment);
}

export function sanitize(value: string) {
  return value
    .replace(/https:\/\/x-access-token:[^@\s]+@github\.com/gi, "https://x-access-token:[redacted]@github.com")
    .replace(/ghs_[A-Za-z0-9_]+/g, "[redacted]")
    .slice(-MAX_OUTPUT_CHARS);
}

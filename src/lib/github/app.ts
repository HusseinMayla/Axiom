import { createPrivateKey, sign } from "node:crypto";
import { getGithubAppEnv } from "@/lib/env";

const API_URL = "https://api.github.com";
const API_VERSION = "2026-03-10";
const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "rb", "php", "cs", "swift", "vue", "svelte"]);
const BLOCKED_PATH_SEGMENTS = new Set(["node_modules", "vendor", "dist", "build", ".next", "coverage", ".git"]);
const BLOCKED_FILENAMES = new Set([".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"]);

type GithubInstallation = { id: number };
type GithubRepository = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  owner: { login: string };
};
type GithubTreeEntry = { path: string; type: "blob" | "tree" | "commit"; size?: number };
type GithubTreeResponse = { tree: GithubTreeEntry[]; truncated: boolean };
type GithubContentsResponse = { content?: string; encoding?: string; size?: number };

class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super("GitHub request failed (" + status + ") for " + path + ".");
  }
}

export type AvailableRepository = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  installationId: number;
};

export type RepositoryScan = {
  isEmpty: boolean;
  tree: string[];
  truncated: boolean;
  sourceFileCount: number;
  languageHints: string[];
  inspectedFiles: Array<{ path: string; content: string }>;
};

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function createAppJwt() {
  const { appId, privateKey } = getGithubAppEnv();
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const unsigned = encodedHeader + "." + encodedPayload;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey));

  return unsigned + "." + base64Url(signature);
}

async function githubFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GithubApiError(response.status, path);
  }

  return response.json() as Promise<T>;
}

async function getInstallationToken(installationId: number, repositoryId?: number) {
  const jwt = createAppJwt();
  const body = repositoryId ? JSON.stringify({ repository_ids: [repositoryId] }) : undefined;
  const response = await fetch(API_URL + "/app/installations/" + installationId + "/access_tokens", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + jwt,
      "X-GitHub-Api-Version": API_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("GitHub could not create an installation token (" + response.status + ").");
  }

  const payload = await response.json() as { token: string };
  return payload.token;
}

export async function listAvailableRepositories(): Promise<AvailableRepository[]> {
  const jwt = createAppJwt();
  const installations = await githubFetch<GithubInstallation[]>("/app/installations?per_page=100", jwt);
  const repositories: AvailableRepository[] = [];

  for (const installation of installations) {
    const installationToken = await getInstallationToken(installation.id);
    const payload = await githubFetch<{ repositories: GithubRepository[] }>("/installation/repositories?per_page=100", installationToken);

    for (const repository of payload.repositories) {
      repositories.push({
        id: repository.id,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        htmlUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        private: repository.private,
        installationId: installation.id,
      });
    }
  }

  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function isSafePath(path: string) {
  const parts = path.split("/");
  const filename = parts.at(-1)?.toLowerCase() ?? "";

  return !parts.some((part) => BLOCKED_PATH_SEGMENTS.has(part.toLowerCase()))
    && !BLOCKED_FILENAMES.has(filename)
    && !filename.endsWith(".pem")
    && !filename.endsWith(".key")
    && !filename.includes("secret");
}

function extension(path: string) {
  const filename = path.split("/").at(-1) ?? "";
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index + 1).toLowerCase();
}

function pickInitialFiles(paths: string[]) {
  const preferred = [
    "README.md",
    "README",
    "AGENTS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    "src/app/page.tsx",
    "src/main.ts",
    "src/index.ts",
    "src/index.tsx",
    "app/page.tsx",
  ];

  const lowerPaths = paths.map((path) => ({ path, lower: path.toLowerCase() }));
  const selected: string[] = [];

  for (const candidate of preferred) {
    const match = lowerPaths.find(({ lower }) => lower === candidate.toLowerCase());
    if (match && isSafePath(match.path)) {
      selected.push(match.path);
    }
  }

  for (const { path } of lowerPaths) {
    if (selected.length >= 8) break;
    if (isSafePath(path) && SOURCE_EXTENSIONS.has(extension(path))) {
      selected.push(path);
    }
  }

  return [...new Set(selected)];
}

async function readRepositoryFile(repository: AvailableRepository, path: string, token: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const payload = await githubFetch<GithubContentsResponse>(
    "/repos/" + repository.owner + "/" + repository.name + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(repository.defaultBranch),
    token,
  );

  if (payload.encoding !== "base64" || !payload.content) {
    return "";
  }

  const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  return content.slice(0, 15000);
}

export async function scanRepository(repository: AvailableRepository): Promise<RepositoryScan> {
  const token = await getInstallationToken(repository.installationId, repository.id);
  let tree: GithubTreeResponse;

  try {
    tree = await githubFetch<GithubTreeResponse>(
      "/repos/" + repository.owner + "/" + repository.name + "/git/trees/" + encodeURIComponent(repository.defaultBranch) + "?recursive=1",
      token,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 409) {
      return {
        isEmpty: true,
        tree: [],
        truncated: false,
        sourceFileCount: 0,
        languageHints: [],
        inspectedFiles: [],
      };
    }

    throw error;
  }

  const files = tree.tree
    .filter((entry) => entry.type === "blob" && isSafePath(entry.path))
    .map((entry) => entry.path)
    .sort();

  const sourceFiles = files.filter((path) => SOURCE_EXTENSIONS.has(extension(path)));
  const initialFiles = pickInitialFiles(files);
  const inspectedFiles = await Promise.all(initialFiles.map(async (path) => ({
    path,
    content: await readRepositoryFile(repository, path, token),
  })));

  return {
    isEmpty: files.length === 0,
    tree: files.slice(0, 750),
    truncated: tree.truncated,
    sourceFileCount: sourceFiles.length,
    languageHints: [...new Set(sourceFiles.map(extension))].sort(),
    inspectedFiles: inspectedFiles.filter((file) => file.content.length > 0),
  };
}

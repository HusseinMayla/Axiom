"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Repository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

type RepositoryState = "empty" | "connected" | "scanning" | "ready";
type ScanResult = "empty" | "ready_for_context";
type FileTreeNode = {
  name: string;
  path: string;
  children: FileTreeNode[];
  size?: number;
};
type InspectedFile = { path: string; charCount: number };

export function RepositoryConnectionPanel({
  projectId,
  repositoryState,
  repositoryUrl,
  repositoryName,
  repositoryTree,
  fileSizes,
  inspectedFiles,
  languageHints,
  fastModel = "gemini-3.1-flash-lite",
  smartModel = "gemini-3.5-flash",
  contextModel,
}: {
  projectId: string;
  repositoryState: RepositoryState;
  repositoryUrl: string | null;
  repositoryName: string | null;
  repositoryTree: string[];
  fileSizes: Record<string, number>;
  inspectedFiles: InspectedFile[];
  languageHints: string[];
  fastModel?: string;
  smartModel?: string;
  contextModel?: string;
}) {
  const activeSmartModel = contextModel || smartModel;
  const router = useRouter();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [installationUrl, setInstallationUrl] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "connecting" | "scanning" | "generating" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);

  async function loadRepositories() {
    setState("loading");
    setMessage("");
    const response = await fetch("/api/github/repositories", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not load GitHub repositories.");
      return;
    }

    setRepositories(payload.repositories ?? []);
    setInstallationUrl(payload.installationUrl ?? "");
    setState("idle");
    if (!payload.repositories?.length) {
      setMessage("Install the Axiom GitHub App on a repository, then reload this list.");
    }
  }

  async function scanConnectedRepository() {
    setState("scanning");
    setMessage("Reading the repository structure and high-signal files without using AI quota.");
    const scanResponse = await fetch("/api/projects/" + projectId + "/scan", { method: "POST" });
    const scan = await scanResponse.json();

    if (!scanResponse.ok) {
      setState("error");
      setMessage(scan.error ?? "Could not scan the repository.");
      return;
    }

    if (scan.type === "empty") {
      setState("idle");
      setLastScanResult("empty");
      setMessage("No meaningful source files were found. Continue with the client-discovery wizard below.");
      router.refresh();
      return;
    }

    setState("idle");
    setLastScanResult("ready_for_context");
    setMessage("Repository scan saved. Context generation uses one Gemini request, with one bounded follow-up only if the model requests more files.");
    router.refresh();
  }

  async function generateContextFromScan() {
    setState("generating");
    setMessage("Grounding the project context in the saved repository scan. Axiom allows one extra file-ingestion turn only when needed…");
    const contextResponse = await fetch("/api/projects/" + projectId + "/synthesize", { method: "POST" });
    const context = await contextResponse.json();

    if (!contextResponse.ok) {
      setState("error");
      setMessage(context.error ?? "The repository was scanned, but context generation could not start.");
      router.refresh();
      return;
    }

    setState("idle");
    setLastScanResult(null);
    setMessage(context.type === "clarifications"
      ? "The scan is complete. Axiom needs a few product decisions before it drafts context."
      : "The scan is complete and an AI context draft is ready for review.");
    router.refresh();
  }

  async function connectAndScan() {
    const repositoryId = Number(selectedId);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      setState("error");
      setMessage("Choose a repository first.");
      return;
    }

    setState("connecting");
    setMessage("");
    const connectionResponse = await fetch("/api/projects/" + projectId + "/repository", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryId }),
    });
    const connection = await connectionResponse.json();

    if (!connectionResponse.ok) {
      setState("error");
      setMessage(connection.error ?? "Could not connect this repository.");
      return;
    }

    await scanConnectedRepository();
  }

  const isConnected = Boolean(repositoryUrl);
  const isBusy = state === "loading" || state === "connecting" || state === "scanning" || state === "generating";

  return (
    <section className="repository-panel">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">REPOSITORY FIRST</p>
          <h2>{isConnected ? "Codebase connection" : "Connect the codebase"}</h2>
          <p className="panel-copy">Axiom uses its GitHub App to read the repository, create an auditable map, then draft context from code and the product brief.</p>
        </div>
        {isConnected && repositoryUrl && (
          <a className="button secondary" href={repositoryUrl} target="_blank" rel="noreferrer">Open repository</a>
        )}
      </div>

      {isConnected ? (
        <div className="repository-connected">
          <p><strong>{repositoryName ?? "Connected repository"}</strong> <span>· {repositoryState}</span></p>
          <button className="button" disabled={isBusy} onClick={scanConnectedRepository}>
            {state === "scanning" ? "Scanning…" : repositoryState === "ready" ? "Re-scan codebase" : "Scan codebase"}
          </button>
          {(lastScanResult === "ready_for_context" || repositoryState === "ready") && (
            <button className="button secondary" disabled={isBusy} onClick={generateContextFromScan}>
              {state === "generating" ? "Generating…" : "Generate context"}
            </button>
          )}
        </div>
      ) : (
        <div className="repository-actions">
          {repositories.length === 0 ? (
            <button className="button" disabled={isBusy} onClick={loadRepositories}>
              {state === "loading" ? "Loading…" : "Choose GitHub repository"}
            </button>
          ) : (
            <>
              <select aria-label="GitHub repository" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">Select a repository</option>
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>{repository.fullName}{repository.private ? " (private)" : ""}</option>
                ))}
              </select>
              <button className="button" disabled={isBusy || !selectedId} onClick={connectAndScan}>
                {state === "connecting" ? "Connecting…" : "Connect and scan"}
              </button>
              <button className="button secondary" disabled={isBusy} onClick={loadRepositories}>Reload</button>
            </>
          )}
          {installationUrl && <a className="back-link" href={installationUrl} target="_blank" rel="noreferrer">Install Axiom on another repository ↗</a>}
        </div>
      )}

      {message && <p className={state === "error" ? "form-error" : "form-note"}>{message}</p>}
      <SimpleDataFlow
        repositoryTree={repositoryTree}
        fileSizes={fileSizes}
        inspectedFiles={inspectedFiles}
        languageHints={languageHints}
        fastModel={fastModel}
        smartModel={activeSmartModel}
      />
      <p className="notice">If this is a new repository, use the client-discovery wizard below instead. You can connect code later to enrich the approved context.</p>
    </section>
  );
}

function SimpleDataFlow({
  repositoryTree,
  fileSizes,
  inspectedFiles,
  languageHints,
  fastModel,
  smartModel,
}: {
  repositoryTree: string[];
  fileSizes: Record<string, number>;
  inspectedFiles: InspectedFile[];
  languageHints: string[];
  fastModel: string;
  smartModel: string;
}) {
  if (repositoryTree.length === 0) return null;

  return (
    <div className="simple-flow-container">
      <div className="simple-flow-box">
        <h4>File Structure</h4>
        {languageHints.length > 0 && <p className="flow-hint">Detected: {languageHints.join(", ")}</p>}
        <RepositoryFileTree paths={repositoryTree} fileSizes={fileSizes} />
      </div>
      <div className="simple-flow-box">
        <h4>Smart Model ({smartModel})</h4>
        <h5>Ingesting right now:</h5>
        <ul>
          <li>Project context (Discovery Answers Brief)</li>
          <li>Folder structure ({repositoryTree.length} paths)</li>
          <li>File contents ({inspectedFiles.length} files)</li>
          {inspectedFiles.map((file) => <li className="ingested-file" key={file.path}><code>{file.path}</code> <span>{formatCharacters(file.charCount)}</span></li>)}
          <li>May request up to 5 additional safe files once</li>
        </ul>
      </div>
      <div className="simple-flow-box">
        <h4>Fast Model ({fastModel})</h4>
        <h5>Initial evidence selector:</h5>
        <ul>
          <li>Receives {repositoryTree.length} paths and their byte sizes</li>
          <li>Selects up to 8 files for Axiom to read</li>
        </ul>
      </div>
    </div>
  );
}

function RepositoryFileTree({ paths, fileSizes }: { paths: string[]; fileSizes: Record<string, number> }) {
  if (paths.length === 0) {
    return null;
  }

  const root = buildFileTree(paths.slice(0, 160), fileSizes);
  const remainingCount = Math.max(0, paths.length - 160);

  return (
    <div className="repository-tree">
      <div className="repository-tree-heading">
        <span>{paths.length} files scanned</span>
      </div>
      <ul>
        {root.map((node) => <FileTreeItem key={node.path} node={node} depth={0} />)}
      </ul>
      {remainingCount > 0 && <p>Showing first 160 files. {remainingCount} more are stored in the scan.</p>}
    </div>
  );
}

function FileTreeItem({ node, depth }: { node: FileTreeNode; depth: number }) {
  const isFolder = node.children.length > 0;

  return (
    <li>
      <div className="repository-tree-row" style={{ paddingLeft: depth * 14 }}>
        <span aria-hidden="true">{isFolder ? "▸" : "·"}</span>
        <code>{node.name}</code>
        {!isFolder && node.size !== undefined && <small>{formatBytes(node.size)}</small>}
      </div>
      {isFolder && (
        <ul>
          {node.children.map((child) => <FileTreeItem key={child.path} node={child} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

function buildFileTree(paths: string[], fileSizes: Record<string, number>) {
  const root: FileTreeNode[] = [];

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let siblings = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? currentPath + "/" + part : part;
      let node = siblings.find((candidate) => candidate.name === part);

      if (!node) {
        node = { name: part, path: currentPath, children: [], size: fileSizes[currentPath] };
        siblings.push(node);
        siblings.sort((a, b) => {
          const folderDelta = Number(b.children.length > 0) - Number(a.children.length > 0);
          return folderDelta || a.name.localeCompare(b.name);
        });
      }

      siblings = node.children;
    }
  }

  return root;
}

function formatBytes(size: number) {
  if (size < 1024) return size + " B";
  return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + " KB";
}

function formatCharacters(count: number) {
  return new Intl.NumberFormat("en").format(count) + " chars";
}

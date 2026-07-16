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
};

export function RepositoryConnectionPanel({
  projectId,
  repositoryState,
  repositoryUrl,
  repositoryName,
  repositoryTree,
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
  inspectedFiles: string[];
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
    setMessage("Repository scan saved. Generate context when you are ready to spend one Gemini request.");
    router.refresh();
  }

  async function generateContextFromScan() {
    setState("generating");
    setMessage("Grounding the project context in the saved repository scan…");
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
      <ScanDataFlow
        repositoryTree={repositoryTree}
        treeCount={repositoryTree.length}
        inspectedFiles={inspectedFiles}
        languageHints={languageHints}
        fastModel={fastModel}
        smartModel={activeSmartModel}
      />
      <RepositoryFileTree paths={repositoryTree} />
      <p className="notice">If this is a new repository, use the client-discovery wizard below instead. You can connect code later to enrich the approved context.</p>
    </section>
  );
}

function ScanDataFlow({
  repositoryTree,
  treeCount,
  inspectedFiles,
  languageHints,
  fastModel,
  smartModel,
}: {
  repositoryTree: string[];
  treeCount: number;
  inspectedFiles: string[];
  languageHints: string[];
  fastModel: string;
  smartModel: string;
}) {
  const [activeTab, setActiveTab] = useState<"pipeline" | "fileRouting">("pipeline");

  if (treeCount === 0) {
    return null;
  }

  const uninspectedCount = Math.max(0, treeCount - inspectedFiles.length);

  return (
    <section className="scan-flow-pipeline" aria-label="Multi-tier model context & data flow">
      <div className="scan-flow-header">
        <div>
          <span className="eyebrow">ARCHITECTURE DATA PIPELINE</span>
          <h3>Ingestion & Tiered Model Routing Flow</h3>
        </div>
        <div className="scan-flow-tabs">
          <button
            className={`tab-btn ${activeTab === "pipeline" ? "active" : ""}`}
            onClick={() => setActiveTab("pipeline")}
          >
            Data Flow Pipeline
          </button>
          <button
            className={`tab-btn ${activeTab === "fileRouting" ? "active" : ""}`}
            onClick={() => setActiveTab("fileRouting")}
          >
            File Ingestion Matrix ({inspectedFiles.length} Ingested)
          </button>
        </div>
      </div>

      {activeTab === "pipeline" ? (
        <div className="pipeline-grid">
          {/* Stage 1: Repository Scanner & File Breakdown */}
          <div className="pipeline-stage stage-source">
            <div className="stage-badge">1 · REPO SCANNER</div>
            <h4>GitHub Codebase</h4>
            <div className="stage-metric">
              <span className="metric-number">{treeCount}</span>
              <span className="metric-label">Files Mapped</span>
            </div>

            <div className="flow-split-box">
              <div className="split-item content-read">
                <span className="split-dot primary" />
                <div>
                  <strong>{inspectedFiles.length} Core Files</strong>
                  <p>Full text content ingested</p>
                </div>
              </div>

              <div className="split-item path-mapped">
                <span className="split-dot secondary" />
                <div>
                  <strong>{uninspectedCount} Code Paths</strong>
                  <p>Tree paths & signatures only</p>
                </div>
              </div>
            </div>

            <div className="stage-footer">
              Languages: {languageHints.length ? languageHints.join(", ") : "Detected automatically"}
            </div>
          </div>

          {/* Connector Arrow 1 */}
          <div className="pipeline-connector">
            <div className="pulse-line" />
            <span className="flow-arrow-icon">➔</span>
          </div>

          {/* Stage 2: Fast Model (gemini-3.1-flash-lite) */}
          <div className="pipeline-stage stage-fast">
            <div className="stage-badge fast-badge">FAST MODEL TIER</div>
            <div className="model-name-tag">{fastModel}</div>
            <p className="stage-desc">Structure & Schema Normalization</p>

            <ul className="stage-tasks">
              <li>📄 Ingests {uninspectedCount} file path strings</li>
              <li>⚡ Normalizes directory taxonomy</li>
              <li>🔍 Extracts language & signature hints</li>
              <li>🔄 Performs routine validation steps</li>
            </ul>

            <div className="inter-model-transfer">
              <span className="transfer-label">Transfers Metadata</span>
              <span className="transfer-arrow">⬇ Streamed to Synthesis</span>
            </div>
          </div>

          {/* Connector Arrow 2 */}
          <div className="pipeline-connector">
            <div className="pulse-line smart-pulse" />
            <span className="flow-arrow-icon">➔</span>
          </div>

          {/* Stage 3: Smart Model (gemini-3.5-flash) */}
          <div className="pipeline-stage stage-smart">
            <div className="stage-badge smart-badge">SMART MODEL TIER</div>
            <div className="model-name-tag smart">{smartModel}</div>
            <p className="stage-desc">Architectural Reasoning & Synthesis</p>

            <div className="smart-inputs">
              <div className="input-pill">📂 {inspectedFiles.length} Selected File Contents</div>
              <div className="input-pill">📝 Discovery Answers Brief</div>
              <div className="input-pill transfer-pill">⚡ Fast Model Taxonomy Metadata</div>
            </div>

            <div className="stage-output">
              <span className="output-badge">OUTPUT</span>
              <strong>Axiom Draft Context Nodes</strong>
              <p>Creates system summary, constraints & feature proposals</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="file-routing-matrix">
          <div className="routing-column">
            <div className="routing-header smart-bg">
              <h4>Ingested in Smart Model ({smartModel})</h4>
              <p>Receives full file text along with client discovery brief for synthesis</p>
            </div>
            {inspectedFiles.length > 0 ? (
              <ul className="file-matrix-list">
                {inspectedFiles.map((path) => (
                  <li key={path} className="file-matrix-item smart-item">
                    <code>{path}</code>
                    <span className="ingest-type">Full File Content</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-files">No high-signal files selected yet.</p>
            )}
          </div>

          <div className="routing-column">
            <div className="routing-header fast-bg">
              <h4>Ingested in Fast Model / Scanner ({fastModel})</h4>
              <p>Receives structural path strings for rapid taxonomy and schema normalization</p>
            </div>
            <ul className="file-matrix-list">
              <li className="file-matrix-item fast-item">
                <code>Entire repository tree ({treeCount} paths)</code>
                <span className="ingest-type">Path Structure & Hints</span>
              </li>
              {repositoryTree.filter((p) => !inspectedFiles.includes(p)).slice(0, 8).map((path) => (
                <li key={path} className="file-matrix-item fast-item muted">
                  <code>{path}</code>
                  <span className="ingest-type">Path Only</span>
                </li>
              ))}
              {treeCount - inspectedFiles.length > 8 && (
                <li className="file-matrix-more">
                  + {treeCount - inspectedFiles.length - 8} additional files mapped as structural paths
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      <div className="scan-flow-footer">
        <span className="info-icon">ℹ</span>
        <span>
          <strong>Data Flow Logic:</strong> Raw source code contents from high-signal files are sent strictly to <strong>{smartModel}</strong> during context synthesis. The file layout structure and routine extractions leverage <strong>{fastModel}</strong> to preserve quota while ensuring grounded synthesis.
        </span>
      </div>
    </section>
  );
}

function RepositoryFileTree({ paths }: { paths: string[] }) {
  if (paths.length === 0) {
    return null;
  }

  const root = buildFileTree(paths.slice(0, 160));
  const remainingCount = Math.max(0, paths.length - 160);

  return (
    <div className="repository-tree">
      <div className="repository-tree-heading">
        <h3>File structure</h3>
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
        <span aria-hidden="true" style={{ marginRight: '0.35rem' }}>
          {isFolder ? <FolderIcon /> : <FileIcon />}
        </span>
        <code>{node.name}</code>
      </div>
      {isFolder && (
        <ul>
          {node.children.map((child) => <FileTreeItem key={child.path} node={child} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255, 255, 255, 0.35)' }}>
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
      <polyline points="13 2 13 9 20 9"></polyline>
    </svg>
  );
}

function buildFileTree(paths: string[]) {
  const root: FileTreeNode[] = [];

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let siblings = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? currentPath + "/" + part : part;
      let node = siblings.find((candidate) => candidate.name === part);

      if (!node) {
        node = { name: part, path: currentPath, children: [] };
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

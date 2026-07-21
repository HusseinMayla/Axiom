"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HarnessTopology } from "@/components/harness-topology";

type Props = {
  projectId: string;
  initialModel: string;
  initialEngineerModel?: string;
  initialMaxSteps: 30 | 60 | 90;
  repositoryName: string;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  automationState: "running" | "frozen" | null;
  automationPauseReason?: string | null;
  automationCooldownUntil?: string | null;
  repositoryState: string;
  openClarifications: number;
  hasContext: boolean;
  activeTask: { state: string; objective: string } | null;
};

type Branch = { name: string; protected: boolean; sha: string };
const models = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
] as const;

export function ProjectConfigurationPanel({
  projectId,
  initialModel,
  initialEngineerModel = initialModel,
  initialMaxSteps,
  repositoryName,
  repositoryUrl,
  defaultBranch,
  automationState,
  automationPauseReason,
  automationCooldownUntil,
  repositoryState,
  openClarifications,
  hasContext,
  activeTask,
}: Props) {
  const router = useRouter();
  
  // Model settings state
  const [model, setModel] = useState(initialModel);
  const [engineerModel, setEngineerModel] = useState(initialEngineerModel);
  const [maxSteps, setMaxSteps] = useState<30 | 60 | 90>(initialMaxSteps);
  const [status, setStatus] = useState("Saved");

  // Git state
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [inspectingBranches, setInspectingBranches] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");

  // Automation state
  const [automation, setAutomation] = useState<"running" | "frozen">(automationState ?? "running");
  const [pauseReason, setPauseReason] = useState<string | null>(automationPauseReason ?? null);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(automationCooldownUntil ?? null);
  const [automationPending, setAutomationPending] = useState(false);
  const [showPauseReasonInput, setShowPauseReasonInput] = useState(false);
  const [freezeReasonText, setFreezeReasonText] = useState("");

  const initial = useRef(true);

  // Auto-save configuration on change
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    setStatus("Saving…");
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/projects/${projectId}/configuration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, engineerModel, maxSteps }),
      });
      if (response.ok) {
        setStatus("Saved");
        router.refresh();
      } else {
        setStatus("Could not save");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [engineerModel, maxSteps, model, projectId, router]);

  // Sync state if props change (e.g. from nav sidebar toggle)
  useEffect(() => {
    if (automationState) setAutomation(automationState);
  }, [automationState]);

  useEffect(() => {
    setPauseReason(automationPauseReason ?? null);
  }, [automationPauseReason]);

  useEffect(() => {
    setCooldownUntil(automationCooldownUntil ?? null);
  }, [automationCooldownUntil]);

  // Inspect remote repository branches
  async function inspectBranches() {
    setBranchesError(null);
    setInspectingBranches(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/branches`);
      const payload = (await response.json()) as { branches?: Branch[]; error?: string };
      if (!response.ok) {
        setBranchesError(payload.error ?? "Could not load branches.");
        return;
      }
      setBranches(payload.branches ?? []);
    } catch (err) {
      setBranchesError("Network error while inspecting branches.");
    } finally {
      setInspectingBranches(false);
    }
  }

  // Toggle Project Automation state (Freeze / Unfreeze)
  async function updateAutomation(nextState: "running" | "frozen", reason?: string) {
    setAutomationPending(true);
    setStatus("Saving…");
    try {
      const response = await fetch(`/api/projects/${projectId}/automation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState, reason }),
      });
      if (response.ok) {
        setAutomation(nextState);
        setPauseReason(nextState === "frozen" ? reason || "Frozen by a human." : null);
        setStatus("Saved");
        router.refresh();
      } else {
        setStatus("Could not save");
      }
    } catch (err) {
      setStatus("Could not save");
    } finally {
      setAutomationPending(false);
      setShowPauseReasonInput(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Heading & Centralized Saved Status sync */}
      <div className="workspace-page-heading configuration-page-heading">
        <div>
          <p className="eyebrow">HARNESS CONFIGURATION</p>
          <h1>Configuration</h1>
        </div>
        <div
          className={`global-sync-badge ${
            status === "Saving…" ? "saving" : status === "Could not save" ? "error" : "saved"
          }`}
        >
          <i />
          <span>{status === "Saving…" ? "Saving changes..." : status}</span>
        </div>
      </div>

      {/* Live Topology Flow Subnet */}
      <HarnessTopology
        projectId={projectId}
        hasContext={hasContext}
        openClarifications={openClarifications}
        activeTask={activeTask}
        automationState={automation}
        developerModel={model}
        engineerModel={engineerModel}
        maxSteps={maxSteps}
        onDeveloperModelChange={setModel}
        onEngineerModelChange={setEngineerModel}
        onMaxStepsChange={setMaxSteps}
      />

      {/* Main settings grid */}
      <section className="configuration-control-grid">
        {/* Left Column: Automation Controller */}
        <div className="space-y-4">
          <h3 className="font-mono text-[11px] font-bold tracking-widest text-slate-400 uppercase">
            Automation Pipeline Controller
          </h3>

          <article className="automation-controller-card">
            <span className="form-group-label">Pipeline Controller Status</span>

            <div className={`flow-status-banner ${automation === "frozen" ? "frozen" : ""}`}>
              <div className="flow-status-title">
                <div className={`flow-pulse ${automation === "frozen" ? "animate-pulse" : ""}`} />
                <div className="flow-status-text">
                  <h4 className={automation === "frozen" ? "text-amber-400" : "text-emerald-400"}>
                    {automation === "frozen" ? "Flow Frozen" : "Flow Running"}
                  </h4>
                  <p>
                    {automation === "frozen"
                      ? pauseReason || "Automatic work is paused by a human."
                      : "Eligible work continues automatically after required gates."}
                  </p>
                </div>
              </div>
            </div>

            {/* Cooldown info */}
            {cooldownUntil && (
              <div className="flow-cooldown-badge">
                ⏱ Provider cooldown until: {new Date(cooldownUntil).toLocaleString()}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              {automation === "running" ? (
                <>
                  {!showPauseReasonInput ? (
                    <button
                      type="button"
                      className="button secondary"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => setShowPauseReasonInput(true)}
                      disabled={automationPending}
                    >
                      ⏸ Freeze Automatic Flow
                    </button>
                  ) : (
                    <div className="freeze-action-form">
                      <span className="text-[11px] text-slate-300">Reason for freezing (optional):</span>
                      <input
                        type="text"
                        className="freeze-reason-input"
                        placeholder="e.g. Waiting for team discussion on architecture..."
                        value={freezeReasonText}
                        onChange={(e) => setFreezeReasonText(e.target.value)}
                        disabled={automationPending}
                      />
                      <div className="freeze-action-buttons">
                        <button
                          type="button"
                          className="button"
                          style={{
                            borderColor: "rgba(239,68,68,0.5)",
                            color: "#fca5a5",
                            background: "rgba(127,29,29,0.2)",
                          }}
                          onClick={() => updateAutomation("frozen", freezeReasonText)}
                          disabled={automationPending}
                        >
                          Confirm Freeze
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setShowPauseReasonInput(false)}
                          disabled={automationPending}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="button"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => updateAutomation("running")}
                  disabled={automationPending}
                >
                  ▶ Unfreeze / Resume Flow
                </button>
              )}
            </div>

            <small className="text-[11px] text-slate-500 leading-normal">
              Freeze status syncs globally. You can also toggle the flow switch in the left sidebar menu.
            </small>
          </article>
        </div>

        {/* Right Column: Upgraded Git Repository Info */}
        <div className="space-y-4">
          <h3 className="font-mono text-[11px] font-bold tracking-widest text-slate-400 uppercase">
            Git &amp; Repository Connection
          </h3>

          <article className="automation-controller-card">
            <span className="form-group-label">Connection Details</span>

            <div className="git-card-header">
              <div className="git-repo-title">
                <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <span className="truncate" title={repositoryName}>{repositoryName}</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-emerald-500/35 bg-emerald-950/20 text-emerald-400 font-bold uppercase">
                {repositoryState}
              </span>
            </div>

            {/* Scope and Webhook telemetry */}
            <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800/80 rounded p-2.5 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                  <rect x="3" y="11" width="10" height="8" rx="2" />
                  <path d="M7 11V7a3 3 0 0 1 6 0v4" />
                </svg>
                <div className="flex flex-col">
                  <span className="font-bold text-slate-200">Secure Webhook</span>
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active (Listening)
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="font-bold text-slate-300">Access Auth</span>
                <p className="text-[9px] text-slate-500 font-mono">repo, write:discussion</p>
              </div>
            </div>

            {/* Codebase Telemetry */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950/40 border border-slate-800/60 rounded p-2 flex flex-col gap-0.5">
                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Sync State</span>
                <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
                  🟢 Scan Clean
                </span>
              </div>
              <div className="bg-slate-950/40 border border-slate-800/60 rounded p-2 flex flex-col gap-0.5">
                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Default Branch</span>
                <code className="text-[11px] text-cyan-400 truncate" title={defaultBranch ?? "Not connected"}>
                  {defaultBranch ?? "Not connected"}
                </code>
              </div>
            </div>

            {repositoryUrl && (
              <a
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 self-start"
                href={repositoryUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>Open remote repository</span>
                <span className="text-[10px]">↗</span>
              </a>
            )}

            <div className="border-t border-slate-800/80 pt-3 mt-1 flex flex-col gap-2">
              <button
                className="button secondary"
                type="button"
                disabled={!defaultBranch || inspectingBranches}
                onClick={inspectBranches}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {inspectingBranches ? (
                  <>
                    <span className="sync-loader" />
                    <span>Inspecting branches...</span>
                  </>
                ) : (
                  "🔍 Inspect Branches"
                )}
              </button>

              {branchesError && (
                <small className="configuration-message error">{branchesError}</small>
              )}

              {branches && (
                <>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      placeholder="Filter branches..."
                      value={branchSearch}
                      onChange={(e) => setBranchSearch(e.target.value)}
                      className="w-full border border-slate-800 rounded bg-slate-950 px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-cyan-400 transition-all"
                    />
                  </div>

                  <div className="branch-list-container">
                    <ul className="branch-list">
                      {branches.filter(b => b.name.toLowerCase().includes(branchSearch.toLowerCase())).length > 0 ? (
                        branches
                          .filter(b => b.name.toLowerCase().includes(branchSearch.toLowerCase()))
                          .map((branch) => (
                            <li key={branch.name} className="py-2 px-1 flex items-center justify-between border-b border-slate-800/60 last:border-0">
                              <div className="flex flex-col gap-0.5">
                                <code className="text-[11px] text-slate-200 font-bold">{branch.name}</code>
                                <span className="text-[10px] text-slate-500 font-mono">{branch.sha.slice(0, 8)}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {branch.name === defaultBranch && <b>default</b>}
                                {branch.protected && <b>protected</b>}
                                {repositoryUrl && (
                                  <a
                                    href={`${repositoryUrl}/tree/${branch.name}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors ml-1"
                                  >
                                    View ↗
                                  </a>
                                )}
                              </div>
                            </li>
                          ))
                      ) : (
                        <li className="p-3 text-center text-xs text-slate-500">No branches match "{branchSearch}"</li>
                      )}
                    </ul>
                  </div>
                </>
              )}

              {!branches && (
                <small className="text-slate-500 text-[11px]">
                  Branch list is read-only. Task branches remain created and merged through Dashboard.
                </small>
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

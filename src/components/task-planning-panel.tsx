"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAgentStepSummary } from "@/components/agent-status-widget";

type Task = {
  id: string;
  category: "general" | "feature";
  priority: number;
  featureName: string;
  state: string;
  objective: string;
  humanSummary: string;
  humanActions: Array<{ id: string; action: string; optional: boolean; rationale: string; verificationGuidance: string; acknowledgedAt: string | null }>;
  humanActionsCompletedAt: string | null;
  developerPrompt?: string;
  allowedPaths?: string[];
  implementationSteps?: string[];
  acceptanceCriteria?: string[];
  validationCommands?: string[];
  developerReport?: DeveloperReport | null;
  branchName?: string | null;
  headSha?: string | null;
  archivedAt?: string | null;
  humanFeedback?: string | null;
  executionLogs?: ExecutionLog[];
};

type ExecutionLog = { attempt: number; command: string; exit_code: number; output: string };
type ExecutionEvent = { id: string; step: number; tool_name: string; tool_args: unknown; tool_result: unknown; status: "running" | "completed" | "failed"; created_at: string; finished_at?: string };

type DeveloperReport = {
  summary: string;
  files_created: string[];
  files_modified: string[];
  modules_or_interfaces: string[];
  schema_or_configuration: string[];
  behavior_delivered: string[];
  validation_results: string[];
  known_limitations: string[];
  handoff: string;
};

type CurrentStatus = { implementation_state?: string; summary?: string; active_task?: { objective?: string; task_state?: string } | null };
type FeatureChoice = { id: string; name: string };

export function TaskPlanningPanel({ projectId, tasks, projectStatus, features }: { projectId: string; tasks: Task[]; projectStatus: CurrentStatus; features: FeatureChoice[] }) {
  const router = useRouter();
  const [action, setAction] = useState<"idle" | "planning" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  const [requestCategory, setRequestCategory] = useState<"general" | "feature">("feature");
  const [requestFeatureId, setRequestFeatureId] = useState(features[0]?.id ?? "");
  const [recommendation, setRecommendation] = useState("");
  const [activeExecutionTaskId, setActiveExecutionTaskId] = useState<string | null>(null);
  const proposalTasks = sortTasks(tasks.filter((task) => !task.archivedAt && (task.state === "waiting_for_approval" || task.state === "planned")));
  const developerTasks = sortTasks(tasks.filter((task) => !task.archivedAt && ["approved", "queued", "running", "failed"].includes(task.state)));
  const reviewTasks = sortTasks(tasks.filter((task) => !task.archivedAt && task.state === "pending_review"));
  const humanApprovalTasks = sortTasks(tasks.filter((task) => !task.archivedAt && task.state === "waiting_for_human_approval"));
  const archivedTasks = sortTasks(tasks.filter((task) => !!task.archivedAt));

  async function request(endpoint: "plan-next" | "execute-next", body?: Record<string, unknown>) {
    setAction(endpoint === "plan-next" ? "planning" : "running");
    setMessage("");
    if (endpoint === "execute-next") setActiveExecutionTaskId(developerTasks[0]?.id ?? null);
    const response = await fetch("/api/projects/" + projectId + "/" + endpoint, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({ error: "The server returned an invalid response. Check the terminal for details." }));
    setAction("idle");
    if (!response.ok) {
      console.error("Axiom task request failed", { endpoint, projectId, status: response.status, statusText: response.statusText, payload });
      setAction("error");
      if (endpoint === "execute-next") setActiveExecutionTaskId(null);
      setMessage(payload.error ?? "Axiom could not complete this manual action.");
      return;
    }
    if (endpoint === "plan-next" && body) setRecommendation("");
    setMessage(payload.message ?? (endpoint === "plan-next" ? "Task proposal created." : payload.type === "dispatched" ? "Task dispatched to the isolated GitHub Actions worker." : "Execution pass completed."));
    if (endpoint === "execute-next") setActiveExecutionTaskId(null);
    router.refresh();
  }

  return (
    <section className="synthesis-panel task-queues">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">CONTROLLED TASK QUEUES</p>
          <h2>Project work</h2>
          <p className="panel-copy">General work is always ordered before feature work. You can let Axiom choose the next eligible task or guide it with a specific recommendation.</p>
        </div>
        <button className="button secondary" disabled={action === "planning" || action === "running"} onClick={() => request("plan-next")}>{action === "planning" ? "Proposing…" : "Automated propose task"}</button>
      </div>

      <form className="task-request-form" onSubmit={(event) => {
        event.preventDefault();
        request("plan-next", { request: { recommendation, category: requestCategory, featureId: requestCategory === "feature" ? requestFeatureId : undefined } });
      }}>
        <div>
          <p className="eyebrow">ASK FOR A TASK</p>
          <p>Recommend work in your own words. Axiom will read the selected context and return a bounded task proposal for human approval.</p>
        </div>
        <label>
          Scope
          <select value={requestCategory} onChange={(event) => setRequestCategory(event.target.value as "general" | "feature")}> 
            <option value="feature">Feature task</option>
            <option value="general">General project task</option>
          </select>
        </label>
        {requestCategory === "feature" && <label>
          Feature
          <select value={requestFeatureId} onChange={(event) => setRequestFeatureId(event.target.value)} required>
            {features.map((feature) => <option key={feature.id} value={feature.id}>{feature.name}</option>)}
          </select>
        </label>}
        <label className="task-request-message">
          Recommendation
          <textarea value={recommendation} onChange={(event) => setRecommendation(event.target.value)} minLength={10} required placeholder="Example: Add an email/password sign-in screen, with clear errors and session persistence." />
        </label>
        <button className="button" type="submit" disabled={action === "planning" || action === "running" || recommendation.trim().length < 10 || (requestCategory === "feature" && !requestFeatureId)}>
          {action === "planning" ? "Proposing…" : "Ask Axiom for this task"}
        </button>
      </form>

      <section className="status-snapshot">
        <span className="eyebrow">PROJECT CURRENT STATUS · {projectStatus.implementation_state?.replaceAll("_", " ") ?? "unknown"}</span>
        <p>{projectStatus.summary ?? "No implementation status has been recorded yet."}</p>
        {projectStatus.active_task?.objective && <small>Active status source: {projectStatus.active_task.objective} · {projectStatus.active_task.task_state ?? "unknown"}</small>}
      </section>

      <div className="queue-grid">
        <QueueLane title="Your final decision" detail="Completed, reviewed branches wait here. Your decision unblocks the execution loop." tasks={humanApprovalTasks} empty="No reviewed branch is awaiting your decision." projectId={projectId} onChange={() => router.refresh()} />
        <QueueLane title="Awaiting task approval" detail="Proposed work. Approve a task to place it in the developer queue." tasks={proposalTasks} empty="No task proposals are waiting for approval." projectId={projectId} onChange={() => router.refresh()} />
        <QueueLane title="Review queue" detail="Developer reports will arrive here for a human decision." tasks={reviewTasks} empty="No completed work is awaiting review." projectId={projectId} onChange={() => router.refresh()} />
        <QueueLane title="Developer queue" detail="Approved work and retryable failures, ordered for the isolated Docker worker." tasks={developerTasks} empty="No approved task is waiting for implementation." action={action} onRun={() => request("execute-next")} projectId={projectId} onChange={() => router.refresh()} activeExecutionTaskId={activeExecutionTaskId} />
      </div>
      {archivedTasks.length > 0 && (
        <details className="use-case-details" style={{ marginTop: "2rem" }}>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>Archived Tasks ({archivedTasks.length})</summary>
          <div className="queue-task-list" style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
            {archivedTasks.map((task) => <TaskCard key={task.id} task={task} projectId={projectId} onChange={() => router.refresh()} />)}
          </div>
        </details>
      )}
      {message && <p className={action === "error" ? "form-error" : "form-note"}>{message}</p>}
    </section>
  );
}

function QueueLane({
  title,
  detail,
  tasks,
  empty,
  projectId,
  onChange,
  action,
  onRun,
  activeExecutionTaskId,
}: {
  title: string;
  detail: string;
  tasks: Task[];
  empty: string;
  projectId?: string;
  onChange?: () => void;
  action?: string;
  onRun?: () => void;
  activeExecutionTaskId?: string | null;
}) {
  return (
    <section className="queue-lane">
      <h3>{title}</h3>
      <p>{detail}</p>
      {onRun && <button className="button compact-button" disabled={action === "planning" || action === "running" || tasks.length === 0} onClick={onRun}>{action === "running" ? "Running…" : tasks.some((task) => task.state === "failed") ? "Retry failed task" : "Run next task"}</button>}
      {tasks.length === 0 ? <p className="queue-empty">{empty}</p> : <div className="queue-task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} projectId={projectId} onChange={onChange} forceLive={task.id === activeExecutionTaskId} />)}</div>}
    </section>
  );
}

function TaskCard({ task, projectId, onChange, forceLive = false }: { task: Task; projectId?: string; onChange?: () => void; forceLive?: boolean }) {
  const [approving, setApproving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [acknowledgingActionId, setAcknowledgingActionId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectingProposal, setRejectingProposal] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [feedbackText, setFeedbackText] = useState(task.humanFeedback ?? "");

  async function runAiReviewer() {
    if (!projectId || !onChange) return;
    setReviewing(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id + "/review", {
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));
    setReviewing(false);
    if (!response.ok) {
      setError(payload.error ?? "AI Reviewer execution failed.");
      return;
    }
    onChange();
  }

  async function approve() {
    if (!projectId || !onChange) return;
    setApproving(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    const payload = await response.json();
    setApproving(false);
    if (!response.ok) {
      setError(payload.error ?? "Could not approve this task.");
      return;
    }
    onChange();
  }

  async function rejectProposal() {
    if (!projectId || !onChange) return;
    setRejectingProposal(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectProposal: true }),
    });
    const payload = await response.json().catch(() => ({}));
    setRejectingProposal(false);
    if (!response.ok) { setError(payload.error ?? "Could not reject this task proposal."); return; }
    onChange();
  }

  async function mergeApproval() {
    if (!projectId || !onChange) return;
    setMerging(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mergeHumanApproval: true }),
    });
    const payload = await response.json().catch(() => ({}));
    setMerging(false);
    if (!response.ok) { setError(payload.error ?? "Could not merge branch."); return; }
    onChange();
  }

  async function rejectApproval() {
    if (!projectId || !onChange) return;
    setRejecting(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectHumanApproval: true, feedback: feedbackText }),
    });
    const payload = await response.json().catch(() => ({}));
    setRejecting(false);
    if (!response.ok) { setError(payload.error ?? "Could not reject task for redo."); return; }
    onChange();
  }

  async function archive() {
    if (!projectId || !onChange) return;
    setArchiving(true);
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: true }) });
    const payload = await response.json().catch(() => ({}));
    setArchiving(false);
    if (!response.ok) { setError(payload.error ?? "Could not archive this task."); return; }
    onChange();
  }

  async function resetExecution() {
    if (!projectId || !onChange) return;
    setResetting(true);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetExecution: true }) });
    const payload = await response.json().catch(() => ({}));
    setResetting(false);
    if (!response.ok) { setError(payload.error ?? "Could not reset this execution."); return; }
    onChange();
  }

  async function acknowledgePrerequisite(actionId: string) {
    if (!projectId || !onChange) return;
    setAcknowledgingActionId(actionId);
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgeHumanActionId: actionId }),
    });
    const payload = await response.json().catch(() => ({}));
    setAcknowledgingActionId(null);
    if (!response.ok) { setError(payload.error ?? "Could not acknowledge this prerequisite."); return; }
    onChange();
  }

  return (
    <article className="feature-card queue-task-card">
      <p className="eyebrow">{task.category} · priority {task.priority} · {task.state.replaceAll("_", " ")}</p>
      <h4>{task.category === "general" ? "Project-wide" : task.featureName}: {task.objective}</h4>
      <p>{task.humanSummary}</p>
      {(["running", "pending_review", "waiting_for_human_approval", "failed"].includes(task.state) || forceLive) && projectId && <AgentActivity projectId={projectId} taskId={task.id} initialLogs={task.executionLogs ?? []} />}
      {task.humanActions.length > 0 && (
        <details className="use-case-details" open={!task.humanActionsCompletedAt} style={{ marginTop: "1rem" }}>
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>
            🔑 Required Human Prerequisites {task.humanActionsCompletedAt ? "✅" : "⚠️"}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
            {task.humanActions.map((item) => (
              <article 
                key={item.id} 
                className="prerequisite-card"
                style={{ 
                  padding: "12px", 
                  borderRadius: "6px", 
                  border: "1px solid var(--border)", 
                  background: item.acknowledgedAt ? "rgba(16, 185, 129, 0.04)" : "rgba(245, 158, 11, 0.02)",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  textAlign: "left"
                }}
              >
                <input
                  type="checkbox"
                  checked={!!item.acknowledgedAt}
                  disabled={!!item.acknowledgedAt || acknowledgingActionId === item.id}
                  onChange={() => acknowledgePrerequisite(item.id)}
                  style={{ marginTop: "3px", width: "16px", height: "16px", cursor: item.acknowledgedAt ? "default" : "pointer" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <p style={{ margin: 0, fontWeight: 600, textDecoration: item.acknowledgedAt ? "line-through" : "none" }}>
                    {item.action} {item.optional ? <span style={{ opacity: 0.6 }}>(optional)</span> : null}
                  </p>
                  {item.rationale && <p style={{ margin: 0, fontSize: "13px", opacity: 0.8 }}><b>Rationale:</b> {item.rationale}</p>}
                  {item.verificationGuidance && (
                    <p style={{ margin: 0, fontSize: "12px", opacity: 0.7, fontStyle: "italic" }}>
                      <b>Guidance:</b> {item.verificationGuidance}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      <details className="use-case-details task-details">
        <summary>Read more</summary>
        <article><strong>Developer prompt</strong><p>{task.developerPrompt || "Not available for this older proposal."}</p></article>
        <TaskList title="Task paths (read/edit/create scope)" items={task.allowedPaths ?? []} />
        <TaskList title="Implementation steps" items={task.implementationSteps ?? []} />
        <TaskList title="Acceptance criteria" items={task.acceptanceCriteria ?? []} />
        <TaskList title="Validation commands" items={task.validationCommands ?? []} />
      </details>
      {["pending_review", "waiting_for_human_approval", "completed"].includes(task.state) && <details className="use-case-details task-details" open>
        <summary>Developer report</summary>
        {task.developerReport ? <DeveloperReportView report={task.developerReport} /> : <p>The future Docker worker will attach a structured implementation report here.</p>}
      </details>}
      {task.branchName && <p className="branch-name">Branch: <code>{task.branchName}</code>{task.headSha ? " · " + task.headSha.slice(0, 8) : ""}</p>}
      {task.state === "waiting_for_approval" && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "8px 0" }}>
          <button className="button compact-button" disabled={approving || rejectingProposal} onClick={approve}>{approving ? "Approving…" : "Approve task"}</button>
          <button className="button secondary compact-button" style={{ borderColor: "#ef4444", color: "#ef4444" }} disabled={approving || rejectingProposal} onClick={rejectProposal}>{rejectingProposal ? "Rejecting…" : "Reject proposal"}</button>
        </div>
      )}
      {task.state === "pending_review" && (
        <div style={{ margin: "8px 0" }}>
          <button className="button compact-button" disabled={reviewing} onClick={runAiReviewer}>
            {reviewing ? "AI Reviewer Analyzing Code Diff…" : "🤖 Run AI Reviewer"}
          </button>
        </div>
      )}
      {task.state === "waiting_for_human_approval" && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "8px 0" }}>
          <button className="button compact-button" disabled={merging} onClick={mergeApproval}>
            {merging ? (task.branchName ? "Merging branch…" : "Confirming completion…") : task.branchName ? "Approve & Merge Branch" : "Confirm completion"}
          </button>
          <button className="button secondary compact-button" style={{ borderColor: "#ef4444", color: "#ef4444" }} disabled={rejecting} onClick={rejectApproval}>
            {rejecting ? "Rejecting…" : "Reject & Redo Task"}
          </button>
        </div>
      )}
      {task.state === "waiting_for_human_approval" && (
        <div style={{ marginTop: "4px" }}>
          <textarea
            className="task-feedback"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={task.branchName ? "Feedback for developer agent on rejection / redo..." : "Explain why the existing implementation does not satisfy this task..."}
            style={{ width: "100%", minHeight: "60px", marginBottom: "4px" }}
          />
        </div>
      )}
      {!task.archivedAt && ["running", "pending_review", "failed"].includes(task.state) && <button className="button secondary compact-button" disabled={resetting} onClick={resetExecution}>{resetting ? "Resetting…" : task.state === "running" ? "Reset failed execution" : task.state === "failed" ? "Acknowledge & requeue task" : "Retry failed validation"}</button>}
      {!task.archivedAt && !['running', 'pending_review', 'waiting_for_human_approval'].includes(task.state) && <button className="button secondary compact-button" disabled={archiving} onClick={archive}>{archiving ? "Archiving…" : "Archive task"}</button>}
      {!task.archivedAt && ['running', 'pending_review', 'waiting_for_human_approval'].includes(task.state) && <button className="button secondary compact-button" disabled={archiving} onClick={archive}>{archiving ? "Aborting…" : "Abort task"}</button>}
      {error && <p className="form-error">{error}</p>}
    </article>
  );
}

function AgentActivity({ projectId, taskId, initialLogs }: { projectId: string; taskId: string; initialLogs: ExecutionLog[] }) {
  const fallbackEvents: ExecutionEvent[] = initialLogs.map((log, index) => ({ id: "fallback-" + index, step: log.attempt, tool_name: log.command, tool_args: {}, tool_result: { output: log.output }, status: log.exit_code === 0 ? "completed" : "failed", created_at: "" }));
  const [activity, setActivity] = useState<{ state: string; step: number; events: ExecutionEvent[] }>({
    state: "starting",
    step: 0,
    events: fallbackEvents,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/projects/" + projectId + "/tasks/" + taskId + "/activity", { cache: "no-store" });
        if (!response.ok) throw new Error("Activity unavailable");
        const payload = await response.json() as { state: string; step: number; events: ExecutionEvent[] };
        if (cancelled) return;
        setActivity({ state: payload.state, step: payload.step, events: payload.events?.length ? payload.events : fallbackEvents });
        if (["running", "approved", "pending_review"].includes(payload.state)) timer = setTimeout(poll, 1_500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3_000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [projectId, taskId, initialLogs]);

  return <section className="agent-activity" aria-live="polite">
    <div><span className="eyebrow">FULL EXECUTION TERMINAL</span><strong>{activity.state.replaceAll("_", " ")} · {activity.step > 30 ? "final validation / AI review" : `step ${activity.step}/30`}</strong></div>
    {activity.events.length === 0 ? <p>Starting isolated workspace…</p> : <ol>
      {activity.events.map((entry) => {
        const summary = formatAgentStepSummary(entry.step, entry.tool_name, entry.tool_args, entry.tool_result, entry.created_at, entry.finished_at);
        return (
          <li key={entry.id} className={entry.status === "failed" ? "failed" : ""}>
            <code>{entry.created_at ? new Date(entry.created_at).toLocaleTimeString() + " · " : ""}{summary.turnLabel} · {entry.tool_name} · {summary.thinkingText}, {summary.actionText}</code>
            <span>{entry.status}</span>
            <pre>{formatEvent(entry.tool_args, entry.tool_result)}</pre>
          </li>
        );
      })}
    </ol>}
  </section>;
}

function formatEvent(args: unknown, result: unknown) {
  return JSON.stringify({ args, result }, null, 2);
}

function DeveloperReportView({ report }: { report: DeveloperReport }) {
  return (
    <>
      <article><strong>Summary</strong><p>{report.summary}</p></article>
      <TaskList title="Files created" items={report.files_created} />
      <TaskList title="Files modified" items={report.files_modified} />
      <TaskList title="Modules and interfaces" items={report.modules_or_interfaces} />
      <TaskList title="Schema and configuration" items={report.schema_or_configuration} />
      <TaskList title="Delivered behavior" items={report.behavior_delivered} />
      <TaskList title="Validation results" items={report.validation_results} />
      <TaskList title="Known limitations" items={report.known_limitations} />
      <article><strong>Handoff</strong><p>{report.handoff}</p></article>
    </>
  );
}

function TaskList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <article><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>;
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => Number(a.category !== "general") - Number(b.category !== "general") || a.priority - b.priority);
}

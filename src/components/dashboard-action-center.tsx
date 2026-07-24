"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type DashboardTask = {
  id: string;
  state: string;
  objective: string;
  humanSummary: string;
  featureName: string;
  branchName: string | null;
  headSha: string | null;
  developerReport: { summary: string; validationResults: string[]; filesModified: string[] } | null;
  reviewFeedback: string | null;
  executionStartedAt: string | null;
  lastAutomationOutcome: string | null;
  executionLogs: Array<{ attempt: number; command: string; exitCode: number; output: string }>;
  humanActions: Array<{ id: string; action: string; optional: boolean; acknowledgedAt: string | null }>;
};

export type DashboardClarification = { id: string; question: string; rationale: string | null };
export type FeatureSnapshot = { id: string; name: string; state: string; summary: string; detail: string[] };
export type HumanTodo = { id: string; title: string; rationale: string; suggestedAction: string; humanComment: string | null };
export type PlanningFeature = { id: string; name: string };

export function DashboardActionCenter({ projectId, projectState, tasks, clarifications, featureSnapshots, humanTodos, planningFeatures, automationState }: { projectId: string; projectState: "active" | "completed"; tasks: DashboardTask[]; clarifications: DashboardClarification[]; featureSnapshots: FeatureSnapshot[]; humanTodos: HumanTodo[]; planningFeatures: PlanningFeature[]; automationState: "running" | "frozen" | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [todoComments, setTodoComments] = useState<Record<string, string>>({});
  const projectCompleted = projectState === "completed";

  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    const interval = window.setInterval(refreshWhenVisible, 7000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [router]);

  const manualControlsEnabled = automationState === "frozen";
  const proposals = tasks.filter((task) => task.state === "waiting_for_approval" || task.state === "planned");
  const prerequisites = tasks.flatMap((task) => task.humanActions.filter((action) => !action.optional && !action.acknowledgedAt).map((action) => ({ task, action })));
  const items: Array<{ type: "review"; task: DashboardTask } | { type: "proposal"; task: DashboardTask } | { type: "clarification"; question: DashboardClarification } | { type: "prerequisite"; task: DashboardTask; action: DashboardTask["humanActions"][number] }> = [
    ...proposals.map((task) => ({ type: "proposal" as const, task })),
    ...clarifications.map((question) => ({ type: "clarification" as const, question })),
    ...prerequisites.map(({ task, action }) => ({ type: "prerequisite" as const, task, action })),
  ];
  const primary = items[0] ?? null;
  const remaining = items.slice(1);
  const activeTask = tasks.find((task) => ["running", "pending_review", "waiting_for_human_approval", "failed"].includes(task.state))
    ?? tasks.find((task) => task.state === "approved" && isActiveRetry(task))
    ?? null;
  const runnableTasks = tasks.filter((task) => task.state === "queued" || (task.state === "approved" && !isActiveRetry(task)));

  async function request(key: string, url: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setPending(key); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("Axiom API request failed", { url, projectId, status: response.status, statusText: response.statusText, payload });
        setMessage(payload.error ?? (url.endsWith("/plan-next") ? "Axiom could not create the task proposal. Check the repository connection and try again." : "Axiom could not apply that decision."));
        return null;
      }
      if (url.endsWith("/plan-next")) {
        setMessage(planningOutcomeMessage(payload));
      }
      if (url.endsWith("/execute-next") && payload.type === "dispatched") {
        setMessage(typeof payload.message === "string" ? payload.message : "Task dispatched to the isolated GitHub Actions worker.");
      }
      if (url.endsWith("/review")) setMessage(validationOutcomeMessage(payload));
      router.refresh();
      return payload;
    } catch {
      setMessage(url.endsWith("/plan-next") ? "Axiom could not reach the task planner. Please try proposing again." : "Axiom could not reach the server. Please try again.");
      return null;
    } finally {
      setPending(null);
    }
  }

  async function updateTask(key: string, taskId: string, body: Record<string, unknown>) {
    setPending(key); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not apply that decision."); return false; }
    router.refresh(); return true;
  }

  async function updateFeature(key: string, featureId: string, state: "active" | "completed") {
    setPending(key); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/features/${featureId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not update this feature."); return; }
    router.refresh();
  }

  async function updateProjectState() {
    const key = "project-state";
    setPending(key); setMessage("");
    const state = projectCompleted ? "active" : "completed";
    const response = await fetch(`/api/projects/${projectId}/state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not update the project state."); return; }
    router.refresh();
  }

  async function answer(question: DashboardClarification) {
    const answerText = answers[question.id]?.trim();
    if (!answerText) return;
    setPending(question.id); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/clarifications`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [{ id: question.id, answer: answerText }] }) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not save that clarification."); return; }
    router.refresh();
  }

  function renderItem(item: NonNullable<typeof primary>, primaryCard = false) {
    if (item.type === "review") {
      const { task } = item; const key = `review-${task.id}`;
      return <article className={primaryCard ? "decision-card primary-review" : "decision-card"} key={key}><div className="decision-card-header"><span className="decision-kind amber">FINAL HUMAN DECISION</span><span className="decision-feature">{task.featureName}</span></div><h2>{task.objective}</h2><p>{task.developerReport?.summary ?? task.humanSummary}</p><div className="evidence-strip"><span>BRANCH <code>{task.branchName ?? "not available"}</code></span><span>SHA <code>{task.headSha?.slice(0, 8) ?? "—"}</code></span><span>VALIDATION <b>{task.developerReport?.validationResults.length ? "Recorded" : "No report"}</b></span></div>{task.developerReport?.validationResults.length ? <ul className="decision-evidence">{task.developerReport.validationResults.slice(0, 3).map((result) => <li key={result}>{result}</li>)}</ul> : null}<textarea value={feedback[task.id] ?? ""} onChange={(event) => setFeedback((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Feedback is only needed if you send this task back." /><div className="decision-actions"><button className="button decision-approve" disabled={pending === key} onClick={() => updateTask(key, task.id, { mergeHumanApproval: true })}>{pending === key ? "Applying…" : "Approve & merge"}</button><button className="button secondary" disabled={pending === `${key}-redo`} onClick={() => updateTask(`${key}-redo`, task.id, { rejectHumanApproval: true, feedback: feedback[task.id] || "Please revise the implementation." })}>{pending === `${key}-redo` ? "Applying…" : "Request changes"}</button></div></article>;
    }
    if (item.type === "proposal") { const { task } = item; const key = `proposal-${task.id}`; const feedbackKey = `${key}-feedback`; const rejectKey = `${key}-reject`; const feedbackText = feedback[task.id] ?? ""; return <article className={primaryCard ? "decision-card primary-proposal" : "decision-card"} key={key}><div className="decision-card-header"><span className="decision-kind blue">TASK PROPOSAL</span><span className="decision-feature">{task.featureName}</span></div><h2>{task.objective}</h2><p>{task.humanSummary}</p><textarea value={feedbackText} onChange={(event) => setFeedback((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Add feedback or a change request for Axiom." /><div className="decision-actions"><button className="button" disabled={pending === key} onClick={() => updateTask(key, task.id, { approve: true })}>{pending === key ? "Approving…" : "Approve task"}</button><button className="button secondary" disabled={pending === feedbackKey || !feedbackText.trim()} onClick={() => updateTask(feedbackKey, task.id, { feedback: feedbackText.trim() })}>{pending === feedbackKey ? "Sending…" : "Send feedback"}</button><button className="button secondary" disabled={pending === rejectKey} onClick={() => updateTask(rejectKey, task.id, { rejectProposal: true, feedback: feedbackText.trim() || undefined })}>{pending === rejectKey ? "Rejecting…" : "Reject proposal"}</button></div></article>; }
    if (item.type === "clarification") { const { question } = item; return <article className={primaryCard ? "decision-card primary-clarification" : "decision-card"} key={question.id}><div className="decision-card-header"><span className="decision-kind amber">CLARIFICATION NEEDED</span></div><h2>{question.question}</h2>{question.rationale ? <p>{question.rationale}</p> : null}<textarea value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Provide the decision Axiom needs." /><div className="decision-actions"><button className="button" disabled={pending === question.id || !(answers[question.id] ?? "").trim()} onClick={() => answer(question)}>{pending === question.id ? "Saving…" : "Save answer"}</button></div></article>; }
    const { task, action } = item; const key = `prerequisite-${action.id}`; return <article className={primaryCard ? "decision-card primary-prerequisite" : "decision-card"} key={key}><div className="decision-card-header"><span className="decision-kind amber">REQUIRED PREREQUISITE</span><span className="decision-feature">{task.featureName}</span></div><h2>{action.action}</h2><p>Required before Axiom can continue: {task.objective}</p><div className="decision-actions"><button className="button" disabled={pending === key} onClick={() => updateTask(key, task.id, { acknowledgeHumanActionId: action.id })}>{pending === key ? "Confirming…" : "Mark complete"}</button></div></article>;
  }

  return <>
    <section className="dashboard-inbox"><div className="dashboard-section-heading"><div><p className="eyebrow">PROJECT LIFECYCLE</p><h2>{projectCompleted ? "Project completed by you" : "Project is active"}</h2><p>{projectCompleted ? "Automation, planning, and task execution are stopped until you resume this project." : "Only you can mark this project complete. Axiom will keep checking active scopes until then."}</p></div><button className="button secondary" disabled={pending === "project-state"} onClick={updateProjectState}>{pending === "project-state" ? "Saving…" : projectCompleted ? "Resume project" : "Mark project complete"}</button></div>{message ? <p className="form-note dashboard-message">{message}</p> : null}</section>
    {!projectCompleted && <><section className="dashboard-inbox dashboard-inbox-header" aria-label="Human control status"><div className="inbox-status-grid"><SystemStatus tasks={tasks} clarifications={clarifications} /><InboxStatus label="Task proposals" count={proposals.length} empty="No bounded task proposal is waiting." tone="blue" /><InboxStatus label="Clarifications" count={clarifications.length} empty="Project context has no open question." tone="amber" /><InboxStatus label="Prerequisites" count={prerequisites.length} empty="No required action is blocking work." tone="cyan" /></div></section>
    <section className="dashboard-control-grid"><div className="dashboard-control-left"><section className="dashboard-decision-zone"><div className="dashboard-section-heading"><div><p className="eyebrow">{primary ? "ACTION REQUIRED" : "HUMAN DECISION INBOX"}</p>{primary ? <h2>Your next decision</h2> : null}</div>{primary ? <span className="decision-count">{items.length} OPEN</span> : null}</div>{primary ? renderItem(primary, true) : <article className="decision-empty"><strong>Nothing needs a human decision right now.</strong><p>When Axiom needs a proposal approval, clarification, or prerequisite, it will appear here first.</p></article>}</section>{remaining.length > 0 ? <section className="dashboard-inbox"><div className="dashboard-section-heading"><div><p className="eyebrow">ACTION INBOX</p><h2>Other pending decisions</h2></div></div><div className="decision-inbox-list">{remaining.map((item) => renderItem(item))}</div></section> : null}<HumanWorklist projectId={projectId} todos={humanTodos} comments={todoComments} setComments={setTodoComments} pending={pending} setPending={setPending} setMessage={setMessage} /></div><ActiveTask projectId={projectId} task={activeTask} feedback={feedback} setFeedback={setFeedback} pending={pending} updateTask={updateTask} request={request} manualControlsEnabled={manualControlsEnabled} /></section>
    <ExecutionQueue projectId={projectId} tasks={runnableTasks} features={planningFeatures} hasActiveTask={Boolean(activeTask)} manualControlsEnabled={manualControlsEnabled} pending={pending} request={request} message={message} /></>}
    <section className="feature-delivery-snapshot"><div className="dashboard-section-heading"><div><p className="eyebrow">PROJECT FEATURES</p><h2>Project features</h2></div></div>{featureSnapshots.length ? <div className="feature-snapshot-grid">{featureSnapshots.map((feature) => { const featureKey = `feature-${feature.id}`; const isComplete = feature.state === "completed"; return <article className="feature-snapshot-card" key={feature.id}><div><span className={`feature-state ${feature.state}`}>{feature.state.replaceAll("_", " ")}</span><h3>{feature.name}</h3></div><p>{feature.summary}</p>{feature.detail.length ? <details><summary>Details</summary><ul>{feature.detail.slice(0, 6).map((detail) => <li key={detail}>{detail}</li>)}</ul></details> : null}<div className="decision-actions"><button className="button secondary" disabled={pending === featureKey} onClick={() => updateFeature(featureKey, feature.id, isComplete ? "active" : "completed")}>{pending === featureKey ? "Saving…" : isComplete ? "Resume development" : "Mark feature complete"}</button></div></article>; })}</div> : <article className="feature-snapshot-empty"><strong>No project features have been defined yet.</strong><p>Once features are added during project setup, each one will appear here—even before implementation begins.</p></article>}</section>
  </>;
}

function planningOutcomeMessage(payload: Record<string, unknown>) {
  if (payload.type === "task") return "Axiom created a task proposal. It is now waiting for your approval.";
  if (payload.type === "clarification") return "Axiom needs a clarification before it can safely propose this task.";
  if (payload.type === "idle") return typeof payload.message === "string" ? payload.message : "Every eligible scope already has a task or clarification.";
  return "Axiom completed the planning check.";
}

function validationOutcomeMessage(payload: Record<string, unknown>) {
  if (payload.verdict === "pass") return "AI validation passed. The completed task is ready for your final approval.";
  if (payload.verdict === "retry") return "AI validation found an issue. The task is waiting for your recovery decision with the failure details attached.";
  return "Axiom completed the validation check.";
}


function ActiveTask({ projectId, task, feedback, setFeedback, pending, updateTask, request, manualControlsEnabled }: { projectId: string; task: DashboardTask | null; feedback: Record<string, string>; setFeedback: (value: Record<string, string>) => void; pending: string | null; updateTask: (key: string, taskId: string, body: Record<string, unknown>) => Promise<boolean>; request: (key: string, url: string, body?: unknown) => Promise<Record<string, unknown> | null>; manualControlsEnabled: boolean }) {
  if (!task) return <aside className="active-task-panel empty"><p className="eyebrow">ACTIVE TASK</p><h2>No task is active</h2><p>Approve a proposal, then let automatic flow continue—or freeze it to choose a queued task yourself.</p></aside>;
  const validationKey = `validate-${task.id}`;
  const reviewKey = `review-${task.id}`;
  const recoveryKey = `recover-${task.id}`;
  const queueKey = `queue-${task.id}`;
  const cancelKey = `cancel-${task.id}`;
  const archiveKey = `archive-${task.id}`;
  const retry = async () => {
    if (task.state === "approved") {
      if (manualControlsEnabled) {
        await request(recoveryKey + "-start", `/api/projects/${projectId}/execute-next`, { taskId: task.id });
      } else {
        await request(recoveryKey + "-start", `/api/projects/${projectId}/automation/cycle`);
      }
      return;
    }
    const recovered = await updateTask(recoveryKey, task.id, { resetExecution: true });
    if (!recovered) return;
    if (manualControlsEnabled) {
      await request(recoveryKey + "-start", `/api/projects/${projectId}/execute-next`, { taskId: task.id });
    } else {
      await request(recoveryKey + "-start", `/api/projects/${projectId}/automation/cycle`);
    }
  };
  return <aside className={`active-task-panel ${task.state}`}><p className="eyebrow">ACTIVE TASK</p><span className={`task-state ${task.state}`}>{task.state.replaceAll("_", " ")}</span><h2>{task.objective}</h2><p>{task.developerReport?.summary ?? task.humanSummary}</p><small suppressHydrationWarning>{task.featureName}{task.branchName ? ` · ${task.branchName}` : ""}{task.executionStartedAt ? ` · started ${new Date(task.executionStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</small>{task.state === "pending_review" ? <p className="active-task-gate">{manualControlsEnabled ? "Execution finished. Validation is waiting for your command while automatic flow is frozen." : "Execution finished. Automatic flow will send this task to AI validation."}</p> : null}{task.state === "approved" ? <p className="active-task-gate">{manualControlsEnabled ? "This task is ready for a manual retry." : "AI feedback was recorded. Automatic flow is retrying this active task."}</p> : null}{task.state === "waiting_for_human_approval" && !task.branchName ? <p className="active-task-gate">Validation passed without a code change. Confirm that the existing implementation satisfies this task.</p> : null}{task.state === "failed" ? <p className="active-task-gate">{failureReason(task) ?? task.reviewFeedback ?? "Execution failed before a result was available."}</p> : null}{task.state === "running" ? (<div className="active-task-step"><div className="step-loader" /><span className="step-label">{getCurrentStep(task)}</span></div>) : (<ExecutionDetails task={task} open={task.state === "failed"} />)}{task.state === "running" ? <button className="button secondary task-cancel-button" disabled={pending === cancelKey} onClick={() => updateTask(cancelKey, task.id, { resetExecution: true })}>{pending === cancelKey ? "Cancelling…" : "Cancel task"}</button> : null}{task.state === "pending_review" ? <button className={manualControlsEnabled ? "button secondary" : "button secondary automation-wait-button"} disabled={!manualControlsEnabled || pending === validationKey} title={manualControlsEnabled ? "Ask the AI Reviewer to validate this completed task." : "Automation will submit this task to the AI Reviewer."} onClick={() => request(validationKey, `/api/projects/${projectId}/tasks/${task.id}/review`)}>{pending === validationKey ? "Validating…" : manualControlsEnabled ? "Ask AI to validate" : <><i aria-hidden />Waiting for AI validation…</>}</button> : null}{task.state === "approved" && manualControlsEnabled ? <button className="button" disabled={pending === recoveryKey} onClick={retry}>{pending === recoveryKey ? "Retrying…" : "Retry task"}</button> : null}{task.state === "failed" ? <div><button className="button" disabled={pending === recoveryKey} onClick={retry}>{pending === recoveryKey ? "Retrying…" : "Retry task"}</button><button className="button secondary" disabled={pending === queueKey} onClick={() => updateTask(queueKey, task.id, { returnToQueue: true })}>{pending === queueKey ? "Queuing…" : "Return to queue"}</button><button className="button secondary" disabled={pending === archiveKey} onClick={() => updateTask(archiveKey, task.id, { archive: true })}>{pending === archiveKey ? "Deleting…" : "Delete task"}</button></div> : null}{task.state === "waiting_for_human_approval" ? <><textarea value={feedback[task.id] ?? ""} onChange={(event) => setFeedback({ ...feedback, [task.id]: event.target.value })} placeholder={task.branchName ? "Feedback is only needed to request changes." : "Explain why the existing implementation does not satisfy this task."} /><div><button className="button decision-approve" disabled={pending === reviewKey} onClick={() => updateTask(reviewKey, task.id, { mergeHumanApproval: true })}>{pending === reviewKey ? "Applying…" : task.branchName ? "Approve & merge" : "Confirm completion"}</button><button className="button secondary" disabled={pending === `${reviewKey}-redo`} onClick={() => updateTask(`${reviewKey}-redo`, task.id, { rejectHumanApproval: true, feedback: feedback[task.id] || "Please revise the implementation." })}>{pending === `${reviewKey}-redo` ? "Applying…" : "Request changes"}</button></div></> : null}</aside>;
}

function isActiveRetry(task: DashboardTask) {
  return task.lastAutomationOutcome === "retry" || task.lastAutomationOutcome === "human_recovered";
}

function ExecutionDetails({ task, open = false }: { task: DashboardTask; open?: boolean }) {
  const logs = task.executionLogs.slice(-6).reverse();
  const validation = task.developerReport?.validationResults ?? [];
  if (!logs.length && !validation.length && !task.reviewFeedback) return null;
  return <details className="active-task-details" open={open}><summary>{task.state === "running" ? "Live execution details" : "Execution and validation details"}</summary>{task.reviewFeedback ? <p className="task-review-feedback">{task.reviewFeedback}</p> : null}{logs.length ? <ol>{logs.map((log, index) => <li className={log.exitCode === 0 ? "passed" : "failed"} key={`${log.attempt}-${log.command}-${index}`}><div><strong>{humanCommand(log.command)}</strong><span>{log.exitCode === 0 ? "Passed" : `Failed · exit ${log.exitCode}`}</span></div>{log.output ? <pre>{log.output.slice(-900)}</pre> : null}</li>)}</ol> : null}{validation.length ? <ul className="task-validation-list">{validation.map((result) => <li key={result}>{result}</li>)}</ul> : null}</details>;
}

function humanCommand(command: string) {
  const labels: Record<string, string> = { "agent.finish": "Developer agent reported completion", "agent.auto_finish": "Axiom finalized the developer run", "orchestrator": "Execution host", "prepare_dependencies": "Preparing workspace dependencies" };
  if (labels[command]) return labels[command];
  if (command.startsWith("agent.write")) return "Developer agent wrote files";
  if (command.startsWith("agent.inspect")) return "Developer agent inspected files";
  if (command.startsWith("agent.validation")) return "Task validation";
  return command;
}

function failureReason(task: DashboardTask) {
  return task.executionLogs.slice().reverse().find((log) => log.exitCode !== 0)?.output.slice(-900) ?? null;
}

function getCurrentStep(task: DashboardTask) {
  if (!task.executionLogs || !task.executionLogs.length) {
    return "Initializing task execution...";
  }
  const lastLog = task.executionLogs[task.executionLogs.length - 1];
  const command = lastLog.command;
  if (command === "prepare_dependencies") {
    return "Preparing workspace dependencies...";
  }
  if (command.startsWith("agent.inspect")) {
    const rawPaths = command.replace("agent.inspect", "").trim();
    if (rawPaths) {
      const paths = rawPaths.split(",").map(p => {
        const parts = p.trim().split(/[/\\]/);
        return parts[parts.length - 1];
      }).join(", ");
      return `Analyzing ${paths}...`;
    }
    return "Analyzing codebase...";
  }
  if (command.startsWith("agent.write")) {
    const rawPaths = command.replace("agent.write", "").trim();
    if (rawPaths) {
      const paths = rawPaths.split(",").map(p => {
        const parts = p.trim().split(/[/\\]/);
        return parts[parts.length - 1];
      }).join(", ");
      return `Editing ${paths}...`;
    }
    return "Editing files...";
  }
  if (command.startsWith("agent.validation")) {
    return "Running task validation...";
  }
  if (command === "agent.finish") {
    return "Reporting task completion...";
  }
  if (command === "agent.auto_finish") {
    return "Auto-completing developer run...";
  }
  if (command.startsWith("orchestrator")) {
    return "Executing harness steps...";
  }
  return `Running command: ${command}...`;
}

function ExecutionQueue({ projectId, tasks, features, hasActiveTask, manualControlsEnabled, pending, request, message }: { projectId: string; tasks: DashboardTask[]; features: PlanningFeature[]; hasActiveTask: boolean; manualControlsEnabled: boolean; pending: string | null; request: (key: string, url: string, body?: unknown) => Promise<Record<string, unknown> | null>; message: string }) {
  return <section className="execution-queue"><div className="dashboard-section-heading"><div><p className="eyebrow">EXECUTION QUEUE</p><h2>Ready to run</h2></div><div className="queue-heading-actions"><TaskProposalComposer projectId={projectId} features={features} pending={pending} request={request} message={message} /><span className={manualControlsEnabled ? "manual-mode-badge enabled" : "manual-mode-badge"}>{manualControlsEnabled ? "MANUAL START AVAILABLE" : "AUTOMATIC FLOW OWNS EXECUTION"}</span></div></div>{tasks.length ? <div className="execution-queue-track">{tasks.map((task, index) => { const key = `start-${task.id}`; const disabled = !manualControlsEnabled || hasActiveTask || pending === key; const waitingForAutomation = !manualControlsEnabled && !hasActiveTask; return <article className="execution-queue-card" key={task.id}><span>#{index + 1}</span><strong>{task.objective}</strong><small>{task.featureName} · {task.state.replaceAll("_", " ")}</small><button className={waitingForAutomation ? "button secondary automation-wait-button" : "button secondary"} disabled={disabled} title={!manualControlsEnabled ? "Automation will start this task when the delivery lane is available." : hasActiveTask ? "Finish or resolve the active task before starting another." : "Start this task manually."} onClick={() => request(key, `/api/projects/${projectId}/execute-next`, { taskId: task.id })}>{pending === key ? "Starting…" : waitingForAutomation ? <><i aria-hidden />Queued for Axiom…</> : "Start"}</button></article>; })}</div> : <article className="task-monitor-empty"><strong>No task is ready to run.</strong><p>Approved tasks will appear here in execution order.</p></article>}</section>;
}

function TaskProposalComposer({ projectId, features, pending, request, message }: { projectId: string; features: PlanningFeature[]; pending: string | null; request: (key: string, url: string, body?: unknown) => Promise<Record<string, unknown> | null>; message: string }) {
  const [category, setCategory] = useState<"general" | "feature">("general");
  const [featureId, setFeatureId] = useState(features[0]?.id ?? "");
  const [recommendation, setRecommendation] = useState("");
  const [open, setOpen] = useState(false);
  const valid = recommendation.trim().length >= 10 && (category === "general" || Boolean(featureId));
  const minimumTextMet = recommendation.trim().length >= 10;
  const requirement = !minimumTextMet
    ? `Describe the requested outcome in at least 10 characters (${recommendation.trim().length}/10).`
    : category === "feature" && !featureId
      ? "Choose a feature before proposing feature work."
      : null;
  return <details className="task-proposal-composer" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Propose task</summary><div><label>Scope<select value={category} onChange={(event) => setCategory(event.target.value as "general" | "feature")}><option value="general">General project work</option><option value="feature" disabled={!features.length}>Feature work</option></select></label>{category === "feature" ? <label>Feature<select value={featureId} onChange={(event) => setFeatureId(event.target.value)}>{features.map((feature) => <option value={feature.id} key={feature.id}>{feature.name}</option>)}</select></label> : null}<label>What should Axiom plan?<textarea value={recommendation} onChange={(event) => setRecommendation(event.target.value)} placeholder="Describe the bounded outcome you want Axiom to propose." /></label>{requirement ? <p className="form-note">{requirement}</p> : null}{message ? <p className="form-note dashboard-message">{message}</p> : null}<button className="button" disabled={!valid || pending === "propose"} onClick={() => { void request("propose", `/api/projects/${projectId}/plan-next`, { request: { recommendation: recommendation.trim(), category, ...(category === "feature" ? { featureId } : {}) } }).then((payload) => { if (payload?.type === "task") { setOpen(false); setRecommendation(""); } }); }}>{pending === "propose" ? "Proposing…" : "Ask Axiom to propose"}</button></div></details>;
}

function HumanWorklist({ projectId, todos, comments, setComments, pending, setPending, setMessage }: { projectId: string; todos: HumanTodo[]; comments: Record<string, string>; setComments: (value: Record<string, string>) => void; pending: string | null; setPending: (value: string | null) => void; setMessage: (value: string) => void }) {
  const router = useRouter();
  async function updateTodo(todo: HumanTodo, status: "completed" | "cancelled") {
    const key = `todo-${status}-${todo.id}`;
    setPending(key); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/human-todos/${todo.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, comment: comments[todo.id]?.trim() || undefined }) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not update that item."); return; }
    router.refresh();
  }
  async function submitComments() {
    const items = todos.flatMap((todo) => comments[todo.id]?.trim() ? [{ id: todo.id, comment: comments[todo.id].trim() }] : []);
    if (!items.length) return;
    setPending("todo-feedback"); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/human-todos`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not save your direction."); return; }
    setComments({}); router.refresh();
  }
  async function regenerate() {
    setPending("todo-regenerate"); setMessage("");
    const response = await fetch(`/api/projects/${projectId}/human-todos`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { setMessage(payload.error ?? "Axiom could not refresh the worklist."); return; }
    router.refresh();
  }
  const commentedCount = todos.filter((todo) => comments[todo.id]?.trim()).length;
  return <section className="human-worklist"><div className="dashboard-section-heading"><div><p className="eyebrow">AXIOM TO-DO LIST</p><h2>Your next actions</h2></div><span className="decision-count">{todos.length} OPEN</span></div>{todos.length ? <div className="human-todo-list">{todos.map((todo) => <article className="human-todo-card" key={todo.id}><div className="human-todo-copy"><button type="button" className="todo-check" disabled={pending === `todo-completed-${todo.id}`} onClick={() => updateTodo(todo, "completed")} aria-label={`Mark ${todo.title} complete`}><span /></button><div><h3>{todo.title}</h3><p>{todo.rationale}</p><small>{todo.suggestedAction}</small></div></div><textarea value={comments[todo.id] ?? ""} onChange={(event) => setComments({ ...comments, [todo.id]: event.target.value })} placeholder="Add direction for Axiom (optional)" /><div className="human-todo-actions"><button className="text-button" type="button" disabled={pending === `todo-cancelled-${todo.id}`} onClick={() => updateTodo(todo, "cancelled")}>{pending === `todo-cancelled-${todo.id}` ? "Cancelling…" : "Cancel"}</button><button className="button secondary" type="button" disabled={pending === `todo-completed-${todo.id}`} onClick={() => updateTodo(todo, "completed")}>{pending === `todo-completed-${todo.id}` ? "Saving…" : "Complete"}</button></div></article>)}</div> : <article className="human-todo-empty"><strong>No additional human action is recommended.</strong><p>Axiom will keep the decision inbox separate and add a focused worklist when it has useful direction.</p></article>}<div className="human-worklist-tools"><button className="button secondary" type="button" disabled={pending === "todo-regenerate"} onClick={regenerate}>{pending === "todo-regenerate" ? "Refreshing…" : "Regenerate to-do list"}</button><button className="button" type="button" disabled={!commentedCount || pending === "todo-feedback"} onClick={submitComments}>{pending === "todo-feedback" ? "Sending…" : `Send ${commentedCount || ""} comment${commentedCount === 1 ? "" : "s"} to Axiom`}</button></div></section>;
}

function SystemStatus({ tasks, clarifications }: { tasks: DashboardTask[]; clarifications: DashboardClarification[] }) {
  const running = tasks.find((task) => task.state === "running");
  const reviewing = tasks.find((task) => task.state === "pending_review");
  const waiting = tasks.find((task) => task.state === "waiting_for_human_approval" || task.state === "waiting_for_approval" || task.state === "planned");
  const latestCompleted = tasks.filter((task) => task.state === "completed").at(-1);
  const latestCompletionDetail = latestCompleted
    ? latestCompleted.objective + " — " + (latestCompleted.reviewFeedback ?? latestCompleted.developerReport?.validationResults.at(-1) ?? "Completed.")
    : "No harness action is currently running.";
  const status = running ? { label: "Executing task", detail: running.objective, active: true, tone: "green" } : reviewing ? { label: "Reviewing task", detail: reviewing.objective, active: true, tone: "blue" } : waiting ? { label: "Waiting for approval", detail: waiting.objective, active: false, tone: "amber" } : clarifications.length > 0 ? { label: "Checking context", detail: "A clarification needs your input.", active: true, tone: "blue" } : latestCompleted ? { label: "Last task completed", detail: latestCompletionDetail, active: false, tone: "cyan" } : { label: "Idle", detail: latestCompletionDetail, active: false, tone: "cyan" };
  return <article className={`inbox-status system-status ${status.tone}`}><span>SYSTEM STATUS</span><strong><i className={status.active ? "status-orb active" : "status-orb"} />{status.label}</strong><p>{status.detail}</p></article>;
}

function InboxStatus({ label, count, empty, tone }: { label: string; count: number; empty: string; tone: "amber" | "blue" | "cyan" }) {
  return <article className={`inbox-status ${tone}`}><span>{label}</span><strong>{count}</strong><p>{count === 0 ? empty : `${count} item${count === 1 ? " requires" : "s require"} your attention.`}</p></article>;
}

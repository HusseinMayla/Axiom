"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Task = {
  id: string;
  featureName: string;
  state: string;
  objective: string;
  humanSummary: string;
  humanActions: Array<{ action: string; optional: boolean }>;
  humanActionsCompletedAt: string | null;
};

export function TaskPlanningPanel({ projectId, tasks }: { projectId: string; tasks: Task[] }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "planning" | "error">("idle");
  const [message, setMessage] = useState("");

  async function planNext() {
    setState("planning");
    setMessage("Checking eligible active features and drafting one bounded proposal…");
    const response = await fetch("/api/projects/" + projectId + "/plan-next", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not plan the next feature.");
      return;
    }
    setState("idle");
    setMessage(payload.type === "idle" ? payload.message : payload.type === "clarification" ? "Planning paused: Axiom needs a feature clarification." : "A proposed task is ready for review.");
    router.refresh();
  }

  return (
    <section className="synthesis-panel">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">AUTOMATIC FEATURE-PLANNING LOOP</p>
          <h2>Proposed work</h2>
          <p className="panel-copy">Axiom creates one proposal per eligible active feature. Nothing is executed until you approve it.</p>
        </div>
        <button className="button secondary" disabled={state === "planning"} onClick={planNext}>
          {state === "planning" ? "Planning…" : "Plan next eligible feature"}
        </button>
      </div>
      {tasks.length === 0 ? <p className="form-note">No task proposal yet. The loop will use the first active feature with no active task.</p> : (
        <div className="feature-list">
          {tasks.map((task) => <TaskCard key={task.id} projectId={projectId} task={task} />)}
        </div>
      )}
      {message && <p className={state === "error" ? "form-error" : "form-note"}>{message}</p>}
    </section>
  );
}

function TaskCard({ projectId, task }: { projectId: string; task: Task }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function update(body: Record<string, unknown>) {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/projects/" + projectId + "/tasks/" + task.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Could not update this task.");
      return;
    }
    setFeedback("");
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <article className="feature-card">
      <p className="eyebrow">{task.featureName} · {task.state.replaceAll("_", " ")}</p>
      <h4>{task.objective}</h4>
      <p>{task.humanSummary}</p>
      {task.humanActions.length > 0 && <details className="use-case-details">
        <summary>Human prerequisites {task.humanActionsCompletedAt ? "· acknowledged" : ""}</summary>
        {task.humanActions.map((item, index) => <article key={index}><p>{item.action}{item.optional ? " (optional)" : ""}</p></article>)}
        {!task.humanActionsCompletedAt && <button className="button secondary compact-button" disabled={saving} onClick={() => update({ humanActionsComplete: true })}>Mark prerequisites complete</button>}
      </details>}
      {task.state === "waiting_for_approval" && <button className="button compact-button" disabled={saving} onClick={() => update({ approve: true })}>Approve task</button>}
      <textarea className="task-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Give feedback or ask for help…" />
      <button className="button secondary compact-button" disabled={saving || !feedback.trim()} onClick={() => update({ feedback })}>Save feedback</button>
      {message && <p className="form-note">{message}</p>}
    </article>
  );
}

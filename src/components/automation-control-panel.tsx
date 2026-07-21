"use client";

import { useEffect, useState } from "react";

type TimelineEvent = { id: string; event_type: string; payload: Record<string, unknown>; created_at: string };
type Lane = { activeLease: { action: string; taskId: string | null; expiresAt: string } | null; nextAction: string; reason: string };
type Snapshot = { state: "running" | "frozen"; pauseReason: string | null; cooldownUntil: string | null; lastActionAt: string | null; lanes: { planning: Lane; delivery: Lane }; events: TimelineEvent[] };

export function AutomationControlPanel({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [cycling, setCycling] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    const response = await fetch(`/api/projects/${projectId}/automation`, { cache: "no-store" });
    if (response.ok) setSnapshot(await response.json() as Snapshot);
  };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 4000); return () => clearInterval(timer); }, [projectId]);
  // A trusted scheduler is used in production, but keep the automatic flow
  // advancing during an open project session as well. Durable leases prevent
  // this fallback from duplicating work when the scheduler is also running.
  useEffect(() => {
    if (snapshot?.state !== "running") return;
    let busy = false;
    const runAutomaticCycle = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`/api/projects/${projectId}/automation/cycle`, { method: "POST" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? "Automatic automation cycle failed.");
        }
      } catch {
        setError("Automatic automation cycle could not reach the server.");
      } finally {
        busy = false;
      }
    };
    void runAutomaticCycle();
    const timer = window.setInterval(() => void runAutomaticCycle(), 15_000);
    return () => window.clearInterval(timer);
  }, [projectId, snapshot?.state]);
  const toggle = async () => {
    if (!snapshot) return;
    setPending(true); setError("");
    const next = snapshot.state === "running" ? "frozen" : "running";
    const response = await fetch(`/api/projects/${projectId}/automation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next }) });
    if (!response.ok) setError((await response.json().catch(() => ({ error: "Could not update automation." }))).error ?? "Could not update automation.");
    await load(); setPending(false);
  };
  const cycle = async () => {
    setCycling(true); setError("");
    const response = await fetch(`/api/projects/${projectId}/automation/cycle`, { method: "POST" });
    const payload = await response.json().catch(() => ({ error: "Could not run automation." }));
    if (!response.ok) setError(payload.error ?? "Could not run automation.");
    await load(); setCycling(false);
  };
  const frozen = snapshot?.state === "frozen";
  return <section className="synthesis-panel automation-control-panel">
    <div className="synthesis-heading"><div><p className="eyebrow">AUTOMATION CONTROL</p><h2>{frozen ? "Automation frozen" : "Automation continuing"}</h2><p className="panel-copy">Planning and delivery are independent sequential lanes.</p></div><div className="automation-actions"><button className="button secondary" onClick={cycle} disabled={!snapshot || pending || cycling || frozen}>{cycling ? "Claiming…" : "Run automation cycle"}</button><button className="button secondary" onClick={toggle} disabled={!snapshot || pending}>{pending ? "Updating…" : frozen ? "Continue automation" : "Freeze automation"}</button></div></div>
    <div className="automation-lanes"><LaneCard title="Planning lane" lane={snapshot?.lanes.planning} /><LaneCard title="Delivery lane" lane={snapshot?.lanes.delivery} /></div>
    {snapshot?.lastActionAt && <p className="automation-next">Last control change: {new Date(snapshot.lastActionAt).toLocaleString()}</p>}
    {snapshot?.cooldownUntil && <p className="form-error">Provider cooldown until {new Date(snapshot.cooldownUntil).toLocaleTimeString()}. No new automation work will start before then.</p>}
    {snapshot?.events?.length ? <ol className="automation-timeline">{snapshot.events.map((event) => <li key={event.id}><strong>{timelineTitle(event)}</strong><span>{timelineDetail(event)}</span><small>{new Date(event.created_at).toLocaleString()}</small></li>)}</ol> : <p className="queue-empty">No automation decisions have been recorded yet.</p>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}

function LaneCard({ title, lane }: { title: string; lane: Lane | undefined }) {
  return <article className="automation-lane"><strong>{title}</strong><p>{lane?.reason ?? "Loading…"}</p><small>Next: {lane?.nextAction ?? "loading"}{lane?.activeLease ? ` · active ${lane.activeLease.action}` : ""}</small></article>;
}

function timelineTitle(event: TimelineEvent) {
  if (event.event_type === "planning_triggered") return "Planner check triggered";
  if (event.event_type === "planning_clarification") return "Planner asked a clarification";
  if (event.event_type === "planning_no_work") return "Planner decided no task is needed";
  if (event.event_type === "task_proposed") return "Planner proposed a task";
  if (event.event_type === "automation_execution_started") return "Delivery started task execution";
  if (event.event_type === "automation_evaluation_started") return "Delivery started bot evaluation";
  if (event.event_type === "automation_claimed") return "Automation lane started work";
  if (event.event_type === "automation_skipped") return "Automation lane had no eligible work";
  if (event.event_type === "automation_evaluated") return "Bot evaluation completed";
  if (event.event_type === "automation_rate_limited") return "Automation entered provider cooldown";
  if (event.event_type === "automation_lease_recovered") return "Recovered an expired automation lease";
  if (event.event_type === "automation_heartbeat_failed") return "Automation lease heartbeat failed";
  if (event.event_type === "automation_recovery_requires_human") return "Recovered execution needs human acknowledgement";
  return event.event_type === "automation_frozen" ? "Automation frozen" : "Automation continued";
}

function timelineDetail(event: TimelineEvent) {
  const payload = event.payload ?? {};
  if (event.event_type === "planning_triggered") {
    const inputs = (payload.inputs ?? {}) as Record<string, unknown>;
    return `Trigger: ${payload.trigger ?? "unknown"} · ${payload.category ?? "task"} context · ${inputs.repository_tree_paths ?? 0} repository paths · ${inputs.inspected_files ?? 0} inspected files.`;
  }
  if (event.event_type === "automation_claimed" || event.event_type === "automation_skipped") {
    return `${payload.lane ?? "automation"} lane · ${payload.action ?? "idle"} · ${payload.reason ?? "No additional details."}`;
  }
  if (event.event_type === "automation_evaluated") {
    return `Verdict: ${payload.verdict ?? "unknown"} · ${payload.summary ?? "No summary returned."}`;
  }
  if (event.event_type === "automation_execution_started" || event.event_type === "automation_evaluation_started") {
    return `Task ${(typeof payload.task_id === "string" ? payload.task_id.slice(0, 8) : "unknown")} · delivery lane.`;
  }
  if (event.event_type === "automation_rate_limited") return `Cooldown until ${payload.cooldown_until ?? "a later scheduler cycle"} · ${payload.reason ?? "Provider rate limit."}`;
  return String(payload.reason ?? payload.question ?? payload.rationale ?? "Recorded for this project.");
}

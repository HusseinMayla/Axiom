"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AutomationSnapshotResponse = {
  state: "running" | "frozen";
  projectState?: string;
  pauseReason: string | null;
  cooldownUntil: string | null;
  lastActionAt: string | null;
  lanes: {
    planning: {
      activeLease: { action: "propose" | "execute" | "evaluate"; taskId: string | null; expiresAt: string } | null;
      nextAction: "propose" | "execute" | "evaluate" | "idle";
      reason: string;
    };
    delivery: {
      activeLease: { action: "propose" | "execute" | "evaluate"; taskId: string | null; expiresAt: string } | null;
      nextAction: "propose" | "execute" | "evaluate" | "idle";
      reason: string;
    };
  };
  events?: Array<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
};

type ResultOutcome = {
  id: string;
  type: "proposed_task" | "question" | "validated_work";
  title: string;
  detail: string;
  timestamp: string;
  expiresAt?: number;
};

export function AiPlannerStatusWidget({
  projectId,
  initialState = "running",
}: {
  projectId: string;
  initialState?: "running" | "frozen" | null;
}) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcomes, setOutcomes] = useState<ResultOutcome[]>([]);
  const lastAutoCycleKey = useRef<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/automation`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as AutomationSnapshotResponse;
      setSnapshot(data);
      setLoading(false);

      // Derive persistent, deduplicated outcomes from recent events
      if (data.events) {
        const derivedOutcomes: ResultOutcome[] = [];
        const seenKeys = new Set<string>();

        for (const ev of data.events) {
          const payload = ev.payload ?? {};
          let outcome: ResultOutcome | null = null;
          const dedupeKey = `${ev.event_type}-${payload.reason ?? payload.question ?? payload.task_id ?? ev.id}`;

          if (seenKeys.has(dedupeKey)) continue;

          if (ev.event_type === "task_proposed") {
            outcome = {
              id: ev.id,
              type: "proposed_task",
              title: "Task Proposed",
              detail: String(payload.claimed_reason ?? payload.reason ?? "A task proposal was created for human approval."),
              timestamp: ev.created_at,
            };
          } else if (ev.event_type === "planning_clarification") {
            outcome = {
              id: ev.id,
              type: "question",
              title: "Clarification Needed",
              detail: String(payload.question ?? "Planner asked a clarifying question."),
              timestamp: ev.created_at,
            };
          } else if (ev.event_type === "automation_evaluated") {
            outcome = {
              id: ev.id,
              type: "validated_work",
              title: payload.verdict === "pass" ? "Bot Review Passed" : "Bot Review Feedback",
              detail: String(payload.summary ?? payload.reason ?? "Completed AI evaluation check."),
              timestamp: ev.created_at,
            };
          }

          if (outcome) {
            if (outcome.expiresAt && outcome.expiresAt < Date.now()) continue;
            seenKeys.add(dedupeKey);
            derivedOutcomes.push(outcome);
            if (derivedOutcomes.length >= 3) break;
          }
        }
        setOutcomes(derivedOutcomes);
      }
    } catch (err) {
      console.error("Could not load planner status", err);
    }
  }, [projectId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadSnapshot(), 0);
    const timer = setInterval(loadSnapshot, 4000);
    return () => { window.clearTimeout(initialLoad); clearInterval(timer); };
  }, [loadSnapshot]);

  const wakeAutomation = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/automation/cycle`, { method: "POST" });
    if (!response.ok) console.error("Axiom could not wake its automation queue", await response.json().catch(() => ({ error: "Unknown automation error." })));
    await loadSnapshot();
  }, [loadSnapshot, projectId]);

  useEffect(() => {
    const nextPlanning = snapshot?.lanes.planning.nextAction;
    const nextDelivery = snapshot?.lanes.delivery.nextAction;
    const shouldWake = snapshot?.state === "running"
      && snapshot.projectState !== "completed"
      && !snapshot.cooldownUntil
      && [nextPlanning, nextDelivery].some((action) => action === "propose" || action === "execute" || action === "evaluate");
    if (!shouldWake) {
      lastAutoCycleKey.current = null;
      return;
    }
    const key = [nextPlanning, nextDelivery, snapshot?.events?.[0]?.id ?? "", snapshot?.lanes.delivery.reason ?? ""].join(":");
    if (lastAutoCycleKey.current === key) return;
    lastAutoCycleKey.current = key;
    void wakeAutomation();
  }, [snapshot, wakeAutomation]);

  const state = snapshot?.state ?? initialState ?? "running";
  const isFrozen = state === "frozen";
  const projectCompleted = snapshot?.projectState === "completed";
  // The server returns a cooldown timestamp only while it remains active.
  const coolingDown = Boolean(snapshot?.cooldownUntil);

  // Determine Planning Activity
  const planningLease = snapshot?.lanes.planning.activeLease;
  const isPlanning = planningLease?.action === "propose";

  let planningStatusLabel = "Sleeping";
  let planningStatusClass = "status-idle";
  let planningDetail = "Awaiting next cycle or trigger";

  if (projectCompleted) {
    planningStatusLabel = "Project Complete";
    planningStatusClass = "status-frozen";
    planningDetail = "A human marked this project complete. Resume it to plan more work.";
  } else if (isFrozen) {
    planningStatusLabel = "Frozen";
    planningStatusClass = "status-frozen";
    planningDetail = snapshot?.pauseReason ?? "Automation paused by human";
  } else if (coolingDown) {
    planningStatusLabel = "Server is busy";
    planningStatusClass = "status-cooldown";
    planningDetail = "Server is busy: Rate limit per minute reached";
  } else if (isPlanning) {
    planningStatusLabel = "Planning Work";
    planningStatusClass = "status-active";
    planningDetail = "Scanning repo & calling AI planner...";
  } else if (snapshot?.lanes.planning.reason) {
    planningDetail = snapshot.lanes.planning.reason;
    if (snapshot.lanes.planning.reason.includes("already being claimed")) {
      planningStatusLabel = "Checking Scope";
      planningStatusClass = "status-active";
    } else if (snapshot.lanes.planning.reason.includes("Rate limit per minute") || snapshot.lanes.planning.reason.includes("cooling down")) {
      planningStatusLabel = "Server is busy";
      planningStatusClass = "status-cooldown";
    }
  }

  // Determine Delivery Activity
  const deliveryLease = snapshot?.lanes.delivery.activeLease;
  const isExecuting = deliveryLease?.action === "execute";
  const isEvaluating = deliveryLease?.action === "evaluate";

  let deliveryStatusLabel = "Idle";
  let deliveryStatusClass = "status-idle";
  let deliveryDetail = "No delivery task active";

  if (projectCompleted) {
    deliveryStatusLabel = "Project Complete";
    deliveryStatusClass = "status-frozen";
    deliveryDetail = "Task execution is disabled until the project is resumed.";
  } else if (isFrozen) {
    deliveryStatusLabel = "Frozen";
    deliveryStatusClass = "status-frozen";
    deliveryDetail = "Delivery lane paused";
  } else if (coolingDown) {
    deliveryStatusLabel = "Server is busy";
    deliveryStatusClass = "status-cooldown";
    deliveryDetail = "Server is busy: Provider minute limit active";
  } else if (isExecuting) {
    deliveryStatusLabel = "Executing Task";
    deliveryStatusClass = "status-executing";
    deliveryDetail = "Developer harness running code changes...";
  } else if (isEvaluating) {
    deliveryStatusLabel = "Validating Work";
    deliveryStatusClass = "status-evaluating";
    deliveryDetail = "AI Reviewer evaluating task outputs...";
  } else if (snapshot?.lanes.delivery.reason) {
    deliveryDetail = snapshot.lanes.delivery.reason;
    if (deliveryDetail.includes("daily cap") || deliveryDetail.includes("API rate limit reached") || deliveryDetail.includes("Daily limit")) {
      deliveryStatusLabel = "API rate limit reached";
      deliveryStatusClass = "status-frozen";
    } else if (deliveryDetail.includes("waiting for bot or human review")) {
      deliveryStatusLabel = "Waiting Approval";
      deliveryStatusClass = "status-waiting";
    } else if (deliveryDetail.includes("approved task is eligible")) {
      deliveryStatusLabel = "Queued to Run";
      deliveryStatusClass = "status-waiting";
    }
  }

  return (
    <div className="ai-planner-widget">
      <div className="planner-widget-header">
        <div className="planner-widget-title">
          <span className="planner-icon">🤖</span>
          <span>AI ENGINE STATUS</span>
        </div>
        <span className={`planner-state-badge ${projectCompleted || isFrozen ? "frozen" : coolingDown ? "cooldown" : "running"}`}>
          {projectCompleted ? "COMPLETE" : isFrozen ? "FROZEN" : coolingDown ? "COOLDOWN" : "ACTIVE"}
        </span>
      </div>

      {loading && !snapshot ? (
        <div className="planner-widget-loading">
          <span className="spinner-dot" /> Connecting to AI engine...
        </div>
      ) : (
        <div className="planner-lanes-container">
          {/* Planning Lane Indicator */}
          <div className={`planner-lane-card ${planningStatusClass}`}>
            <div className="lane-header">
              <span className="lane-dot" />
              <span className="lane-name">Planning Lane</span>
              <span className="lane-badge">{planningStatusLabel}</span>
            </div>
            <p className="lane-detail" title={planningDetail}>{planningDetail}</p>
          </div>

          {/* Delivery Lane Indicator */}
          <div className={`planner-lane-card ${deliveryStatusClass}`}>
            <div className="lane-header">
              <span className="lane-dot" />
              <span className="lane-name">Delivery Lane</span>
              <span className="lane-badge">{deliveryStatusLabel}</span>
            </div>
            <p className="lane-detail" title={deliveryDetail}>{deliveryDetail}</p>
          </div>

          {/* Persistent Results Card Section */}
          {outcomes.length > 0 && (
            <div className="planner-outcomes-section">
              <div className="outcomes-header">RECENT OUTCOMES</div>
              <div className="outcomes-list">
                {outcomes.map((item) => (
                  <div key={item.id} className={`outcome-card outcome-${item.type}`}>
                    <div className="outcome-top">
                      <strong className="outcome-title">{item.title}</strong>
                      <span className="outcome-time">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="outcome-detail">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

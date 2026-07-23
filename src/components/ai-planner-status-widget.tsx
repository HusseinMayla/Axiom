"use client";

import { useEffect, useState } from "react";

type AutomationSnapshotResponse = {
  state: "running" | "frozen";
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
  type: "proposed_task" | "question" | "no_work" | "validated_work";
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

  useEffect(() => {
    let mounted = true;
    const fetchSnapshot = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/automation`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as AutomationSnapshotResponse;
        if (!mounted) return;
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
            } else if (ev.event_type === "planning_no_work") {
              outcome = {
                id: ev.id,
                type: "no_work",
                title: "No Task Needed",
                detail: String(payload.reason ?? "Current project scope requires no new tasks."),
                timestamp: ev.created_at,
                expiresAt: new Date(ev.created_at).getTime() + 15_000,
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
    };

    void fetchSnapshot();
    const timer = setInterval(fetchSnapshot, 4000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [projectId]);

  const state = snapshot?.state ?? initialState ?? "running";
  const isFrozen = state === "frozen";
  const coolingDown = Boolean(snapshot?.cooldownUntil && new Date(snapshot.cooldownUntil).getTime() > Date.now());

  // Determine Planning Activity
  const planningLease = snapshot?.lanes.planning.activeLease;
  const isPlanning = planningLease?.action === "propose";

  let planningStatusLabel = "Sleeping";
  let planningStatusClass = "status-idle";
  let planningDetail = "Awaiting next cycle or trigger";

  if (isFrozen) {
    planningStatusLabel = "Frozen";
    planningStatusClass = "status-frozen";
    planningDetail = snapshot?.pauseReason ?? "Automation paused by human";
  } else if (coolingDown) {
    planningStatusLabel = "Cooling Down";
    planningStatusClass = "status-cooldown";
    planningDetail = "Provider rate limit cooldown active";
  } else if (isPlanning) {
    planningStatusLabel = "Planning Work";
    planningStatusClass = "status-active";
    planningDetail = "Scanning repo & calling AI planner...";
  } else if (snapshot?.lanes.planning.reason) {
    planningDetail = snapshot.lanes.planning.reason;
    if (snapshot.lanes.planning.reason.includes("already being claimed")) {
      planningStatusLabel = "Checking Scope";
      planningStatusClass = "status-active";
    }
  }

  // Determine Delivery Activity
  const deliveryLease = snapshot?.lanes.delivery.activeLease;
  const isExecuting = deliveryLease?.action === "execute";
  const isEvaluating = deliveryLease?.action === "evaluate";

  let deliveryStatusLabel = "Idle";
  let deliveryStatusClass = "status-idle";
  let deliveryDetail = "No delivery task active";

  if (isFrozen) {
    deliveryStatusLabel = "Frozen";
    deliveryStatusClass = "status-frozen";
    deliveryDetail = "Delivery lane paused";
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
    if (deliveryDetail.includes("waiting for bot or human review")) {
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
        <span className={`planner-state-badge ${isFrozen ? "frozen" : coolingDown ? "cooldown" : "running"}`}>
          {isFrozen ? "FROZEN" : coolingDown ? "COOLDOWN" : "ACTIVE"}
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

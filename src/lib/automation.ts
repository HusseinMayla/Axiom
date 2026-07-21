export type AutomationState = "running" | "frozen";
export type AutomationSnapshot = {
  state: AutomationState;
  pauseReason: string | null;
  cooldownUntil: string | null;
  lastActionAt: string | null;
  lanes: {
    planning: LaneSnapshot;
    delivery: LaneSnapshot;
  };
};
export type LaneSnapshot = { activeLease: { action: "propose" | "execute" | "evaluate"; taskId: string | null; expiresAt: string } | null; nextAction: "propose" | "execute" | "evaluate" | "idle"; reason: string };

export function automationState(value: unknown): AutomationState {
  return value === "frozen" ? "frozen" : "running";
}

export function automationSnapshot({
  state,
  pauseReason,
  lastActionAt,
  cooldownUntil,
  leases,
  hasReview,
  hasQueuedTask,
  canPropose,
}: {
  state: unknown;
  pauseReason: unknown;
  lastActionAt: unknown;
  cooldownUntil: unknown;
  leases: Array<{ lane: string; action: string; task_id: string | null; expires_at: string }>;
  hasReview: boolean;
  hasQueuedTask: boolean;
  canPropose: boolean;
}): AutomationSnapshot {
  const normalizedState = automationState(state);
  const laneLease = (lane: "planning" | "delivery") => {
    const lease = leases.find((candidate) => candidate.lane === lane);
    return lease && (lease.action === "propose" || lease.action === "execute" || lease.action === "evaluate") ? { action: lease.action as "propose" | "execute" | "evaluate", taskId: lease.task_id, expiresAt: lease.expires_at } : null;
  };
  const planningLease = laneLease("planning");
  const deliveryLease = laneLease("delivery");
  const frozenReason = "Automation is frozen by a human.";
  const coolingDown = typeof cooldownUntil === "string" && new Date(cooldownUntil).getTime() > Date.now();
  const cooldownReason = coolingDown ? "Automation is cooling down until " + cooldownUntil + "." : "";
  const planning: LaneSnapshot = normalizedState === "frozen" ? { activeLease: planningLease, nextAction: "idle", reason: frozenReason } : coolingDown ? { activeLease: planningLease, nextAction: "idle", reason: cooldownReason } : planningLease ? { activeLease: planningLease, nextAction: "idle", reason: "A planner check is already active." } : canPropose ? { activeLease: null, nextAction: "propose", reason: "A scope is eligible for an automatic proposal check." } : { activeLease: null, nextAction: "idle", reason: "No eligible general or feature scope needs planning." };
  const delivery: LaneSnapshot = normalizedState === "frozen" ? { activeLease: deliveryLease, nextAction: "idle", reason: frozenReason } : coolingDown ? { activeLease: deliveryLease, nextAction: "idle", reason: cooldownReason } : deliveryLease ? { activeLease: deliveryLease, nextAction: "idle", reason: "A delivery action is already active." } : hasReview ? { activeLease: null, nextAction: "idle", reason: "A branch is waiting for bot or human review." } : hasQueuedTask ? { activeLease: null, nextAction: "execute", reason: "An approved task is eligible for the queue runner." } : { activeLease: null, nextAction: "idle", reason: "No approved task is waiting for execution." };
  return { state: normalizedState, pauseReason: typeof pauseReason === "string" ? pauseReason : null, cooldownUntil: coolingDown ? cooldownUntil : null, lastActionAt: typeof lastActionAt === "string" ? lastActionAt : null, lanes: { planning, delivery } };
}

export type HumanPrerequisite = {
  id: string;
  action: string;
  optional: boolean;
  rationale: string;
  verificationGuidance: string;
  acknowledgedAt: string | null;
};

export function normalizeHumanPrerequisites(value: unknown): HumanPrerequisite[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const action = item as Record<string, unknown>;
    if (typeof action.action !== "string" || !action.action.trim()) return [];
    return [{
      id: typeof action.id === "string" && action.id.trim() ? action.id : "human-action-" + (index + 1),
      action: action.action.trim(),
      optional: action.optional === true,
      rationale: typeof action.rationale === "string" ? action.rationale : "",
      verificationGuidance: typeof action.verification_guidance === "string" ? action.verification_guidance : "",
      acknowledgedAt: typeof action.acknowledged_at === "string" ? action.acknowledged_at : null,
    }];
  });
}

export function serializeHumanPrerequisites(actions: HumanPrerequisite[]) {
  return actions.map((action) => ({
    id: action.id,
    action: action.action,
    optional: action.optional,
    rationale: action.rationale,
    verification_guidance: action.verificationGuidance,
    acknowledged_at: action.acknowledgedAt,
  }));
}

export function hasPendingRequiredPrerequisites(actions: HumanPrerequisite[]) {
  return actions.some((action) => !action.optional && !action.acknowledgedAt);
}

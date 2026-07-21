import { describe, expect, it } from "vitest";
import { hasPendingRequiredPrerequisites, normalizeHumanPrerequisites, serializeHumanPrerequisites } from "./human-prerequisites";

describe("human prerequisites", () => {
  it("normalizes older action records and blocks unacknowledged required work", () => {
    const actions = normalizeHumanPrerequisites([{ action: "Add STRIPE_SECRET_KEY locally", optional: false }]);

    expect(actions[0]).toMatchObject({ id: "human-action-1", acknowledgedAt: null });
    expect(hasPendingRequiredPrerequisites(actions)).toBe(true);
  });

  it("allows optional or acknowledged actions and preserves no secret value", () => {
    const actions = normalizeHumanPrerequisites([
      { id: "one", action: "Create payment account", optional: false, acknowledged_at: "2026-07-19T00:00:00.000Z" },
      { id: "two", action: "Add optional analytics key", optional: true },
    ]);

    expect(hasPendingRequiredPrerequisites(actions)).toBe(false);
    expect(serializeHumanPrerequisites(actions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "one", acknowledged_at: "2026-07-19T00:00:00.000Z" }),
    ]));
  });
});

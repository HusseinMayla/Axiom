import { describe, expect, it } from "vitest";
import { planningScopeBlocker } from "@/lib/automation-eligibility";

describe("planning scope eligibility", () => {
  it("keeps a feature clarification local to that feature", () => {
    const questions = [{ feature_id: "feature-a" }];

    expect(planningScopeBlocker({ category: "feature", featureId: "feature-a" }, [], questions)).toBe("clarification");
    expect(planningScopeBlocker({ category: "feature", featureId: "feature-b" }, [], questions)).toBeNull();
    expect(planningScopeBlocker({ category: "general" }, [], questions)).toBeNull();
  });

  it("keeps a project-wide clarification local to general planning", () => {
    const questions = [{ feature_id: null }];

    expect(planningScopeBlocker({ category: "general" }, [], questions)).toBe("clarification");
    expect(planningScopeBlocker({ category: "feature", featureId: "feature-a" }, [], questions)).toBeNull();
  });

  it("keeps waiting task proposals local to their scope", () => {
    const tasks = [
      { category: "general", feature_id: null },
      { category: "feature", feature_id: "feature-a" },
    ];

    expect(planningScopeBlocker({ category: "general" }, tasks, [])).toBe("task");
    expect(planningScopeBlocker({ category: "feature", featureId: "feature-a" }, tasks, [])).toBe("task");
    expect(planningScopeBlocker({ category: "feature", featureId: "feature-b" }, tasks, [])).toBeNull();
  });
});

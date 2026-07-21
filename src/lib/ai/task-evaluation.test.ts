import { describe, expect, it, vi } from "vitest";

const createInteraction = vi.hoisted(() => vi.fn());

vi.mock("./gemini", () => ({
  createGeminiClient: () => ({ interactions: { create: createInteraction } }),
  getGeminiModel: () => "test-model",
  withGeminiRateLimitRetry: <T>(operation: () => Promise<T>) => operation(),
}));

import { reviewTask } from "./task-execution";

const input = {
  task: {
    objective: "Add a payment settings screen",
    developerPrompt: "Implement the settings screen in the existing route.",
    allowedPaths: ["src/app/settings"],
    acceptanceCriteria: ["The screen renders payment settings."],
    validationCommands: ["npm test"],
  },
  projectStatus: { implementation_state: "in_progress" },
  featureStatus: { implementation_state: "not_started" },
  diff: "diff --git a/src/app/settings/page.tsx b/src/app/settings/page.tsx",
  diffStat: "1 changed path(s): src/app/settings/page.tsx",
  changedPaths: ["src/app/settings/page.tsx"],
  validationResults: [{ command: "npm test", exitCode: 0, output: "passed" }],
  executionEvents: [{ step: 4, tool_name: "write_files", status: "completed" }],
  report: { summary: "Added payment settings." },
};

describe("result evaluator", () => {
  it("returns pass and receives the net change evidence", async () => {
    createInteraction.mockResolvedValueOnce({ output_text: JSON.stringify({ verdict: "pass", summary: "Criteria are met.", feedback: [] }) });

    await expect(reviewTask(input)).resolves.toMatchObject({ verdict: "pass" });
    const request = createInteraction.mock.calls[0][0] as { input: string };
    expect(request.input).toContain("Project current status");
    expect(request.input).toContain("Feature current status");
    expect(request.input).toContain("Diff stat");
    expect(request.input).toContain("Relevant execution events");
  });

  it("returns criterion-specific retry feedback", async () => {
    createInteraction.mockResolvedValueOnce({ output_text: JSON.stringify({
      verdict: "retry",
      summary: "The screen is missing its required setting control.",
      feedback: ["Acceptance criterion 'The screen renders payment settings' lacks evidence in src/app/settings/page.tsx."],
    }) });

    await expect(reviewTask(input)).resolves.toMatchObject({ verdict: "retry" });
  });
});

import { describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());

vi.mock("./gemini", () => ({
  createGeminiClient: () => ({ models: { generateContent } }),
  getGeminiModel: () => "test-model",
  resolveConfiguredGeminiModel: () => "test-model",
  withGeminiRateLimitRetry: <T>(operation: () => Promise<T>) => operation(),
}));

import { requestDeveloperToolCalls } from "./task-execution";

const report = {
  summary: "The requested implementation is complete.",
  files_created: [],
  files_modified: ["src/example.ts"],
  modules_or_interfaces: [],
  schema_or_configuration: [],
  behavior_delivered: ["Delivered the requested behavior."],
  validation_results: ["npm test: passed"],
  known_limitations: [],
  handoff: "Ready for review.",
};

describe("developer turn budget", () => {
  it("restricts the thirtieth decision to finish_task", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: "model", parts: [] } }],
      functionCalls: [{ id: "final", name: "finish_task", args: { report } }],
      text: "",
    });

    const result = await requestDeveloperToolCalls([{ role: "user", parts: [{ text: "task" }] }], 30, 30, "src");

    expect(result.calls[0]?.name).toBe("finish_task");
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        toolConfig: {
          functionCallingConfig: expect.objectContaining({
            allowedFunctionNames: ["finish_task"],
          }),
        },
      }),
    }));
  });

  it("keeps all declared tools available before the final decision", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: "model", parts: [] } }],
      functionCalls: [{ id: "read", name: "inspect_files", args: { paths: ["src"] } }],
      text: "",
    });

    await requestDeveloperToolCalls([{ role: "user", parts: [{ text: "task" }] }], 4, 30, "src");

    expect(generateContent).toHaveBeenLastCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        toolConfig: {
          functionCallingConfig: expect.objectContaining({
            allowedFunctionNames: undefined,
          }),
        },
      }),
    }));
  });
});

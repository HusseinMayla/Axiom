import { describe, expect, it } from "vitest";
import { createDeveloperConversation, parseDeveloperToolCall } from "./task-execution";

const task = {
  objective: "Add a focused test harness",
  developerPrompt: "Implement one focused test harness change and validate it.",
  allowedPaths: ["src"],
  acceptanceCriteria: ["The test harness runs."],
  validationCommands: ["npm test"],
};

describe("developer function calls", () => {
  it("accepts a well-formed native inspect call", () => {
    expect(parseDeveloperToolCall({
      id: "call-1",
      name: "inspect_files",
      args: { paths: ["src/lib/ai/gemini.ts"] },
    })).toEqual([{
      id: "call-1",
      name: "inspect_files",
      args: { paths: ["src/lib/ai/gemini.ts"] },
    }]);
  });

  it("rejects an undeclared function rather than treating model text as executable", () => {
    expect(parseDeveloperToolCall({ name: "shell", args: { command: "rm -rf /" } })).toEqual([]);
  });

  it("rejects malformed write arguments", () => {
    expect(parseDeveloperToolCall({
      name: "write_files",
      args: { edits: [{ path: "src/a.ts", content: "export {}" }] },
    })).toEqual([]);
  });

  it("provides the task, workspace tree, and ignore list before the first tool decision", () => {
    const conversation = createDeveloperConversation({
      task,
      projectStatus: { implementation_state: "in_progress" },
      featureStatus: { implementation_state: "not_started" },
      workspaceTree: "package.json\nsrc\nsrc/lib",
      workspaceIgnoreList: ["node_modules (installed package contents)", ".env* (secrets)"],
    });
    const prompt = conversation[0].parts?.[0].text ?? "";

    expect(prompt).toContain("Add a focused test harness");
    expect(prompt).toContain("package.json\nsrc\nsrc/lib");
    expect(prompt).toContain("node_modules (installed package contents)");
    expect(prompt).toContain("Do not spend a run_command turn on ls");
    expect(prompt).toContain("planning guidance, not a write restriction");
    expect(prompt).toContain("any safe source or configuration file");
  });
});

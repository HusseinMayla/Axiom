import { describe, expect, it } from "vitest";
import { WORKSPACE_TREE_IGNORES } from "./runner";

describe("workspace inspection policy", () => {
  it("tells the agent that dependency, generated, repository, and secret paths are excluded", () => {
    expect(WORKSPACE_TREE_IGNORES.join("\n")).toContain("node_modules");
    expect(WORKSPACE_TREE_IGNORES.join("\n")).toContain(".git");
    expect(WORKSPACE_TREE_IGNORES.join("\n")).toContain("generated output");
    expect(WORKSPACE_TREE_IGNORES.join("\n")).toContain("secrets and credentials");
  });
});

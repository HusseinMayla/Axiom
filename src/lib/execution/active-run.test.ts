import { describe, expect, it, vi } from "vitest";

const runDocker = vi.hoisted(() => vi.fn());

vi.mock("./docker", () => ({ runDocker }));

import { assertRunActive, cancelActiveRun, ExecutionCancelledError, finishActiveRun, hasActiveRun, setActiveRunContainer, startActiveRun } from "./active-run";

describe("active execution registry", () => {
  it("signals cancellation to an active run", async () => {
    const taskId = "task-cancel-test";
    const run = startActiveRun(taskId);

    expect(await cancelActiveRun(taskId)).toBe(true);
    expect(() => assertRunActive(run)).toThrow(ExecutionCancelledError);

    finishActiveRun(taskId);
    expect(await cancelActiveRun(taskId)).toBe(false);
  });

  it("leaves an active run usable until cancellation", () => {
    const taskId = "task-active-test";
    const run = startActiveRun(taskId);

    expect(() => assertRunActive(run)).not.toThrow();
    finishActiveRun(taskId);
  });

  it("does not let a second request replace an active run", () => {
    const taskId = "task-duplicate-test";
    startActiveRun(taskId);

    expect(hasActiveRun(taskId)).toBe(true);
    expect(() => startActiveRun(taskId)).toThrow("already has an active execution");

    finishActiveRun(taskId);
  });

  it("removes the active Docker container when a human cancels", async () => {
    runDocker.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const taskId = "task-container-test";
    startActiveRun(taskId);
    setActiveRunContainer(taskId, "axiom-taskcontain");

    await cancelActiveRun(taskId);

    expect(runDocker).toHaveBeenCalledWith(["rm", "-f", "axiom-taskcontain"], 30_000);
    finishActiveRun(taskId);
  });
});

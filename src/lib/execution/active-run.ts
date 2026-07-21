import { runDocker } from "@/lib/execution/docker";

export class ExecutionCancelledError extends Error {
  constructor() {
    super("Task execution was cancelled by a human.");
    this.name = "ExecutionCancelledError";
  }
}

export type ActiveRun = { controller: AbortController; containerName: string | null };

const registryKey = Symbol.for("axiom.active-execution-runs");
const activeRuns = ((globalThis as typeof globalThis & { [registryKey]?: Map<string, ActiveRun> })[registryKey] ??= new Map<string, ActiveRun>());

export function hasActiveRun(taskId: string) {
  return activeRuns.has(taskId);
}

export function startActiveRun(taskId: string) {
  if (hasActiveRun(taskId)) throw new Error("This task already has an active execution.");
  const run: ActiveRun = { controller: new AbortController(), containerName: null };
  activeRuns.set(taskId, run);
  return run;
}

export function setActiveRunContainer(taskId: string, containerName: string) {
  const run = activeRuns.get(taskId);
  if (run) run.containerName = containerName;
}

export function assertRunActive(run: ActiveRun) {
  if (run.controller.signal.aborted) throw new ExecutionCancelledError();
}

export function finishActiveRun(taskId: string) {
  activeRuns.delete(taskId);
}

export async function cancelActiveRun(taskId: string) {
  const run = activeRuns.get(taskId);
  if (!run) return false;
  run.controller.abort();
  if (run.containerName) await runDocker(["rm", "-f", run.containerName], 30_000).catch(() => undefined);
  return true;
}

export function isExecutionCancelled(error: unknown): error is ExecutionCancelledError {
  return error instanceof ExecutionCancelledError;
}

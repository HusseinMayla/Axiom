import { runDocker } from "@/lib/execution/docker";

export class ExecutionCancelledError extends Error {
  constructor() {
    super("Task execution was cancelled by a human.");
    this.name = "ExecutionCancelledError";
  }
}

type PersistedExecutionState = {
  state: string;
  archived_at: string | null;
  automation_lease_owner: string | null;
};

/**
 * The database is the cancellation source of truth for remote workers. An
 * in-memory AbortController only reaches the server process that owns it, so
 * GitHub Actions workers must also fence themselves before doing more work.
 */
export function assertPersistedExecutionIsCurrent(
  task: PersistedExecutionState | null,
  leaseOwner?: string,
) {
  if (!task || task.archived_at || task.state !== "running") {
    throw new ExecutionCancelledError();
  }
  if (leaseOwner && task.automation_lease_owner !== leaseOwner) {
    throw new ExecutionCancelledError();
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

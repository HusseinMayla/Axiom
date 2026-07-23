import { executeNextTask } from "@/app/api/projects/[projectId]/execute-next/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cancelActiveRun } from "@/lib/execution/active-run";
import { evaluateCompletedTask } from "@/lib/task-evaluation-service";
import { isGeminiRateLimitError } from "@/lib/ai/gemini";

const LEASE_TTL_MS = 2 * 60_000;

/**
 * Entry point for an ephemeral remote worker (currently GitHub Actions).
 * The workflow supplies one approved task ID; this process runs that task and
 * exits so the hosted runner and its Docker workspace can be discarded.
 */
async function main() {
  const taskId = process.env.AXIOM_TASK_ID;
  const leaseOwner = process.env.AXIOM_AUTOMATION_LEASE_OWNER?.trim() || null;
  const trigger = process.env.AXIOM_EXECUTION_TRIGGER === "human" ? "human" : "automation";
  if (!taskId) throw new Error("AXIOM_TASK_ID is required.");
  if (trigger === "automation" && !leaseOwner) throw new Error("Automated execution requires its delivery lease owner.");

  const supabase = createSupabaseAdminClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error("Could not load task " + taskId + ": " + error.message);
  if (!task) throw new Error("Task " + taskId + " was not found.");

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  try {
    if (leaseOwner) {
      const heartbeat = async () => {
        const { data, error } = await supabase.rpc("heartbeat_automation_lease", {
          p_project_id: task.project_id,
          p_lane: "delivery",
          p_owner: leaseOwner,
          p_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
        });
        if (error || data !== true) throw new Error(error?.message ?? "Automation lease is no longer owned.");
      };
      await heartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat().catch((error) => {
          console.error("Axiom worker lost its delivery lease", error);
          void cancelActiveRun(taskId);
        });
      }, 30_000);
    }

    const response = await executeNextTask(supabase, task.project_id, trigger, taskId, leaseOwner ?? undefined, true);
    const body = await response.json().catch(() => null) as { error?: string; message?: string; type?: string } | null;
    if (!response.ok) throw new Error(body?.error ?? body?.message ?? "Worker execution failed.");

    // A GitHub Actions runner is ephemeral. Unlike the local control plane it
    // does not have another request waiting to pick up `pending_review`, so it
    // must complete the AI review before it releases the delivery lease.
    if (body?.type === "pending_review") {
      try {
        const review = await evaluateCompletedTask(supabase, task.project_id, taskId, trigger, leaseOwner ?? undefined);
        console.log(JSON.stringify({ taskId, outcome: "reviewed", verdict: review.verdict, nextState: review.nextState }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI validation failed unexpectedly.";
        const rateLimited = isGeminiRateLimitError(error);
        const now = new Date().toISOString();
        let recovery = supabase
          .from("tasks")
          .update({
            state: rateLimited ? "approved" : "failed",
            review_feedback: rateLimited
              ? "AI validation is rate-limited. The task was returned to the approved queue for a later retry."
              : "AI validation could not finish: " + message,
            automation_lease_owner: null,
            updated_at: now,
          })
          .eq("id", taskId)
          .eq("project_id", task.project_id);
        if (leaseOwner) recovery = recovery.eq("automation_lease_owner", leaseOwner);
        const { error: recoveryError } = await recovery;
        if (recoveryError) console.error("Axiom worker could not persist AI validation failure", recoveryError);
        await supabase.from("events").insert({
          project_id: task.project_id,
          actor_type: "system",
          event_type: "automation_evaluation_failed",
          payload: { task_id: taskId, rate_limited: rateLimited, reason: message },
        });
        throw error;
      }
    }

    console.log(JSON.stringify({ taskId, outcome: body?.type ?? "completed" }));
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (leaseOwner) {
      const { error } = await supabase.rpc("release_automation_lease", { p_project_id: task.project_id, p_lane: "delivery", p_owner: leaseOwner });
      if (error) console.error("Axiom worker could not release its delivery lease", error);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

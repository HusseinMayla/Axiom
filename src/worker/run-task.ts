import { executeNextTask } from "@/app/api/projects/[projectId]/execute-next/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Entry point for an ephemeral remote worker (currently GitHub Actions).
 * The workflow supplies one approved task ID; this process runs that task and
 * exits so the hosted runner and its Docker workspace can be discarded.
 */
async function main() {
  const taskId = process.env.AXIOM_TASK_ID;
  if (!taskId) throw new Error("AXIOM_TASK_ID is required.");

  const supabase = createSupabaseAdminClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error("Could not load task " + taskId + ": " + error.message);
  if (!task) throw new Error("Task " + taskId + " was not found.");

  const response = await executeNextTask(supabase, task.project_id, "automation", taskId);
  const body = await response.json().catch(() => null) as { error?: string; message?: string; type?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? "Worker execution failed.");

  console.log(JSON.stringify({ taskId, outcome: body?.type ?? "completed" }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

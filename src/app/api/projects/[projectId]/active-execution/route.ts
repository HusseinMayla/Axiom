import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before viewing active execution." }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle();
  const settings = (project?.settings as { developer?: { max_steps?: unknown; model?: unknown }; engineer?: { model?: unknown } } | null);
  const developer = settings?.developer;
  const maxSteps = developer?.max_steps === 60 || developer?.max_steps === 90 || developer?.max_steps === 30 ? developer.max_steps : 30;
  const developerModel = developer?.model === "gemini-3.1-flash-lite" || developer?.model === "gemini-3.5-flash" ? developer.model : "gemini-3.1-flash-lite";
  const engineerModel = settings?.engineer?.model === "gemini-3.1-flash-lite" || settings?.engineer?.model === "gemini-3.5-flash" ? settings.engineer.model : "gemini-3.1-flash-lite";
  const { data: repositoryMap } = await supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const repositoryTree = Array.isArray((repositoryMap?.content as { tree?: unknown } | null)?.tree) ? ((repositoryMap!.content as { tree: unknown[] }).tree.filter((path): path is string => typeof path === "string")) : [];

  // 1. Check for currently running task
  const { data: runningTask } = await supabase
    .from("tasks")
    .select("id, objective, state, execution_attempt_count, branch_name, execution_started_at, updated_at")
    .eq("project_id", projectId)
    .eq("state", "running")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 2. If no running task, fetch the most recent task that has executed steps
  let selectedTask = runningTask;
  if (!selectedTask) {
    const { data: recentTask } = await supabase
      .from("tasks")
      .select("id, objective, state, execution_attempt_count, branch_name, execution_started_at, execution_finished_at, updated_at")
      .eq("project_id", projectId)
      .gt("execution_attempt_count", 0)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    selectedTask = recentTask;
  }

  if (!selectedTask) {
    return Response.json({
      active: false,
      taskRun: null,
      models: { developer: developerModel, engineer: engineerModel },
      repositoryTree,
    });
  }

  // 3. Fetch all execution events for this single task run (from step 1 to last step)
  let eventsQuery = supabase
    .from("task_execution_events")
    .select("id, step, tool_name, tool_args, tool_result, status, created_at, finished_at")
    .eq("project_id", projectId)
    .eq("task_id", selectedTask.id);

  if (selectedTask.execution_started_at) {
    eventsQuery = eventsQuery.gte("created_at", selectedTask.execution_started_at);
  }

  const { data: events } = await eventsQuery.order("created_at", { ascending: true });

  return Response.json({
    active: Boolean(runningTask),
    models: { developer: developerModel, engineer: engineerModel },
    repositoryTree,
    taskRun: {
      id: selectedTask.id,
      objective: selectedTask.objective,
      state: selectedTask.state,
      step: selectedTask.execution_attempt_count,
      maxSteps,
      branchName: selectedTask.branch_name,
      startedAt: selectedTask.execution_started_at,
      finishedAt: (selectedTask as { execution_finished_at?: string | null }).execution_finished_at ?? null,
      events: events ?? [],
    },
  });
}

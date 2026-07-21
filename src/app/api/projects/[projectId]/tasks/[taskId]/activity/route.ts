import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; taskId: string }> },
) {
  const { projectId, taskId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before viewing task activity." }, { status: 401 });

  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, state, execution_attempt_count, execution_started_at, execution_finished_at, developer_report, review_feedback")
    .eq("project_id", projectId)
    .eq("id", taskId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!task) return Response.json({ error: "Task not found." }, { status: 404 });

  let eventsQuery = supabase
    .from("task_execution_events")
    .select("id, step, tool_name, tool_args, tool_result, status, created_at, finished_at")
    .eq("project_id", projectId)
    .eq("task_id", taskId);

  if (task.execution_started_at) {
    eventsQuery = eventsQuery.gte("created_at", task.execution_started_at);
  }

  const { data: events, error: eventsError } = await eventsQuery.order("created_at");
  if (eventsError) return Response.json({ error: eventsError.message }, { status: 500 });

  return Response.json({
    state: task.state,
    step: task.execution_attempt_count,
    startedAt: task.execution_started_at,
    finishedAt: task.execution_finished_at,
    events: events ?? [],
    report: task.developer_report,
    reviewFeedback: task.review_feedback,
  });
}

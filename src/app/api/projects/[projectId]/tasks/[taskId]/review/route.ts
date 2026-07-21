import { createSupabaseServerClient } from "@/lib/supabase/server";
import { evaluateCompletedTask } from "@/lib/task-evaluation-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; taskId: string }> },
) {
  const { projectId, taskId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before reviewing a task." }, { status: 401 });

  const [{ data: task }, { data: project }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, state")
      .eq("id", taskId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase.from("projects").select("id, automation_state").eq("id", projectId).maybeSingle(),
  ]);

  if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.automation_state !== "frozen") return Response.json({ error: "Freeze automatic flow before requesting manual AI validation." }, { status: 409 });
  if (task.state !== "pending_review") {
    return Response.json({ error: "Only tasks pending review can be reviewed by the AI Reviewer." }, { status: 409 });
  }

  try {
    const review = await evaluateCompletedTask(supabase, projectId, taskId);
    return Response.json({ ok: true, ...review });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Task evaluation failed." }, { status: 500 });
  }
}

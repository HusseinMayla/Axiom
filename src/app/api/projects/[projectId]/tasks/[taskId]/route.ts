import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateTaskSchema = z.object({
  approve: z.boolean().optional(),
  humanActionsComplete: z.boolean().optional(),
  feedback: z.string().trim().min(1).max(4000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; taskId: string }> },
) {
  const { projectId, taskId } = await params;
  const parsed = updateTaskSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid task update." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before updating a task." }, { status: 401 });

  const { data: task } = await supabase.from("tasks").select("id, state").eq("id", taskId).eq("project_id", projectId).maybeSingle();
  if (!task) return Response.json({ error: "Task not found." }, { status: 404 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.approve) {
    if (task.state !== "waiting_for_approval") return Response.json({ error: "Only a waiting task can be approved." }, { status: 409 });
    update.state = "approved";
  }
  if (parsed.data.humanActionsComplete) update.human_actions_completed_at = new Date().toISOString();
  if (parsed.data.feedback) update.human_feedback = parsed.data.feedback;

  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const eventType = parsed.data.feedback ? "task_feedback" : parsed.data.approve ? "task_approved" : "human_actions_completed";
  await supabase.from("events").insert({
    project_id: projectId,
    actor_type: "human",
    event_type: eventType,
    payload: { task_id: taskId, feedback: parsed.data.feedback ?? null },
  });
  return Response.json({ ok: true });
}

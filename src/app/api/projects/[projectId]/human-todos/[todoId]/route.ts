import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({ status: z.enum(["completed", "cancelled"]), comment: z.string().trim().max(2000).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; todoId: string }> }) {
  const { projectId, todoId } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid worklist update." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before updating the worklist." }, { status: 401 });
  const now = new Date().toISOString();
  const update = parsed.data.status === "completed"
    ? { status: "completed", human_comment: parsed.data.comment, completed_at: now, updated_at: now }
    : { status: "cancelled", human_comment: parsed.data.comment, cancelled_at: now, updated_at: now };
  const { error } = await supabase.from("human_todos").update(update).eq("id", todoId).eq("project_id", projectId).eq("status", "open");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: `human_todo_${parsed.data.status}`, payload: { todo_id: todoId, comment: parsed.data.comment ?? null } });
  return Response.json({ ok: true });
}

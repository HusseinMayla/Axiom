import { z } from "zod";
import { generateHumanTodos } from "@/lib/ai/human-todos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const feedbackSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), comment: z.string().trim().min(1).max(2000) })).min(1).max(12),
});

export async function POST(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before refreshing the worklist." }, { status: 401 });

  const [{ data: project }, { data: rootNode }, { data: features }, { data: tasks }, { data: questions }, { data: priorTodos }] = await Promise.all([
    supabase.from("projects").select("id, state, settings").eq("id", projectId).single(),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("features").select("name, description, status, priority").eq("project_id", projectId).order("priority"),
    supabase.from("tasks").select("objective, state, human_summary, updated_at").eq("project_id", projectId).is("archived_at", null).order("updated_at", { ascending: false }).limit(30),
    supabase.from("clarification_questions").select("question, rationale").eq("project_id", projectId).eq("status", "open"),
    supabase.from("human_todos").select("id, title, human_comment").eq("project_id", projectId).not("human_comment", "is", null).order("updated_at", { ascending: false }).limit(12),
  ]);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.state !== "active" || !rootNode) return Response.json({ error: "Approve project context before generating a human worklist." }, { status: 409 });

  try {
    const model = (project.settings as { engineer?: { model?: unknown } } | null)?.engineer?.model;
    const todos = await generateHumanTodos({ projectContext: rootNode.content, features: features ?? [], tasks: tasks ?? [], clarifications: questions ?? [], priorHumanComments: priorTodos ?? [], model: model === "gemini-3.1-flash-lite" || model === "gemini-3.5-flash" ? model : undefined });
    await supabase.from("human_todos").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("project_id", projectId).eq("status", "open").eq("source", "ai");
    if (todos.length) {
      const { error } = await supabase.from("human_todos").insert(todos.map((todo) => ({ project_id: projectId, ...todo, source: "ai" })));
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type: "human_todos_generated", payload: { count: todos.length } });
    return Response.json({ todos });
  } catch (error) {
    console.error("Axiom could not generate human todos", error);
    return Response.json({ error: "Axiom could not refresh the human worklist. Try again shortly." }, { status: 502 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = feedbackSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Add at least one comment before sending it to Axiom." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before sending direction to Axiom." }, { status: 401 });

  const updatedAt = new Date().toISOString();
  for (const item of parsed.data.items) {
    const { error } = await supabase.from("human_todos").update({ human_comment: item.comment, updated_at: updatedAt }).eq("id", item.id).eq("project_id", projectId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: "human_todo_feedback", payload: { items: parsed.data.items } });
  return Response.json({ ok: true });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  model: z.enum(["gemini-3.1-flash-lite", "gemini-3.5-flash"]),
  engineerModel: z.enum(["gemini-3.1-flash-lite", "gemini-3.5-flash"]),
  maxSteps: z.union([z.literal(30), z.literal(60), z.literal(90)]),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Choose a supported model and developer budget." }, { status: 400 });
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before changing configuration." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const developer = { model: parsed.data.model, max_steps: parsed.data.maxSteps };
  const engineer = { model: parsed.data.engineerModel };
  const { error } = await supabase.from("projects").update({ settings: { ...settings, developer, engineer }, updated_at: new Date().toISOString() }).eq("id", projectId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: "developer_configuration_updated", payload: { developer, engineer } });
  return Response.json({ developer, engineer });
}

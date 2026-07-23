import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAutomationCycle } from "@/lib/automation-cycle";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before running automation." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("state").eq("id", projectId).maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.state === "completed") return Response.json({ error: "Resume the completed project before running automation." }, { status: 409 });
  try {
    const results = await runAutomationCycle({ supabase, projectId, owner: "human-debug-cycle-" + user.id });
    await Promise.all(results
      .filter((result) => result.action !== "idle")
      .map((result) => supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_claimed", payload: result })));
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation cycle failed.";
    await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_cycle_failed", payload: { message } });
    return Response.json({ error: message }, { status: 500 });
  }
}

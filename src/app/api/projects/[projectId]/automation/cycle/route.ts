import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAutomationCycle } from "@/lib/automation-cycle";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before running automation." }, { status: 401 });
  try {
    const results = await runAutomationCycle({ supabase, projectId, owner: "human-debug-cycle-" + user.id });
    for (const result of results) {
      await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: result.action === "idle" ? "automation_skipped" : "automation_claimed", payload: result });
    }
    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Automation cycle failed." }, { status: 500 });
  }
}

import { runAutomationCycle } from "@/lib/automation-cycle";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_TICK_SECRET;
  if (!secret || request.headers.get("authorization") !== "Bearer " + secret) return Response.json({ error: "Unauthorized automation tick." }, { status: 401 });
  try {
    const supabase = createSupabaseAdminClient();
    const { data: projects, error } = await supabase.from("projects").select("id").eq("state", "active").eq("automation_state", "running").limit(100);
    if (error) throw new Error(error.message);
    const results = [];
    for (const project of projects ?? []) {
      const laneResults = await runAutomationCycle({ supabase, projectId: project.id, owner: "scheduler-tick" });
      for (const result of laneResults) {
        await supabase.from("events").insert({ project_id: project.id, actor_type: "system", event_type: result.action === "idle" ? "automation_skipped" : "automation_claimed", payload: { ...result, trigger: "recurring_tick" } });
        results.push({ projectId: project.id, lane: result.lane, action: result.action });
      }
    }
    return Response.json({ ok: true, checked: results.length, results });
  } catch (error) {
    console.error("Automation scheduler tick failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Automation scheduler tick failed." }, { status: 500 });
  }
}

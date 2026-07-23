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
    const results: Array<{ projectId: string; lane: "planning" | "delivery" | null; action: "propose" | "execute" | "evaluate" | "idle" }> = [];
    const failures: Array<{ projectId: string; error: string }> = [];
    for (const project of projects ?? []) {
      try {
        const laneResults = await runAutomationCycle({ supabase, projectId: project.id, owner: "scheduler-tick" });
        for (const result of laneResults) {
          if (result.action !== "idle") await supabase.from("events").insert({ project_id: project.id, actor_type: "system", event_type: "automation_claimed", payload: { ...result, trigger: "recurring_tick" } });
          results.push({ projectId: project.id, lane: result.lane, action: result.action });
        }
      } catch (projectError) {
        const message = projectError instanceof Error ? projectError.message : "Automation cycle failed.";
        console.error("Automation scheduler cycle failed for project", { projectId: project.id, error: message });
        await supabase.from("events").insert({ project_id: project.id, actor_type: "system", event_type: "automation_cycle_failed", payload: { message, trigger: "recurring_tick" } });
        failures.push({ projectId: project.id, error: message });
      }
    }
    return Response.json({ ok: failures.length === 0, checked: results.length, failures, results });
  } catch (error) {
    console.error("Automation scheduler tick failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Automation scheduler tick failed." }, { status: 500 });
  }
}

import { after } from "next/server";
import { z } from "zod";
import { runAutomationCycle } from "@/lib/automation-cycle";
import { updateProjectImplementationState } from "@/lib/project-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({ state: z.enum(["active", "completed"]) });
const ACTIVE_TASK_STATES = ["planned", "waiting_for_approval", "approved", "queued", "running", "pending_review", "waiting_for_human_approval", "failed"];

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Choose whether to resume or complete this project." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before changing the project state." }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, state, automation_state")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  if (parsed.data.state === "completed") {
    const { data: activeTask } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .in("state", ACTIVE_TASK_STATES)
      .is("archived_at", null)
      .maybeSingle();
    if (activeTask) return Response.json({ error: "Resolve active tasks before marking the project complete." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("projects")
    .update({ state: parsed.data.state, updated_at: now })
    .eq("id", projectId);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  await updateProjectImplementationState({
    supabase,
    projectId,
    state: parsed.data.state === "completed" ? "completed" : "in_progress",
    summary: parsed.data.state === "completed" ? "Human marked this project complete." : "Human resumed this project for additional development.",
  });

  const eventType = parsed.data.state === "completed" ? "project_completed_by_human" : "project_resumed_by_human";
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: eventType, payload: { project_name: project.name } });

  if (parsed.data.state === "active" && project.automation_state === "running") {
    after(async () => {
      try {
        const results = await runAutomationCycle({ supabase, projectId, owner: "project-resumed-" + user.id });
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_woken_by_project_resume", payload: { results } });
      } catch (error) {
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_wake_failed", payload: { reason: error instanceof Error ? error.message : "Automation wake-up failed after project resume." } });
      }
    });
  }

  return Response.json({ ok: true, state: parsed.data.state });
}

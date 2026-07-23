import { z } from "zod";
import { after } from "next/server";
import { automationSnapshot } from "@/lib/automation";
import { runAutomationCycle } from "@/lib/automation-cycle";
import { isPlanningScopeEligible } from "@/lib/automation-eligibility";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({ state: z.enum(["running", "frozen"]), reason: z.string().trim().min(1).max(500).optional() });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before viewing automation." }, { status: 401 });
  const [{ data: project }, { data: tasks }, { data: features }, { data: questions }, { data: leases }, { data: events }] = await Promise.all([
    supabase.from("projects").select("state, automation_state, automation_pause_reason, automation_cooldown_until, automation_last_action_at, automation_daily_run_limit, automation_run_day, automation_runs_today").eq("id", projectId).maybeSingle(),
    supabase.from("tasks").select("state, category, feature_id, archived_at").eq("project_id", projectId).is("archived_at", null),
    supabase.from("features").select("id").eq("project_id", projectId).in("status", ["active", "in_development"]),
    supabase.from("clarification_questions").select("feature_id").eq("project_id", projectId).eq("status", "open"),
    supabase.from("automation_leases").select("lane, action, task_id, expires_at").eq("project_id", projectId).gt("expires_at", new Date().toISOString()),
    supabase.from("events").select("id, event_type, payload, created_at").eq("project_id", projectId).in("event_type", ["planning_triggered", "planning_clarification", "task_proposed", "task_completed", "task_approved", "context_updated", "context_approved", "repository_scanned", "synthesize_completed", "human_todo_created", "automation_execution_started", "automation_evaluation_started", "automation_claimed", "automation_skipped", "automation_evaluated", "automation_rate_limited", "automation_lease_recovered", "automation_heartbeat_failed", "automation_recovery_requires_human", "automation_frozen", "automation_continued"]).order("created_at", { ascending: false }).limit(25),
  ]);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const activeBranch = (tasks ?? []).some((task) => ["running", "pending_review", "waiting_for_human_approval"].includes(task.state));
  const hasQueuedTask = (tasks ?? []).some((task) => ["approved", "queued"].includes(task.state));
  const planningTasks = (tasks ?? []).filter((task) => ["planned", "waiting_for_approval", "approved", "queued", "running", "pending_review", "waiting_for_human_approval"].includes(task.state));
  const canPropose = project.state === "active" && (isPlanningScopeEligible({ category: "general" }, planningTasks, questions ?? [])
    || (features ?? []).some((feature) => isPlanningScopeEligible({ category: "feature", featureId: feature.id }, planningTasks, questions ?? [])));
  const runsToday = project.automation_run_day === new Date().toISOString().slice(0, 10) ? project.automation_runs_today ?? 0 : 0;
  return Response.json({ ...automationSnapshot({ state: project.automation_state, pauseReason: project.automation_pause_reason, cooldownUntil: project.automation_cooldown_until, lastActionAt: project.automation_last_action_at, leases: leases ?? [], hasReview: activeBranch, hasQueuedTask, canPropose }), projectState: project.state, dailyRunLimit: project.automation_daily_run_limit ?? 3, runsToday, events: events ?? [] });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid automation state." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before updating automation." }, { status: 401 });
  const isFrozen = parsed.data.state === "frozen";
  const { error } = await supabase.from("projects").update({ automation_state: parsed.data.state, automation_pause_reason: isFrozen ? (parsed.data.reason ?? "Frozen by a human.") : null, automation_last_action_at: new Date().toISOString() }).eq("id", projectId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: isFrozen ? "automation_frozen" : "automation_continued", payload: { reason: parsed.data.reason ?? null } });
  if (!isFrozen) {
    after(async () => {
      try {
        const results = await runAutomationCycle({ supabase, projectId, owner: "automation-resume-" + user.id });
        await Promise.all(results
          .filter((result) => result.action !== "idle")
          .map((result) => supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_claimed", payload: { ...result, trigger: "unfreeze" } })));
      } catch (cycleError) {
        console.error("Axiom could not wake automation after unfreezing", cycleError);
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_wake_failed", payload: { reason: cycleError instanceof Error ? cycleError.message : "Unknown automation wake failure" } });
      }
    });
  }
  return Response.json({ ok: true });
}

import { z } from "zod";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRepositoryBranch, type AvailableRepository } from "@/lib/github/app";
import { normalizeHumanPrerequisites, serializeHumanPrerequisites } from "@/lib/human-prerequisites";
import { cancelActiveRun } from "@/lib/execution/active-run";
import { runAutomationCycle } from "@/lib/automation-cycle";

const updateTaskSchema = z.object({
  approve: z.boolean().optional(),
  mergeHumanApproval: z.boolean().optional(),
  rejectHumanApproval: z.boolean().optional(),
  acknowledgeHumanActionId: z.string().trim().min(1).max(100).optional(),
  feedback: z.string().trim().min(1).max(4000).optional(),
  archive: z.boolean().optional(),
  resetExecution: z.boolean().optional(),
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

  const { data: task } = await supabase.from("tasks").select("id, state, archived_at, branch_name, objective, human_actions").eq("id", taskId).eq("project_id", projectId).maybeSingle();
  if (!task) return Response.json({ error: "Task not found." }, { status: 404 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.archive) {
    await cancelActiveRun(taskId);
    update.archived_at = new Date().toISOString();
    update.state = "failed";
  }
  if (parsed.data.resetExecution) {
    if (!["running", "pending_review", "failed"].includes(task.state)) return Response.json({ error: "Only a running, failed, or validation-failed task can be reset." }, { status: 409 });
    update.state = task.state === "failed" ? "approved" : "failed";
    update.branch_name = null;
    update.head_sha = null;
    update.execution_finished_at = new Date().toISOString();
    update.review_feedback = task.state === "running"
      ? "Execution was cancelled by a human. The task is retained here and can be returned to the queue."
      : task.state === "failed" ? "A human acknowledged the failed automation run and returned it to the queue." : "Validation-failed execution was reset by a human for a clean retry.";
    if (task.state === "failed") {
      update.automation_attempt_count = 0;
      update.last_automation_outcome = "human_recovered";
      update.automation_paused_at = null;
    }
    await cancelActiveRun(taskId);
  }
  if (parsed.data.approve) {
    if (task.state !== "waiting_for_approval") return Response.json({ error: "Only a waiting task can be approved." }, { status: 409 });
    update.state = "approved";
    update.automation_attempt_count = 0;
    update.last_automation_outcome = "human_reapproved";
    update.automation_paused_at = null;
  }

  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle();
  const repository = repositoryFromProjectSettings(project?.settings);

  if (parsed.data.mergeHumanApproval) {
    if (task.state !== "waiting_for_human_approval") return Response.json({ error: "Only tasks waiting for human approval can be merged." }, { status: 409 });
    if (repository && task.branch_name) {
      const { mergeRepositoryBranch } = await import("@/lib/github/app");
      await mergeRepositoryBranch(repository, task.branch_name, "Axiom: Merge task - " + task.objective.slice(0, 100));
    }
    update.state = "completed";
    update.execution_finished_at = new Date().toISOString();
    const { updateProjectImplementationState } = await import("@/lib/project-status");
    await updateProjectImplementationState({ supabase, projectId, state: "completed", summary: "Task merged into main branch: " + task.objective });
  }

  if (parsed.data.rejectHumanApproval) {
    if (task.state !== "waiting_for_human_approval") return Response.json({ error: "Only tasks waiting for human approval can be rejected for redo." }, { status: 409 });
    update.state = "approved";
    update.branch_name = null;
    update.head_sha = null;
    update.execution_started_at = null;
    update.execution_finished_at = null;
    update.execution_attempt_count = 0;
    update.review_feedback = parsed.data.feedback || "Human reviewer rejected the implementation and requested a redo.";
    const { updateProjectImplementationState } = await import("@/lib/project-status");
    await updateProjectImplementationState({ supabase, projectId, state: "not_started", summary: "Task implementation rejected for redo." });
  }

  if (parsed.data.archive) {
    const { updateProjectImplementationState } = await import("@/lib/project-status");
    await updateProjectImplementationState({ supabase, projectId, state: "not_started", summary: "Active task was archived." });
  }

  if (parsed.data.acknowledgeHumanActionId) {
    const actions = normalizeHumanPrerequisites(task.human_actions);
    const action = actions.find((item) => item.id === parsed.data.acknowledgeHumanActionId);
    if (!action) return Response.json({ error: "Human prerequisite not found." }, { status: 404 });
    if (!action.acknowledgedAt) action.acknowledgedAt = new Date().toISOString();
    update.human_actions = serializeHumanPrerequisites(actions);
    if (actions.every((item) => item.optional || item.acknowledgedAt)) update.human_actions_completed_at = new Date().toISOString();
  }
  if (parsed.data.feedback) update.human_feedback = parsed.data.feedback;

  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // A human approval is a durable automation wake-up, not a cue to wait for the
  // next browser polling interval before starting eligible work.
  if (parsed.data.approve) {
    after(async () => {
      const { data: project } = await supabase.from("projects").select("automation_state").eq("id", projectId).maybeSingle();
      if (project?.automation_state !== "running") return;
      try {
        const results = await runAutomationCycle({ supabase, projectId, owner: "task-approved-" + taskId + "-" + user.id });
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_woken_by_approval", payload: { task_id: taskId, message: "Task approval immediately woke automation.", results } });
      } catch (wakeError) {
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_wake_failed", payload: { task_id: taskId, reason: wakeError instanceof Error ? wakeError.message : "Automation wake-up failed." } });
      }
    });
  }

  let branchCleanupWarning: string | null = null;
  if ((parsed.data.archive || parsed.data.resetExecution || parsed.data.mergeHumanApproval || parsed.data.rejectHumanApproval) && task.branch_name && repository) {
    try {
      await deleteRepositoryBranch(repository, task.branch_name);
    } catch (branchError) {
      console.error("Axiom could not delete task branch", branchError);
      branchCleanupWarning = "Task was updated, but its remote branch could not be deleted automatically.";
    }
  }

  const eventType = parsed.data.archive ? "task_archived" : parsed.data.resetExecution ? "task_execution_reset" : parsed.data.feedback ? "task_feedback" : parsed.data.approve ? "task_approved" : "human_prerequisite_acknowledged";
  await supabase.from("events").insert({
    project_id: projectId,
    actor_type: "human",
    event_type: eventType,
    payload: { task_id: taskId, feedback: parsed.data.feedback ?? null, human_action_id: parsed.data.acknowledgeHumanActionId ?? null },
  });
  return Response.json({ ok: true, warning: branchCleanupWarning });
}

function repositoryFromProjectSettings(settings: unknown): AvailableRepository | null {
  const github = (settings as { github?: unknown } | null)?.github as Record<string, unknown> | undefined;
  if (!github
    || typeof github.repository_id !== "number"
    || typeof github.installation_id !== "number"
    || typeof github.owner !== "string"
    || typeof github.name !== "string"
    || typeof github.full_name !== "string"
    || typeof github.default_branch !== "string"
    || typeof github.private !== "boolean") return null;
  return {
    id: github.repository_id,
    installationId: github.installation_id,
    owner: github.owner,
    name: github.name,
    fullName: github.full_name,
    defaultBranch: github.default_branch,
    private: github.private,
    htmlUrl: "",
  };
}

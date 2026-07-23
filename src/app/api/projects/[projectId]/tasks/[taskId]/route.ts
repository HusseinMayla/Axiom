import { z } from "zod";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRepositoryBranch, type AvailableRepository } from "@/lib/github/app";
import { normalizeHumanPrerequisites, serializeHumanPrerequisites } from "@/lib/human-prerequisites";
import { cancelActiveRun } from "@/lib/execution/active-run";
import { runAutomationCycle } from "@/lib/automation-cycle";

const updateTaskSchema = z.object({
  approve: z.boolean().optional(),
  rejectProposal: z.boolean().optional(),
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
  if (parsed.data.approve && parsed.data.rejectProposal) {
    return Response.json({ error: "Choose either approval or rejection for a task proposal." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before updating a task." }, { status: 401 });

  const { data: task } = await supabase.from("tasks").select("id, category, state, archived_at, branch_name, objective, feature_id, human_actions, acceptance_criteria, developer_report").eq("id", taskId).eq("project_id", projectId).maybeSingle();
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
  if (parsed.data.rejectProposal) {
    if (task.state !== "waiting_for_approval") return Response.json({ error: "Only a waiting task proposal can be rejected." }, { status: 409 });
    update.state = "rejected";
    update.human_feedback = parsed.data.feedback ?? "Human rejected this task proposal.";
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
    const { recordApprovedTaskOutcome } = await import("@/lib/project-status");
    await recordApprovedTaskOutcome({
      supabase,
      projectId,
      task: {
        id: task.id,
        category: task.category === "feature" ? "feature" : "general",
        featureId: task.feature_id,
        objective: task.objective,
        acceptanceCriteria: task.acceptance_criteria,
        developerReport: task.developer_report,
      },
    });
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

  if (parsed.data.approve && task.feature_id) {
    const { error: featureError } = await supabase
      .from("features")
      .update({ status: "in_development", updated_at: new Date().toISOString() })
      .eq("id", task.feature_id)
      .eq("project_id", projectId);
    if (featureError) return Response.json({ error: "Task was approved, but the feature could not enter development: " + featureError.message }, { status: 500 });
  }

  // Every transition that places a task back in `approved` must wake delivery.
  // Otherwise Retry task can leave a valid task stranded in the queue until a
  // human manually runs an automation cycle.
  const requeuedForExecution = (parsed.data.resetExecution && task.state === "failed") || parsed.data.rejectHumanApproval;
  if (parsed.data.approve || parsed.data.rejectProposal || parsed.data.mergeHumanApproval || requeuedForExecution) {
    after(async () => {
      const { data: project } = await supabase.from("projects").select("automation_state").eq("id", projectId).maybeSingle();
      if (project?.automation_state !== "running") return;
      try {
        const results = await runAutomationCycle({ supabase, projectId, owner: "task-approved-" + taskId + "-" + user.id });
        const decision = parsed.data.mergeHumanApproval ? "merged"
          : parsed.data.rejectProposal ? "proposal_rejected"
            : requeuedForExecution ? "requeued"
              : "approved";
        await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_woken_by_human_decision", payload: { task_id: taskId, decision, message: requeuedForExecution ? "Task returned to the approved queue; automation immediately woke delivery." : "Human decision immediately woke automation to inspect and plan the next improvement.", results } });
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

  const eventType = parsed.data.archive ? "task_archived" : parsed.data.resetExecution ? "task_execution_reset" : parsed.data.mergeHumanApproval ? "task_completed" : parsed.data.rejectProposal ? "task_rejected" : parsed.data.feedback ? "task_feedback" : parsed.data.approve ? "task_approved" : "human_prerequisite_acknowledged";
  await supabase.from("events").insert({
    project_id: projectId,
    actor_type: "human",
    event_type: eventType,
    payload: {
      task_id: taskId,
      feature_id: task.feature_id,
      objective: task.objective,
      completed_summary: parsed.data.mergeHumanApproval
        ? ((task.developer_report as { dashboard_summary?: unknown; summary?: unknown } | null)?.dashboard_summary
          ?? (task.developer_report as { summary?: unknown } | null)?.summary
          ?? task.objective)
        : null,
      feedback: parsed.data.feedback ?? null,
      human_action_id: parsed.data.acknowledgeHumanActionId ?? null,
    },
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

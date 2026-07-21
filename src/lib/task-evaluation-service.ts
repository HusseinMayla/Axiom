import type { SupabaseClient } from "@supabase/supabase-js";
import { reviewTask } from "@/lib/ai/task-execution";
import { getBranchDiff, deleteRepositoryBranch, repositoryFromProjectSettings } from "@/lib/github/app";
import { updateProjectImplementationState } from "@/lib/project-status";

export async function evaluateCompletedTask(supabase: SupabaseClient, projectId: string, taskId: string, trigger: "human" | "automation" = "human") {
  const [{ data: task }, { data: project }] = await Promise.all([
    supabase.from("tasks").select("id, state, feature_id, objective, developer_prompt, allowed_paths, acceptance_criteria, validation_commands, developer_report, branch_name, automation_attempt_count, features(context_node_id)").eq("id", taskId).eq("project_id", projectId).maybeSingle(),
    supabase.from("projects").select("settings, automation_state").eq("id", projectId).maybeSingle(),
  ]);
  if (!task) throw new Error("Task not found.");
  if (task.state !== "pending_review") throw new Error("Task is not pending bot evaluation.");
  const repository = repositoryFromProjectSettings(project?.settings);
  if (!repository || !task.branch_name) throw new Error("Connected GitHub repository or branch is missing.");
  const diff = await getBranchDiff(repository, task.branch_name);
  const report = (task.developer_report ?? {}) as Record<string, unknown>;
  const validationResults = ((report.validation_results ?? []) as string[]).map((res) => ({ command: res.split(":")[0] ?? "validation", exitCode: res.includes("passed") ? 0 : 1, output: res }));
  const featureContextNodeId = (Array.isArray(task.features) ? task.features[0]?.context_node_id : null) ?? null;
  const [{ data: projectContext }, { data: featureContext }, { data: executionEvents }] = await Promise.all([
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    featureContextNodeId ? supabase.from("context_nodes").select("content").eq("id", featureContextNodeId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("task_execution_events").select("step, tool_name, tool_args, tool_result, status, created_at").eq("task_id", taskId).order("created_at", { ascending: false }).limit(24),
  ]);
  const changedPaths = (report.files_created as string[] ?? []).concat(report.files_modified as string[] ?? []);
  const review = await reviewTask({ task: { objective: task.objective, developerPrompt: task.developer_prompt, allowedPaths: task.allowed_paths ?? [], acceptanceCriteria: task.acceptance_criteria ?? [], validationCommands: task.validation_commands ?? [] }, projectStatus: ((projectContext?.content ?? {}) as Record<string, unknown>).current_status ?? {}, featureStatus: ((featureContext?.content ?? {}) as Record<string, unknown>).current_status ?? {}, diff: diff || "No diff output returned by GitHub.", diffStat: changedPaths.length + " changed path(s): " + changedPaths.join(", "), changedPaths, validationResults, executionEvents: executionEvents ?? [], report });
  if (trigger === "automation") {
    const { data: currentProject } = await supabase.from("projects").select("automation_state").eq("id", projectId).maybeSingle();
    if (currentProject?.automation_state === "frozen") {
      return { verdict: "deferred" as const, summary: "Automatic validation was deferred because a human froze automation.", feedback: [], nextState: "pending_review" as const };
    }
  }
  const now = new Date().toISOString();
  if (review.verdict === "pass") {
    await supabase.from("tasks").update({ state: "waiting_for_human_approval", review_feedback: review.summary, updated_at: now }).eq("id", taskId);
    await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type: "automation_evaluated", payload: { task_id: taskId, verdict: "pass", summary: review.summary } });
    return { verdict: "pass" as const, summary: review.summary, feedback: review.feedback, nextState: "waiting_for_human_approval" };
  }
  await deleteRepositoryBranch(repository, task.branch_name).catch(() => undefined);
  const retryCapReached = trigger === "automation" && task.automation_attempt_count >= 2;
  const nextState = trigger === "human" ? "failed" : retryCapReached ? "waiting_for_approval" : "approved";
  const manualValidationFailure = trigger === "human";
  await supabase.from("tasks").update({
    state: nextState,
    branch_name: null,
    head_sha: null,
    execution_started_at: null,
    execution_finished_at: null,
    execution_attempt_count: 0,
    last_automation_outcome: manualValidationFailure ? "manual_validation_failed" : retryCapReached ? "retry_cap_reached" : "retry",
    automation_paused_at: manualValidationFailure || retryCapReached ? now : null,
    review_feedback: "AI Reviewer Rejected PR:\n" + review.feedback.join("\n") + (manualValidationFailure ? "\n\nAutomatic flow is frozen. Review the evidence, then return this task to the queue when you are ready to retry." : retryCapReached ? "\n\nAutomatic retry limit reached. Human approval is required before another run." : ""),
    updated_at: now,
  }).eq("id", taskId);
  await updateProjectImplementationState({
    supabase: supabase as never,
    projectId,
    state: "not_started",
    summary: "AI Reviewer rejected PR for retry: " + review.summary,
  });
  await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type: "automation_evaluated", payload: { task_id: taskId, verdict: "retry", summary: review.summary, retry_cap_reached: retryCapReached } });
  return { verdict: "retry" as const, summary: review.summary, feedback: review.feedback, nextState, retryCapReached, manualValidationFailure };
}

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposeTask } from "@/lib/ai/task-planning";
import { normalizeHumanPrerequisites, serializeHumanPrerequisites } from "@/lib/human-prerequisites";
import { scanRepository, type AvailableRepository } from "@/lib/github/app";
import { evaluateCompletedTask } from "@/lib/task-evaluation-service";
import { executeNextTask } from "@/app/api/projects/[projectId]/execute-next/route";
import { isGeminiRateLimitError } from "@/lib/ai/gemini";
import { cancelActiveRun } from "@/lib/execution/active-run";

type Supabase = SupabaseClient;
const LEASE_TTL_MS = 2 * 60_000;
const LEASE_HEARTBEAT_MS = 30_000;
const STALE_PLANNING_LEASE_MS = 90_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const PLANNING_OCCUPYING_STATES = new Set(["planned", "waiting_for_approval", "approved", "queued", "running", "pending_review", "waiting_for_human_approval"]);
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);
type CycleDetails = Record<string, unknown>;
type CycleResult = { lane: "planning" | "delivery"; action: "propose" | "execute" | "evaluate"; taskId: string | null; featureId: string | null; reason: string; details?: CycleDetails } | { lane: null; action: "idle"; taskId: null; featureId: null; reason: string; details?: CycleDetails };

export async function runAutomationCycle({ supabase, projectId, owner = "automation-" + randomUUID() }: { supabase: Supabase; projectId: string; owner?: string }): Promise<CycleResult[]> {
  const { data: project } = await supabase.from("projects").select("automation_state, automation_cooldown_until, state").eq("id", projectId).maybeSingle();
  if (!project || project.state !== "active") return [idle("Project context is not active.")];
  if (project.automation_state === "frozen") return [idle("Automation is frozen by a human.")];
  if (project.automation_cooldown_until && new Date(project.automation_cooldown_until).getTime() > Date.now()) {
    return [idle("Automation is cooling down after a provider rate limit until " + project.automation_cooldown_until + ".")];
  }

  await recoverExpiredLeases(supabase, projectId);
  const [{ data: tasks }, { data: features }, { data: questions }] = await Promise.all([
    supabase.from("tasks").select("id, category, feature_id, state, objective").eq("project_id", projectId).is("archived_at", null).order("category").order("priority").order("created_at"),
    supabase.from("features").select("id").eq("project_id", projectId).eq("status", "active").order("priority"),
    supabase.from("clarification_questions").select("feature_id").eq("project_id", projectId).eq("status", "open"),
  ]);

  const openTasks = tasks ?? [];
  // Failed and terminal tasks are historical outcomes, not active work. They must
  // not prevent the planner from proposing the next task for their scope.
  const planningTasks = openTasks.filter((task) => PLANNING_OCCUPYING_STATES.has(task.state));
  return Promise.all([
    runDeliveryLane(supabase, projectId, owner, openTasks),
    runPlanningLane(supabase, projectId, owner, planningTasks, features ?? [], questions ?? []),
  ]);
}

async function runDeliveryLane(supabase: Supabase, projectId: string, owner: string, openTasks: Array<{ id: string; state: string; objective: string }>): Promise<CycleResult> {
  const deliveryBlockers = openTasks.filter((task) => ["running", "waiting_for_human_approval"].includes(task.state));
  if (deliveryBlockers.length) return idle("Delivery is blocked by an active run or unresolved branch.", { blocking_tasks: taskDetails(deliveryBlockers) });
  const review = openTasks.find((task) => task.state === "pending_review");
  if (review && await claim(supabase, projectId, "delivery", review.id, "evaluate", owner)) {
    await event(supabase, projectId, "automation_evaluation_started", { task_id: review.id, lane: "delivery" });
    return evaluate(supabase, projectId, review.id, owner);
  }
  if (review) return idle("AI review is already being claimed by another automation cycle.", { blocking_tasks: taskDetails([review]), required_action: "evaluate", lease: await leaseDetails(supabase, projectId, "delivery") });
  const queued = openTasks.find((task) => ["approved", "queued"].includes(task.state));
  if (queued && await claim(supabase, projectId, "delivery", queued.id, "execute", owner)) {
    await event(supabase, projectId, "automation_execution_started", { task_id: queued.id, lane: "delivery" });
    return execute(supabase, projectId, queued.id, owner);
  }
  if (queued) return idle("Task execution is already being claimed by another automation cycle.", { blocking_tasks: taskDetails([queued]), required_action: "execute", lease: await leaseDetails(supabase, projectId, "delivery") });
  return idle("No completed branch or approved task is eligible for delivery.", { non_terminal_task_states: taskDetails(openTasks.filter((task) => !TERMINAL_TASK_STATES.has(task.state))) });
}

async function runPlanningLane(supabase: Supabase, projectId: string, owner: string, openTasks: Array<{ id: string; category: string; feature_id: string | null; state: string; objective: string }>, features: Array<{ id: string }>, questions: Array<{ feature_id: string | null }>): Promise<CycleResult> {
  const generalBlockers = openTasks.filter((task) => task.category === "general");
  const hasGeneral = generalBlockers.length > 0;
  if (!hasGeneral && await claim(supabase, projectId, "planning", null, "propose", owner)) return plan(supabase, projectId, owner, null, "Claimed a general-task proposal check.");
  if (!hasGeneral) return idle("General-task planning is already being claimed by another automation cycle.", { required_action: "propose", scope: "general", lease: await leaseDetails(supabase, projectId, "planning") });
  const blockedFeatures = new Set(questions.flatMap((question) => question.feature_id ? [question.feature_id] : []));
  const feature = features.find((candidate) => !blockedFeatures.has(candidate.id) && !openTasks.some((task) => task.feature_id === candidate.id));
  if (feature && await claim(supabase, projectId, "planning", null, "propose", owner)) return plan(supabase, projectId, owner, feature.id, "Claimed a feature-task proposal check.");
  if (feature) return idle("Feature planning is already being claimed by another automation cycle.", { required_action: "propose", scope: "feature", feature_id: feature.id, lease: await leaseDetails(supabase, projectId, "planning") });
  return idle("No eligible general or feature scope needs planning.", {
    blocking_general_tasks: taskDetails(generalBlockers),
    blocking_feature_tasks: taskDetails(openTasks.filter((task) => task.feature_id !== null)),
    feature_ids_with_open_clarifications: [...blockedFeatures],
    active_feature_ids: features.map((feature) => feature.id),
  });
}

async function evaluate(supabase: Supabase, projectId: string, taskId: string, owner: string): Promise<CycleResult> {
  try {
    const review = await withLeaseHeartbeat(supabase, projectId, "delivery", owner, () => evaluateCompletedTask(supabase, projectId, taskId, "automation"));
    return result("delivery", "evaluate", taskId, null, review.verdict === "pass"
      ? "Bot evaluation passed; the branch is waiting for human approval."
      : review.verdict === "deferred" ? "Bot evaluation was deferred because automation was frozen."
      : review.retryCapReached ? "Bot evaluation reached the automatic retry cap; human approval is required." : "Bot evaluation requested a retry; the task returned to the queue.");
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      await cooldown(supabase, projectId, "Bot evaluation remained rate-limited after retrying for 100 seconds.");
      return result("delivery", "evaluate", taskId, null, "Bot evaluation is rate-limited; automation is cooling down.");
    }
    throw error;
  } finally {
    await supabase.from("automation_leases").delete().eq("project_id", projectId).eq("lane", "delivery").eq("owner", owner);
  }
}

async function execute(supabase: Supabase, projectId: string, taskId: string, owner: string): Promise<CycleResult> {
  try {
    const response = await withLeaseHeartbeat(supabase, projectId, "delivery", owner, () => executeNextTask(supabase, projectId, "automation"), () => cancelActiveRun(taskId));
    const body = await response.json() as { type?: string; error?: string; message?: string; taskId?: string; rateLimited?: boolean; code?: string; diagnostic?: string; next_step?: string };
    if (body.rateLimited) {
      await cooldown(supabase, projectId, "Developer execution remained rate-limited after retrying for 100 seconds.");
      return result("delivery", "execute", taskId, null, "Developer execution is rate-limited; automation is cooling down.");
    }
    if (!response.ok || body.error) {
      const reason = [body.error ?? "Automation could not start the approved task.", body.diagnostic, body.next_step]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      console.error("Automation execution could not start", { projectId, taskId, status: response.status, code: body.code, diagnostic: body.diagnostic });
      await event(supabase, projectId, "automation_execution_unavailable", { task_id: taskId, status: response.status, code: body.code ?? null, diagnostic: body.diagnostic ?? null, next_step: body.next_step ?? null });
      return result("delivery", "execute", taskId, null, reason);
    }
    if (body.taskId && body.taskId !== taskId) throw new Error("The execution queue changed after its automation lease was claimed.");
    if (body.type === "pending_review") {
      await event(supabase, projectId, "automation_evaluation_started", { task_id: taskId, lane: "delivery", message: "Execution finished; AI review started immediately." });
      const review = await evaluateCompletedTask(supabase, projectId, taskId, "automation");
      return result("delivery", "evaluate", taskId, null, review.verdict === "pass"
        ? "Execution completed and AI review passed immediately; the branch is waiting for human approval."
        : review.verdict === "deferred" ? "Execution completed; AI review was deferred because automation was frozen."
        : review.retryCapReached ? "Execution completed; AI review reached the retry cap and requires human approval." : "Execution completed; immediate AI review requested a retry.");
    }
    return result("delivery", "execute", taskId, null, body.type === "retry" ? "Execution finished with a deterministic retry." : body.message ?? "Execution completed.");
  } finally {
    await supabase.from("automation_leases").delete().eq("project_id", projectId).eq("lane", "delivery").eq("owner", owner);
  }
}

async function plan(supabase: Supabase, projectId: string, owner: string, featureId: string | null, claimedReason: string): Promise<CycleResult> {
  try {
    return await withLeaseHeartbeat(supabase, projectId, "planning", owner, async () => {
      await event(supabase, projectId, "automation_planning_started", { feature_id: featureId, message: "Planning started. Reading approved context and scanning the repository before calling the AI planner." });
      const [{ data: project }, { data: root }, { data: feature }, { data: map }] = await Promise.all([
      supabase.from("projects").select("settings").eq("id", projectId).single(),
      supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      featureId ? supabase.from("features").select("id, name, description, priority, context_node_id").eq("id", featureId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const repository = repositoryFromSettings(project?.settings);
    if (!root || !repository) throw new Error("Approved context or repository connection is missing.");
    const scan = await scanRepository(repository);
    const [{ data: featureNode }, { data: activeTasks }, { data: outcomes }] = await Promise.all([
      feature?.context_node_id ? supabase.from("context_nodes").select("content").eq("id", feature.context_node_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("tasks").select("id, category, priority, feature_id, state, objective").eq("project_id", projectId).in("state", ["planned", "queued", "running", "pending_review", "waiting_for_approval", "waiting_for_human_approval", "approved"]).is("archived_at", null),
      supabase.from("events").select("event_type, payload, created_at").eq("project_id", projectId).in("event_type", ["task_completed", "task_rejected", "task_feedback"]).order("created_at", { ascending: false }).limit(8),
    ]);
    const rootContext = (root.content ?? {}) as Record<string, unknown>;
    const target = feature
      ? { category: "feature" as const, name: feature.name, description: feature.description, context: featureNode?.content ?? {} }
      : { category: "general" as const, name: "Project foundation", description: "Assess the approved project context and propose the next bounded project-wide task if justified.", context: rootContext.current_status ?? {} };
    const repositoryMap = {
      ...((map?.content ?? {}) as Record<string, unknown>),
      tree: scan.tree,
      inspected_files: scan.inspectedFiles,
      file_sizes: scan.fileSizes,
      repository: { ...(((map?.content ?? {}) as Record<string, unknown>).repository as Record<string, unknown> | undefined), language_hints: scan.languageHints, source_file_count: scan.sourceFileCount, scanned_at: new Date().toISOString() },
    };
    await event(supabase, projectId, "planning_triggered", {
      trigger: "automation",
      category: target.category,
      feature_id: featureId,
      inputs: { project_context: true, feature_context: Boolean(featureNode), repository_tree_paths: scan.tree.length, inspected_files: scan.inspectedFiles.length, active_tasks: (activeTasks ?? []).length, recent_outcomes: (outcomes ?? []).length },
    });
    const proposal = await proposeTask({
      projectContext: rootContext,
      target,
      repositoryMap,
      activeTasks: activeTasks ?? [],
      recentOutcomes: outcomes ?? [],
      trigger: "automation",
      model: engineerModelFromSettings(project?.settings),
      onRateLimit: async (info) => event(supabase, projectId, "automation_rate_limit_retry", {
        ...info,
        lane: "planning",
        feature_id: featureId,
        provider_message: info.message,
        message: "AI planner was rate-limited; retry " + info.attempt + " begins in " + (info.retryInMs / 1000) + " seconds.",
      }),
    });
    if (proposal.type === "no_work") {
      const fallback = correctiveFoundationProposal(proposal.reason, target.category);
      if (fallback) {
        const { data: created, error } = await supabase.from("tasks").insert({
          project_id: projectId,
          feature_id: featureId,
          category: "general",
          priority: 0,
          state: "waiting_for_approval",
          objective: fallback.objective,
          rationale: fallback.rationale,
          human_summary: fallback.humanSummary,
          developer_prompt: fallback.developerPrompt,
          allowed_paths: fallback.allowedPaths,
          implementation_steps: fallback.implementationSteps,
          acceptance_criteria: fallback.acceptanceCriteria,
          validation_commands: fallback.validationCommands,
          human_actions: [],
          planning_context: { source: "deterministic_foundation_repair", planner_reason: proposal.reason, fresh_repository_tree_paths: scan.tree.length },
        }).select("id").single();
        if (error || !created) throw new Error(error?.message ?? "Could not save foundation repair proposal.");
        await event(supabase, projectId, "task_proposed", { task_id: created.id, source: "deterministic_foundation_repair", category: "general", reason: proposal.reason });
        return result("planning", "propose", created.id, null, "Created a corrective React/Vite/Tailwind foundation proposal after the planner identified repository drift.");
      }
      await event(supabase, projectId, "planning_no_work", { feature_id: featureId, reason: proposal.reason });
      return result("planning", "propose", null, featureId, proposal.reason);
    }
    if (proposal.type === "clarification") {
      await supabase.from("clarification_questions").insert({ project_id: projectId, feature_id: featureId, question: proposal.question.question, rationale: proposal.question.rationale });
      if (featureId) await supabase.from("features").update({ status: "needs_clarification", updated_at: new Date().toISOString() }).eq("id", featureId);
      await event(supabase, projectId, "planning_clarification", { feature_id: featureId, question: proposal.question.question });
      return result("planning", "propose", null, featureId, "Planner requested clarification.");
    }
    const task = proposal.task;
    const { data: created, error } = await supabase.from("tasks").insert({ project_id: projectId, feature_id: featureId, category: target.category, priority: feature?.priority ?? 0, state: "waiting_for_approval", objective: task.objective, rationale: task.rationale, human_summary: task.human_summary, developer_prompt: task.developer_prompt, allowed_paths: task.allowed_paths, implementation_steps: task.implementation_steps, acceptance_criteria: task.acceptance_criteria, validation_commands: task.validation_commands, human_actions: serializeHumanPrerequisites(normalizeHumanPrerequisites(task.human_actions)), planning_context: { source: "automated", fresh_repository_tree_paths: scan.tree.length } }).select("id").single();
    if (error || !created) throw new Error(error?.message ?? "Could not save automatic proposal.");
    await event(supabase, projectId, "task_proposed", { task_id: created.id, source: "automated", category: target.category, feature_id: featureId, claimed_reason: claimedReason });
      return result("planning", "propose", created.id, featureId, "Created a task proposal for human approval.");
    });
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      await cooldown(supabase, projectId, "Task planning remained rate-limited after retrying for 100 seconds.");
      return result("planning", "propose", null, featureId, "Task planning is rate-limited; automation is cooling down.");
    }
    throw error;
  } finally { await supabase.from("automation_leases").delete().eq("project_id", projectId).eq("lane", "planning").eq("owner", owner); }
}

async function event(supabase: Supabase, projectId: string, event_type: string, payload: Record<string, unknown>) { await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type, payload }); }
function repositoryFromSettings(settings: unknown): AvailableRepository | null { const g = (settings as { github?: unknown } | null)?.github as Record<string, unknown> | undefined; return g && typeof g.repository_id === "number" && typeof g.installation_id === "number" && typeof g.owner === "string" && typeof g.name === "string" && typeof g.full_name === "string" && typeof g.default_branch === "string" && typeof g.private === "boolean" ? { id: g.repository_id, installationId: g.installation_id, owner: g.owner, name: g.name, fullName: g.full_name, defaultBranch: g.default_branch, private: g.private, htmlUrl: "" } : null; }
function engineerModelFromSettings(settings: unknown) { const model = (settings as { engineer?: { model?: unknown } } | null)?.engineer?.model; return model === "gemini-3.1-flash-lite" || model === "gemini-3.5-flash" ? model : undefined; }

function correctiveFoundationProposal(reason: string, category: "general" | "feature") {
  if (category !== "general" || !/(corrective task is needed|corrective|re-?scaffold|vanilla typescript|boilerplate|react-based application|react\/vite\/tailwind foundation)/i.test(reason)) return null;
  return {
    objective: "Replace the vanilla TypeScript starter with the approved React, Vite, and Tailwind foundation",
    rationale: "Repository evidence shows the current starter files conflict with the approved application foundation. " + reason,
    humanSummary: "Restore the approved React/Vite/Tailwind foundation so future feature work starts from the correct application structure.",
    developerPrompt: "Replace the current vanilla Vite TypeScript starter with the approved React + TypeScript + Vite + Tailwind application foundation. Remove obsolete vanilla starter files such as src/main.ts and src/counter.ts when they are no longer used. Create a minimal React entry point and app shell, configure Tailwind according to the installed version, preserve existing project metadata that is still valid, and do not add product features in this task. Keep the change limited to foundation and configuration files.",
    allowedPaths: ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "index.html", "src", "public"],
    implementationSteps: ["Inspect the existing Vite configuration and package scripts.", "Replace the vanilla TypeScript entry point with a React TypeScript entry point and minimal app shell.", "Configure Tailwind and remove obsolete vanilla starter files.", "Run the project build to verify the foundation."],
    acceptanceCriteria: ["The application uses a React TypeScript entry point instead of the vanilla TypeScript starter.", "The obsolete vanilla counter starter is removed or no longer referenced.", "Tailwind is configured and usable by the app shell.", "npm run build completes successfully."],
    validationCommands: ["npm run build"],
  };
}

async function claim(supabase: Supabase, projectId: string, lane: "planning" | "delivery", taskId: string | null, action: "propose" | "execute" | "evaluate", owner: string) {
  const { data, error } = await supabase.rpc("claim_automation_lease", { p_project_id: projectId, p_lane: lane, p_task_id: taskId, p_action: action, p_owner: owner, p_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString() });
  if (error) throw new Error("Could not claim automation lease: " + error.message);
  return data === true;
}

async function recoverExpiredLeases(supabase: Supabase, projectId: string) {
  const now = new Date();
  const stalePlanningBefore = new Date(now.getTime() - STALE_PLANNING_LEASE_MS).toISOString();
  const { data: expired, error } = await supabase.from("automation_leases").select("lane, task_id, action, owner, expires_at, heartbeat_at").eq("project_id", projectId).lte("expires_at", now.toISOString());
  if (error) throw new Error("Could not inspect expired automation leases: " + error.message);
  for (const lease of expired ?? []) {
    const { error: deleteError } = await supabase.from("automation_leases").delete().eq("project_id", projectId).eq("lane", lease.lane).eq("owner", lease.owner).lte("expires_at", now.toISOString());
    if (deleteError) throw new Error("Could not recover expired automation lease: " + deleteError.message);
    await event(supabase, projectId, "automation_lease_recovered", { lane: lease.lane, task_id: lease.task_id, action: lease.action, owner: lease.owner, expired_at: lease.expires_at, reason: "Lease expired before the owner released it." });
    if (lease.action !== "execute" || !lease.task_id) continue;
    const { data: task } = await supabase.from("tasks").select("state").eq("id", lease.task_id).eq("project_id", projectId).maybeSingle();
    if (task?.state !== "running") continue;
    await supabase.from("tasks").update({
      state: "failed",
      execution_finished_at: new Date().toISOString(),
      review_feedback: "Automation worker lease expired before the run completed. A human must acknowledge or reset this task before another execution.",
      last_automation_outcome: "lease_expired",
      automation_paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", lease.task_id);
    await event(supabase, projectId, "automation_recovery_requires_human", { task_id: lease.task_id, reason: "Execution worker lease expired while the task was running." });
  }
  const { data: stalePlanning, error: staleError } = await supabase.from("automation_leases").select("lane, task_id, action, owner, expires_at, heartbeat_at").eq("project_id", projectId).eq("lane", "planning").lt("heartbeat_at", stalePlanningBefore);
  if (staleError) throw new Error("Could not inspect stale planning leases: " + staleError.message);
  for (const lease of stalePlanning ?? []) {
    const { error: deleteError } = await supabase.from("automation_leases").delete().eq("project_id", projectId).eq("lane", "planning").eq("owner", lease.owner).lt("heartbeat_at", stalePlanningBefore);
    if (deleteError) throw new Error("Could not recover stale planning lease: " + deleteError.message);
    await event(supabase, projectId, "automation_lease_recovered", { lane: "planning", task_id: null, action: lease.action, owner: lease.owner, heartbeat_at: lease.heartbeat_at, expired_at: lease.expires_at, reason: "Planning lease stopped sending heartbeats for more than 90 seconds and was released." });
  }
}

async function leaseDetails(supabase: Supabase, projectId: string, lane: "planning" | "delivery") {
  const { data } = await supabase.from("automation_leases").select("action, owner, expires_at, heartbeat_at, task_id").eq("project_id", projectId).eq("lane", lane).maybeSingle();
  return data ?? null;
}

async function withLeaseHeartbeat<T>(supabase: Supabase, projectId: string, lane: "planning" | "delivery", owner: string, work: () => Promise<T>, onLeaseLost?: () => Promise<unknown>): Promise<T> {
  let lost = false;
  const heartbeat = async () => {
    const { data, error } = await supabase.rpc("heartbeat_automation_lease", { p_project_id: projectId, p_lane: lane, p_owner: owner, p_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString() });
    if (error || data !== true) throw new Error("Automation lease heartbeat failed: " + (error?.message ?? "lease is no longer owned"));
  };
  await heartbeat();
  const timer = setInterval(() => {
    void heartbeat().catch((error) => {
      if (lost) return;
      lost = true;
      console.error("Automation lease heartbeat failed", error);
      void event(supabase, projectId, "automation_heartbeat_failed", { lane, reason: error instanceof Error ? error.message : "Unknown heartbeat failure" });
      void onLeaseLost?.();
    });
  }, LEASE_HEARTBEAT_MS);
  try { return await work(); } finally { clearInterval(timer); }
}

async function cooldown(supabase: Supabase, projectId: string, reason: string) {
  const until = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
  await supabase.from("projects").update({ automation_cooldown_until: until, automation_cooldown_reason: reason, automation_last_action_at: new Date().toISOString() }).eq("id", projectId);
  await event(supabase, projectId, "automation_rate_limited", { reason, cooldown_until: until });
}

function taskDetails(tasks: Array<{ id: string; state: string; objective: string }>) {
  return tasks.map((task) => ({ id: task.id, state: task.state, objective: task.objective.slice(0, 180) }));
}
function result(lane: "planning" | "delivery", action: "propose" | "execute" | "evaluate", taskId: string | null, featureId: string | null, reason: string, details?: CycleDetails): CycleResult { return { lane, action, taskId, featureId, reason, details }; }
function idle(reason: string, details?: CycleDetails): CycleResult { return { lane: null, action: "idle", taskId: null, featureId: null, reason, details }; }

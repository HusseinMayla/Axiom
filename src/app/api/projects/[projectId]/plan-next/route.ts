import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeTask } from "@/lib/ai/task-planning";
import { normalizeHumanPrerequisites, serializeHumanPrerequisites } from "@/lib/human-prerequisites";
import { scanRepository, type AvailableRepository } from "@/lib/github/app";
import { planningScopeBlocker } from "@/lib/automation-eligibility";
import { markFeatureCompletedWithoutTask } from "@/lib/feature-status";

const ACTIVE_TASK_STATES = ["planned", "queued", "running", "pending_review", "waiting_for_approval", "waiting_for_human_approval", "approved"];
const requestSchema = z.object({
  recommendation: z.string().trim().min(10).max(4000),
  category: z.enum(["general", "feature"]),
  featureId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.category === "feature" && !value.featureId) {
    context.addIssue({ code: "custom", message: "Choose a feature for a feature task." });
  }
});
const bodySchema = z.object({ request: requestSchema.optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let rawBody: unknown = {};
  try {
    const text = await request.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Invalid task request." }, { status: 400 });
  }
  const body = bodySchema.safeParse(rawBody);
  if (!body.success) return Response.json({ error: "Provide a task recommendation of at least 10 characters and select a feature when needed." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before planning work." }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, state, spent_estimate_cents, budget_cap_cents, settings")
    .eq("id", projectId)
    .single();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.state !== "active") return Response.json({ error: "Approve project context before planning begins." }, { status: 409 });
  if (project.spent_estimate_cents >= project.budget_cap_cents) return Response.json({ error: "This project has reached its AI budget cap." }, { status: 409 });

  const [{ data: features }, { data: activeTasks }, { data: openQuestions }, { data: rootNode }, { data: repositoryMap }, { data: outcomes }] = await Promise.all([
    supabase.from("features").select("id, name, description, priority, context_node_id").eq("project_id", projectId).eq("status", "active").order("priority"),
    supabase.from("tasks").select("id, category, priority, feature_id, state, objective").eq("project_id", projectId).in("state", ACTIVE_TASK_STATES).is("archived_at", null),
    supabase.from("clarification_questions").select("feature_id").eq("project_id", projectId).eq("status", "open"),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("events").select("event_type, payload, created_at").eq("project_id", projectId).in("event_type", ["task_completed", "task_rejected", "task_feedback"]).order("created_at", { ascending: false }).limit(8),
  ]);

  if (!rootNode) return Response.json({ error: "Approved project context is missing." }, { status: 409 });
  const rootContext = (rootNode.content ?? {}) as Record<string, unknown>;
  const guidedRequest = body.data.request;
  const projectCurrentStatus = (rootContext.current_status ?? {}) as { implementation_state?: unknown };
  const projectImplementationState = typeof projectCurrentStatus.implementation_state === "string" ? projectCurrentStatus.implementation_state : "unknown";
  const requiresFoundationTask = ["not_started", "unknown", "blocked"].includes(projectImplementationState);

  const occupiedFeatureIds = new Set((activeTasks ?? []).flatMap((task) => task.feature_id ? [task.feature_id] : []));
  const blockedFeatureIds = new Set((openQuestions ?? []).flatMap((question) => question.feature_id ? [question.feature_id] : []));
  const automaticFeature = (features ?? []).find((feature) => !occupiedFeatureIds.has(feature.id) && !blockedFeatureIds.has(feature.id));
  const selectedFeature = guidedRequest?.category === "feature"
    ? (features ?? []).find((feature) => feature.id === guidedRequest.featureId)
    : undefined;

  if (guidedRequest?.category === "feature" && !selectedFeature) {
    return Response.json({ error: "Choose an active feature for this task request." }, { status: 400 });
  }
  const feature = guidedRequest?.category === "feature" ? selectedFeature : automaticFeature;
  if (guidedRequest?.category === "feature" && feature && (occupiedFeatureIds.has(feature.id) || blockedFeatureIds.has(feature.id))) {
    return Response.json({ error: "That feature already has an active task or needs clarification." }, { status: 409 });
  }
  const generalBlocker = planningScopeBlocker({ category: "general" }, activeTasks ?? [], openQuestions ?? []);
  if (guidedRequest?.category === "general" && generalBlocker) {
    return Response.json({ error: generalBlocker === "clarification" ? "Answer the project-wide clarification before proposing more general work." : "A general task is already awaiting a decision or in progress." }, { status: 409 });
  }
  if (!guidedRequest && !feature && (!requiresFoundationTask || generalBlocker)) {
    return Response.json({ type: "idle", message: "No active feature is eligible for an automated task proposal." });
  }

  const isGeneral = guidedRequest?.category === "general" || (!guidedRequest && requiresFoundationTask && !generalBlocker);
  const { data: featureNode } = feature?.context_node_id
    ? await supabase.from("context_nodes").select("content").eq("id", feature.context_node_id).maybeSingle()
    : { data: null };
  const target = isGeneral
    ? {
      category: "general" as const,
      name: "Project foundation",
      description: guidedRequest?.recommendation ?? "Establish or unblock the project-wide foundation described by approved project context and its current implementation status.",
      context: rootContext.current_status ?? {},
    }
    : {
      category: "feature" as const,
      name: feature!.name,
      description: feature!.description,
      context: featureNode?.content ?? {},
    };

  const trigger = guidedRequest ? "human" : "automation";
  const repository = repositoryFromProjectSettings(project.settings);
  if (!repository) return Response.json({ error: "Connect a GitHub repository before planning work." }, { status: 409 });
  let freshScan;
  try {
    freshScan = await scanRepository(repository);
  } catch (error) {
    console.error("Axiom could not scan the repository before planning", error);
    return Response.json({
      error: "Axiom cannot read this repository's files. In the GitHub App settings, grant the app Contents: Read-only access for this repository, save or reinstall the app, then reconnect the repository in Axiom.",
    }, { status: 502 });
  }
  const repositoryContent = {
    ...((repositoryMap?.content ?? {}) as Record<string, unknown>),
    tree: freshScan.tree,
    inspected_files: freshScan.inspectedFiles,
    file_sizes: freshScan.fileSizes,
    repository: { ...(repositoryMap?.content as Record<string, unknown> | undefined)?.repository as Record<string, unknown>, language_hints: freshScan.languageHints, source_file_count: freshScan.sourceFileCount, scanned_at: new Date().toISOString() },
  };
  await supabase.from("events").insert({
    project_id: projectId,
    actor_type: trigger === "human" ? "human" : "system",
    event_type: "planning_triggered",
    payload: {
      trigger,
      category: target.category,
      feature_id: target.category === "feature" ? feature!.id : null,
      inputs: {
        project_context: true,
        feature_context: target.category === "feature",
        repository_tree_paths: Array.isArray(repositoryContent.tree) ? repositoryContent.tree.length : 0,
        inspected_files: Array.isArray(repositoryContent.inspected_files) ? repositoryContent.inspected_files.length : 0,
        active_tasks: (activeTasks ?? []).length,
      },
    },
  });

  try {
    const result = await proposeTask({
      projectContext: rootContext,
      target,
      repositoryMap: repositoryContent,
      activeTasks: activeTasks ?? [],
      recentOutcomes: outcomes ?? [],
      humanRecommendation: guidedRequest?.recommendation,
      trigger,
      model: engineerModelFromSettings(project.settings),
    });

    if (result.type === "clarification") {
      await supabase.from("clarification_questions").insert({
        project_id: projectId,
        feature_id: target.category === "feature" ? feature!.id : null,
        question: result.question.question,
        rationale: result.question.rationale,
      });
      if (target.category === "feature") {
        await supabase.from("features").update({ status: "needs_clarification", updated_at: new Date().toISOString() }).eq("id", feature!.id);
      }
      await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type: "planning_clarification", payload: { trigger, category: target.category, question: result.question.question, rationale: result.question.rationale } });
      return Response.json({ type: "clarification", featureId: target.category === "feature" ? feature!.id : null });
    }

    if (result.type === "no_work") {
      if (target.category === "feature") {
        await markFeatureCompletedWithoutTask({
          supabase,
          projectId,
          featureId: feature!.id,
          contextNodeId: feature!.context_node_id,
          reason: result.reason,
        });
      }
      await supabase.from("events").insert({ project_id: projectId, actor_type: "ai", event_type: "planning_no_work", payload: { trigger, category: target.category, reason: result.reason } });
      return Response.json({ type: "no_work", message: result.reason, featureCompleted: target.category === "feature" });
    }

    const task = result.task;
    const { data: createdTask, error } = await supabase.from("tasks").insert({
      project_id: projectId,
      feature_id: target.category === "feature" ? feature!.id : null,
      category: target.category,
      priority: target.category === "general" ? 0 : feature!.priority,
      state: "waiting_for_approval",
      objective: task.objective,
      rationale: task.rationale,
      human_summary: task.human_summary,
      developer_prompt: task.developer_prompt,
      allowed_paths: task.allowed_paths,
      implementation_steps: task.implementation_steps,
      acceptance_criteria: task.acceptance_criteria,
      validation_commands: task.validation_commands,
      human_actions: serializeHumanPrerequisites(normalizeHumanPrerequisites(task.human_actions)),
      planning_context: {
        source: guidedRequest ? "human_requested" : "automated",
        recommendation: guidedRequest?.recommendation ?? null,
        target_category: target.category,
        feature_node_id: target.category === "feature" ? feature!.context_node_id : null,
        project_implementation_state: projectImplementationState,
        repository_map_available: Boolean(repositoryMap),
      },
    }).select("id").single();
    if (error || !createdTask) return Response.json({ error: error?.message ?? "Could not save the task proposal." }, { status: 500 });

    await supabase.from("events").insert({
      project_id: projectId,
      actor_type: "ai",
      event_type: "task_proposed",
      payload: { task_id: createdTask.id, source: guidedRequest ? "human_requested" : "automated", category: target.category, feature_id: target.category === "feature" ? feature!.id : null },
    });
    return Response.json({ type: "task", taskId: createdTask.id, category: target.category, featureId: target.category === "feature" ? feature!.id : null });
  } catch (error) {
    console.error("Axiom task planning failed", error);
    return Response.json({ error: "Axiom could not create a valid task proposal. Try again after refining the context." }, { status: 502 });
  }
}

function engineerModelFromSettings(settings: unknown) {
  const model = (settings as { engineer?: { model?: unknown } } | null)?.engineer?.model;
  return model === "gemini-3.1-flash-lite" || model === "gemini-3.5-flash" ? model : undefined;
}

function repositoryFromProjectSettings(settings: unknown): AvailableRepository | null {
  const github = (settings as { github?: unknown } | null)?.github as Record<string, unknown> | undefined;
  if (!github || typeof github.repository_id !== "number" || typeof github.installation_id !== "number" || typeof github.owner !== "string" || typeof github.name !== "string" || typeof github.full_name !== "string" || typeof github.default_branch !== "string" || typeof github.private !== "boolean") return null;
  return { id: github.repository_id, installationId: github.installation_id, owner: github.owner, name: github.name, fullName: github.full_name, defaultBranch: github.default_branch, private: github.private, htmlUrl: "" };
}

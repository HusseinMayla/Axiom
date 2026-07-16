import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeFeatureTask } from "@/lib/ai/task-planning";

const ACTIVE_TASK_STATES = ["planned", "queued", "running", "pending_review", "waiting_for_approval", "approved"];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before planning work." }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, state, spent_estimate_cents, budget_cap_cents")
    .eq("id", projectId)
    .single();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.state !== "active") return Response.json({ error: "Approve project context before automatic planning begins." }, { status: 409 });
  if (project.spent_estimate_cents >= project.budget_cap_cents) return Response.json({ error: "This project has reached its AI budget cap." }, { status: 409 });

  const [
    { data: features, error: featuresError },
    { data: activeTasks, error: activeTasksError },
    { data: openQuestions, error: openQuestionsError },
    { data: rootNode, error: rootNodeError },
    { data: repositoryMap, error: repositoryMapError },
    { data: outcomes, error: outcomesError }
  ] = await Promise.all([
    supabase.from("features").select("id, name, description, priority, context_node_id, planning_lock_at").eq("project_id", projectId).eq("status", "active").order("priority"),
    supabase.from("tasks").select("feature_id").eq("project_id", projectId).in("state", ACTIVE_TASK_STATES),
    supabase.from("clarification_questions").select("feature_id").eq("project_id", projectId).eq("status", "open"),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("events").select("event_type, payload, created_at").eq("project_id", projectId).in("event_type", ["task_completed", "task_rejected", "task_feedback"]).order("created_at", { ascending: false }).limit(8),
  ]);

  if (featuresError) console.error("[plan-next] featuresError:", featuresError);
  if (activeTasksError) console.error("[plan-next] activeTasksError:", activeTasksError);
  if (openQuestionsError) console.error("[plan-next] openQuestionsError:", openQuestionsError);
  if (rootNodeError) console.error("[plan-next] rootNodeError:", rootNodeError);
  if (repositoryMapError) console.error("[plan-next] repositoryMapError:", repositoryMapError);
  if (outcomesError) console.error("[plan-next] outcomesError:", outcomesError);

  if (!rootNode) {
    console.warn(`[plan-next] Missing approved project context for projectId: ${projectId}. (Looked for context_nodes row where kind = 'project' and status = 'approved')`);
    return Response.json({ error: "Approved project context is missing." }, { status: 409 });
  }
  const occupiedFeatureIds = new Set((activeTasks ?? []).map((task) => task.feature_id));
  const blockedFeatureIds = new Set((openQuestions ?? []).flatMap((question) => question.feature_id ? [question.feature_id] : []));
  const feature = (features ?? []).find((candidate) => !occupiedFeatureIds.has(candidate.id) && !blockedFeatureIds.has(candidate.id));
  if (!feature) return Response.json({ type: "idle", message: "No active feature is eligible for a new task." });

  const { data: featureNode } = feature.context_node_id
    ? await supabase.from("context_nodes").select("content").eq("id", feature.context_node_id).maybeSingle()
    : { data: null };

  try {
    const result = await proposeFeatureTask({
      projectContext: rootNode.content,
      feature: { name: feature.name, description: feature.description, context: featureNode?.content ?? {} },
      repositoryMap: repositoryMap?.content ?? {},
      recentOutcomes: outcomes ?? [],
    });

    if (result.type === "clarification") {
      await supabase.from("clarification_questions").insert({
        project_id: projectId,
        feature_id: feature.id,
        question: result.question.question,
        rationale: result.question.rationale,
      });
      await supabase.from("features").update({ status: "needs_clarification", updated_at: new Date().toISOString() }).eq("id", feature.id);
      return Response.json({ type: "clarification", featureId: feature.id });
    }

    const task = result.task;
    const { data: createdTask, error } = await supabase.from("tasks").insert({
      project_id: projectId,
      feature_id: feature.id,
      state: "waiting_for_approval",
      objective: task.objective,
      rationale: task.rationale,
      human_summary: task.human_summary,
      developer_prompt: task.developer_prompt,
      allowed_paths: task.allowed_paths,
      implementation_steps: task.implementation_steps,
      acceptance_criteria: task.acceptance_criteria,
      validation_commands: task.validation_commands,
      human_actions: task.human_actions,
      planning_context: { feature_node_id: feature.context_node_id, repository_map_available: Boolean(repositoryMap) },
    }).select("id").single();
    if (error || !createdTask) return Response.json({ error: error?.message ?? "Could not save the task proposal." }, { status: 500 });

    await supabase.from("events").insert({
      project_id: projectId,
      actor_type: "ai",
      event_type: "task_proposed",
      payload: { task_id: createdTask.id, feature_id: feature.id },
    });
    return Response.json({ type: "task", taskId: createdTask.id, featureId: feature.id });
  } catch (error) {
    console.error("Axiom feature planning failed", error);
    return Response.json({ error: "Axiom could not create a valid task proposal. Try again after refining the context." }, { status: 502 });
  }
}

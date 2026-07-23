import { createSupabaseServerClient } from "@/lib/supabase/server";
import { developerReportSchema } from "@/lib/task-report";

type ApprovedTaskOutcome = {
  id: string;
  category: "general" | "feature";
  featureId: string | null;
  objective: string;
  acceptanceCriteria: unknown;
  developerReport: unknown;
};

export async function updateProjectImplementationState({
  supabase,
  projectId,
  state,
  summary,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  projectId: string;
  state: "not_started" | "in_progress" | "awaiting_review" | "completed" | "blocked";
  summary: string;
}) {
  const { data: rootNode } = await supabase
    .from("context_nodes")
    .select("id, content")
    .eq("project_id", projectId)
    .eq("kind", "project")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rootNode) return;
  const content = (rootNode.content ?? {}) as Record<string, unknown>;
  const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;

  await supabase
    .from("context_nodes")
    .update({
      content: {
        ...content,
        current_status: {
          ...currentStatus,
          implementation_state: state,
          summary,
          confirmed_by: "human_action",
          confirmed_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", rootNode.id);
}

/**
 * Human approval is the point at which a task becomes trusted project context.
 * Keep the feature's local "what exists" record and the project-wide record in
 * sync, so future planning sees the actual delivered behavior rather than the
 * old pre-execution status.
 */
export async function recordApprovedTaskOutcome({
  supabase,
  projectId,
  task,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  projectId: string;
  task: ApprovedTaskOutcome;
}) {
  const [{ data: rootNode }, featureResult] = await Promise.all([
    supabase
      .from("context_nodes")
      .select("id, content")
      .eq("project_id", projectId)
      .eq("kind", "project")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    task.featureId
      ? supabase
        .from("features")
        .select("context_node_id")
        .eq("id", task.featureId)
        .eq("project_id", projectId)
        .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const featureNodeId = featureResult.data?.context_node_id;
  const { data: featureNode } = featureNodeId
    ? await supabase.from("context_nodes").select("id, content").eq("id", featureNodeId).maybeSingle()
    : { data: null };
  const targets = [rootNode, featureNode].filter((node): node is { id: string; content: unknown } => Boolean(node));
  if (!targets.length) return;

  const parsedReport = developerReportSchema.safeParse(task.developerReport);
  const report = parsedReport.success ? parsedReport.data : developerReportSchema.parse({
    summary: "Human approved the completed task: " + task.objective,
    dashboard_summary: "Human approved: " + task.objective,
  });
  const completedAt = new Date().toISOString();
  const evidencePaths = unique([...report.files_created, ...report.files_modified]);
  const acceptanceCriteria = stringList(task.acceptanceCriteria);

  await Promise.all(targets.map(async (node) => {
    const content = (node.content ?? {}) as Record<string, unknown>;
    const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;
    const oldSnapshot = record(currentStatus.code_snapshot);
    const oldCompletedWork = objectList(currentStatus.completed_work).filter((item) => item.task_id !== task.id);
    const oldGaps = stringList(currentStatus.known_gaps).filter((gap) => !acceptanceCriteria.includes(gap) && !isStaleUnimplementedGap(gap));
    const summary = report.dashboard_summary || report.summary;

    await supabase.from("context_nodes").update({
      content: {
        ...content,
        current_status: {
          ...currentStatus,
          implementation_state: "implemented",
          summary,
          confirmed_by: "human",
          confirmed_at: completedAt,
          active_task: null,
          code_snapshot: {
            files_created: unique([...stringList(oldSnapshot.files_created), ...report.files_created]),
            files_modified: unique([...stringList(oldSnapshot.files_modified), ...report.files_modified]),
            modules_or_interfaces: unique([...stringList(oldSnapshot.modules_or_interfaces), ...report.modules_or_interfaces]),
            schema_or_configuration: unique([...stringList(oldSnapshot.schema_or_configuration), ...report.schema_or_configuration]),
            available_behavior: unique([...stringList(oldSnapshot.available_behavior), ...report.behavior_delivered]),
            validation_results: unique([...stringList(oldSnapshot.validation_results), ...report.validation_results]),
          },
          completed_work: [
            ...oldCompletedWork,
            { task_id: task.id, summary, evidence_paths: evidencePaths, completed_at: completedAt },
          ].slice(-20),
          evidence_paths: unique([...stringList(currentStatus.evidence_paths), ...evidencePaths]),
          known_gaps: unique([...oldGaps, ...report.known_limitations]),
        },
      },
      updated_at: completedAt,
    }).eq("id", node.id);
  }));
}

/** Repairs context produced before completed task outcomes were persisted. */
export async function reconcileCompletedTaskOutcomes({
  supabase,
  projectId,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  projectId: string;
}) {
  const [{ data: rootNode }, { data: completedTasks }] = await Promise.all([
    supabase
      .from("context_nodes")
      .select("content")
      .eq("project_id", projectId)
      .eq("kind", "project")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, category, feature_id, objective, acceptance_criteria, developer_report")
      .eq("project_id", projectId)
      .eq("state", "completed")
      .is("archived_at", null)
      .order("updated_at", { ascending: true })
      .limit(20),
  ]);
  if (!rootNode || !completedTasks?.length) return 0;

  const rootCurrentStatus = record(record(rootNode.content).current_status);
  // `completed_work` is an object array, so read task IDs directly instead of
  // trusting old status schemas that may not have all of the newer fields.
  const rootCompletedTaskIds = new Set(objectList(rootCurrentStatus.completed_work).flatMap((item) => typeof item.task_id === "string" ? [item.task_id] : []));

  let repaired = 0;
  for (const task of completedTasks) {
    if (rootCompletedTaskIds.has(task.id)) continue;
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
    repaired += 1;
  }
  return repaired;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectList(value: unknown): Array<Record<string, unknown> & { task_id?: string }> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> & { task_id?: string } => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isStaleUnimplementedGap(value: string) {
  return /no implementation has been confirmed|implementation has not started|no application source files|foundation.*not been implemented/i.test(value);
}

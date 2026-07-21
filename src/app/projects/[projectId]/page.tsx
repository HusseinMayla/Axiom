import { notFound, redirect } from "next/navigation";
import { ContextApprovalPanel } from "@/components/context-approval-panel";
import { ContextSynthesisPanel } from "@/components/context-synthesis-panel";
import { DiscoveryWizard } from "@/components/discovery-wizard";
import { RepositoryConnectionPanel } from "@/components/repository-connection-panel";
import { TaskPlanningPanel } from "@/components/task-planning-panel";
import { ImplementationStatusPanel } from "@/components/implementation-status-panel";
import { AgentStatusWidget } from "@/components/agent-status-widget";
import { AutomationControlPanel } from "@/components/automation-control-panel";
import { contextDraftSchema } from "@/lib/ai/context-synthesis";
import { getGeminiModel } from "@/lib/ai/gemini";
import type { DiscoveryAnswers } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHumanPrerequisites } from "@/lib/human-prerequisites";

export async function ProjectDebugWorkspace({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/projects/" + projectId);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, state, repository_state, repository_url, settings")
    .eq("id", projectId)
    .single();

  if (!project) {
    notFound();
  }

  const { data: discovery } = await supabase
    .from("project_discovery")
    .select("answers, stage")
    .eq("project_id", projectId)
    .single();

  const { data: questions } = await supabase
    .from("clarification_questions")
    .select("id, question, rationale, answer, status")
    .eq("project_id", projectId)
    .in("status", ["open", "answered"])
    .order("created_at");

  const { data: contextNode } = await supabase
    .from("context_nodes")
    .select("content")
    .eq("project_id", projectId)
    .eq("kind", "project")
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: repositoryMap } = await supabase
    .from("context_nodes")
    .select("content")
    .eq("project_id", projectId)
    .eq("kind", "repository_map")
    .eq("source", "scanner")
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: features } = await supabase
    .from("features")
    .select("id, name, description, priority, status, context_node_id")
    .eq("project_id", projectId)
    .order("priority");

  const { data: featureNodes } = await supabase
    .from("context_nodes")
    .select("id, content")
    .eq("project_id", projectId)
    .eq("kind", "feature")
    .in("status", ["draft", "approved"]);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, category, priority, state, objective, human_summary, human_actions, human_actions_completed_at, developer_prompt, developer_report, execution_logs, allowed_paths, implementation_steps, acceptance_criteria, validation_commands, branch_name, head_sha, feature_id, archived_at, features(name)")
    .eq("project_id", projectId)
    .in("state", ["planned", "waiting_for_approval", "approved", "queued", "pending_review", "running", "failed", "waiting_for_human_approval"])
    .order("category")
    .order("priority")
    .order("created_at");

  const rootContent = (contextNode?.content ?? {}) as Record<string, unknown>;
  const repositoryContent = (repositoryMap?.content ?? {}) as Record<string, unknown>;
  const repositoryTree = Array.isArray(repositoryContent.tree)
    ? repositoryContent.tree.filter((path): path is string => typeof path === "string")
    : [];
  const inspectedFiles = Array.isArray(repositoryContent.inspected_files)
    ? repositoryContent.inspected_files.flatMap((file) => {
      const candidate = file as Record<string, unknown>;
      return typeof candidate.path === "string" && typeof candidate.content === "string"
        ? [{ path: candidate.path, charCount: candidate.content.length }]
        : [];
    })
    : [];
  const fileSizes = Object.fromEntries(Object.entries((repositoryContent.file_sizes ?? {}) as Record<string, unknown>)
    .flatMap(([path, size]) => typeof size === "number" ? [[path, size] as const] : []));
  const repositoryMetadata = (repositoryContent.repository ?? {}) as Record<string, unknown>;
  const languageHints = Array.isArray(repositoryMetadata.language_hints)
    ? repositoryMetadata.language_hints.filter((hint): hint is string => typeof hint === "string")
    : [];
  const settings = (project.settings ?? {}) as { github?: { full_name?: unknown } };
  const repositoryName = typeof settings.github?.full_name === "string" ? settings.github.full_name : null;
  const draftPayload = {
    ...rootContent,
    features: rootContent.features ?? (features ?? []).map((feature) => {
      const node = featureNodes?.find((featureNode) => featureNode.id === feature.context_node_id);
      const nodeContent = (node?.content ?? {}) as { use_cases?: unknown };

      return {
        name: feature.name,
        description: feature.description,
        priority: feature.priority,
        use_cases: nodeContent.use_cases ?? [],
      };
    }),
  };
  const draftResult = contextDraftSchema.safeParse(draftPayload);
  const showDiscoveryWizard = project.repository_state === "empty";
  const activeFeatureStatuses = (features ?? [])
    .filter((feature) => feature.status === "active")
    .map((feature) => {
      const node = featureNodes?.find((featureNode) => featureNode.id === feature.context_node_id);
      const content = (node?.content ?? {}) as Record<string, unknown>;
      return { id: feature.id, name: feature.name, status: (content.current_status ?? {}) as Record<string, unknown> };
    });

  return (
    <main className="shell wizard-shell">
      <RepositoryConnectionPanel
        projectId={project.id}
        repositoryState={project.repository_state as "empty" | "connected" | "scanning" | "ready"}
        repositoryUrl={project.repository_url}
        repositoryName={repositoryName}
        repositoryTree={repositoryTree}
        fileSizes={fileSizes}
        inspectedFiles={inspectedFiles}
        languageHints={languageHints}
        fastModel={getGeminiModel("fast")}
        smartModel={getGeminiModel("smart")}
      />
      {showDiscoveryWizard && (
        <DiscoveryWizard
          projectId={project.id}
          projectName={project.name}
          initialAnswers={(discovery?.answers ?? {}) as DiscoveryAnswers}
          initialStage={(discovery?.stage ?? "draft") as "draft" | "submitted" | "clarifying" | "ready_for_review" | "approved"}
        />
      )}
      <ContextSynthesisPanel
        projectId={project.id}
        stage={discovery?.stage ?? "draft"}
        questions={(questions ?? []) as Array<{ id: string; question: string; rationale: string | null; answer: string | null; status: "open" | "answered" | "dismissed" }>}
        draft={draftResult.success ? draftResult.data : null}
      />
      <ContextApprovalPanel
        key={(features ?? []).filter((feature) => feature.status === "draft").map((feature) => feature.id).join("|")}
        projectId={project.id}
        stage={discovery?.stage ?? "draft"}
        draft={draftResult.success ? draftResult.data : null}
        features={(features ?? []) as Array<{ id: string; name: string; description: string; priority: number; status: "draft" | "active" | "needs_clarification" | "on_hold" | "completed" }>}
      />
      {project.state === "active" && <TaskPlanningPanel
        projectId={project.id}
        features={(features ?? []).filter((feature) => feature.status === "active").map((feature) => ({ id: feature.id, name: feature.name }))}
        projectStatus={(rootContent.current_status ?? {}) as { implementation_state?: string; summary?: string; active_task?: { objective?: string; task_state?: string } | null }}
        tasks={(tasks ?? []).map((task) => ({
          id: task.id,
          category: task.category as "general" | "feature",
          priority: task.priority,
          state: task.state,
          objective: task.objective,
          humanSummary: task.human_summary,
          humanActions: normalizeHumanPrerequisites(task.human_actions),
          humanActionsCompletedAt: task.human_actions_completed_at,
          developerPrompt: task.developer_prompt,
          developerReport: developerReportFromUnknown(task.developer_report),
          executionLogs: executionLogsFromUnknown(task.execution_logs),
          branchName: task.branch_name,
          headSha: task.head_sha,
          archivedAt: task.archived_at,
          allowedPaths: Array.isArray(task.allowed_paths) ? task.allowed_paths.filter((path): path is string => typeof path === "string") : [],
          implementationSteps: Array.isArray(task.implementation_steps) ? task.implementation_steps.filter((step): step is string => typeof step === "string") : [],
          acceptanceCriteria: Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria.filter((criterion): criterion is string => typeof criterion === "string") : [],
          validationCommands: Array.isArray(task.validation_commands) ? task.validation_commands.filter((command): command is string => typeof command === "string") : [],
          featureName: (task.features as { name?: string } | null)?.name ?? "Active feature",
        }))}
      />}
      {project.state === "active" && <AutomationControlPanel projectId={project.id} />}
      {project.state === "active" && <ImplementationStatusPanel
        projectStatus={(rootContent.current_status ?? {}) as Record<string, unknown>}
        featureStatuses={activeFeatureStatuses}
      />}
      <AgentStatusWidget projectId={project.id} />
    </main>
  );
}

function executionLogsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const log = item as Record<string, unknown>;
    return typeof log.attempt === "number" && typeof log.command === "string" && typeof log.exit_code === "number" && typeof log.output === "string"
      ? [{ attempt: log.attempt, command: log.command, exit_code: log.exit_code, output: log.output }]
      : [];
  });
}

function developerReportFromUnknown(value: unknown) {
  const report = (value ?? {}) as Record<string, unknown>;
  if (typeof report.summary !== "string" || typeof report.handoff !== "string") return null;
  const list = (key: string) => Array.isArray(report[key]) ? report[key].filter((item): item is string => typeof item === "string") : [];
  return {
    summary: report.summary,
    files_created: list("files_created"),
    files_modified: list("files_modified"),
    modules_or_interfaces: list("modules_or_interfaces"),
    schema_or_configuration: list("schema_or_configuration"),
    behavior_delivered: list("behavior_delivered"),
    validation_results: list("validation_results"),
    known_limitations: list("known_limitations"),
    handoff: report.handoff,
  };
}

/**
 * The public project entry point is now the Dashboard. The previous all-in-one
 * harness screen remains available only through the unlinked debug route while
 * the route-specific workspace is being built.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect("/projects/" + projectId + "/dashboard");
}

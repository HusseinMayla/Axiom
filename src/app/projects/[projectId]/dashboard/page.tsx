import { notFound, redirect } from "next/navigation";
import { DashboardActionCenter } from "@/components/dashboard-action-center";
import { ProjectNavigation } from "@/components/project-navigation";
import { normalizeHumanPrerequisites } from "@/lib/human-prerequisites";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/projects/" + projectId + "/dashboard");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, repository_url, repository_state, state, settings, automation_state")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  if (project.repository_state === "empty" && project.state !== "active" && project.state !== "completed") {
    redirect("/projects/" + projectId + "/setup");
  }

  const { data: projects } = await supabase.from("projects").select("id, name").order("updated_at", { ascending: false });

  const [{ data: tasks }, { data: questions }, { data: features }, { data: featureNodes }, { data: humanTodos }] = await Promise.all([
    supabase.from("tasks").select("id, state, objective, human_summary, human_actions, developer_report, execution_logs, review_feedback, execution_started_at, last_automation_outcome, branch_name, head_sha, archived_at, features(name)").eq("project_id", projectId).order("created_at"),
    supabase.from("clarification_questions").select("id, question, rationale").eq("project_id", projectId).eq("status", "open").order("created_at"),
    supabase.from("features").select("id, name, status, context_node_id").eq("project_id", projectId).order("priority"),
    supabase.from("context_nodes").select("id, content").eq("project_id", projectId).eq("kind", "feature").in("status", ["draft", "approved"]),
    supabase.from("human_todos").select("id, title, rationale, suggested_action, human_comment").eq("project_id", projectId).eq("status", "open").order("created_at"),
  ]);
  const featureSnapshots = (features ?? []).map((feature) => featureSnapshot(feature, featureNodes ?? []));
  const openPrerequisites = (tasks ?? []).filter((task) => !task.archived_at).flatMap((task) => normalizeHumanPrerequisites(task.human_actions).filter((action) => !action.optional && !action.acknowledgedAt));
  const attentionCount = (tasks ?? []).filter((task) => !task.archived_at && ["waiting_for_approval", "planned", "failed"].includes(task.state)).length + (questions?.length ?? 0) + openPrerequisites.length + (humanTodos?.length ?? 0);

  return (
    <div className="project-workspace">
      <ProjectNavigation projectId={project.id} projectName={project.name} repositoryUrl={project.repository_url} projects={projects ?? []} automationState={project.automation_state as "running" | "frozen" | null} attentionCount={attentionCount} />
      <main className="workspace-main dashboard-main">
        <div className="workspace-page-heading dashboard-page-heading">
          <div>
            <p className="eyebrow">PROJECT DASHBOARD</p>
            <h1>Human control points</h1>
          </div>
          <span className="workspace-state">● Human control active</span>
        </div>
        {(project.state === "active" || project.state === "completed") && <DashboardActionCenter projectId={project.id} projectState={project.state as "active" | "completed"} automationState={project.automation_state as "running" | "frozen" | null} planningFeatures={(features ?? []).filter((feature) => feature.status === "active" || feature.status === "in_development").map((feature) => ({ id: feature.id, name: feature.name }))} featureSnapshots={featureSnapshots} humanTodos={(humanTodos ?? []).map((todo) => ({ id: todo.id, title: todo.title, rationale: todo.rationale, suggestedAction: todo.suggested_action, humanComment: todo.human_comment }))} tasks={(tasks ?? []).filter((task) => !task.archived_at).map((task) => ({ id: task.id, state: task.state, objective: task.objective, humanSummary: task.human_summary, featureName: (task.features as { name?: string } | null)?.name ?? "Project work", branchName: task.branch_name, headSha: task.head_sha, developerReport: developerReportFromUnknown(task.developer_report), reviewFeedback: task.review_feedback, executionStartedAt: task.execution_started_at, lastAutomationOutcome: task.last_automation_outcome, executionLogs: executionLogsFromUnknown(task.execution_logs), humanActions: normalizeHumanPrerequisites(task.human_actions) }))} clarifications={questions ?? []} />}
      </main>
    </div>
  );
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function developerReportFromUnknown(value: unknown) {
  const report = (value ?? {}) as Record<string, unknown>;
  if (typeof report.summary !== "string" || typeof report.handoff !== "string") return null;
  return {
    summary: report.summary, validationResults: strings(report.validation_results), filesModified: strings(report.files_modified),
  };
}

function executionLogsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const log = entry as Record<string, unknown>;
    return typeof log.attempt === "number" && typeof log.command === "string" && typeof log.exit_code === "number" && typeof log.output === "string"
      ? [{ attempt: log.attempt, command: log.command, exitCode: log.exit_code, output: log.output.slice(-1200) }]
      : [];
  });
}

function featureSnapshot(feature: { id: string; name: string; status: string; context_node_id: string | null }, nodes: Array<{ id: string; content: unknown }>) {
  const node = nodes.find((item) => item.id === feature.context_node_id);
  const status = (((node?.content ?? {}) as Record<string, unknown>).current_status ?? {}) as Record<string, unknown>;
  const activeTask = (status.active_task ?? {}) as Record<string, unknown>;
  const codeSnapshot = (status.code_snapshot ?? {}) as Record<string, unknown>;
  const candidate = typeof activeTask.latest_report === "string" ? activeTask.latest_report : typeof status.summary === "string" ? status.summary : "No implementation has been confirmed for this feature.";
  const detail = [...strings(codeSnapshot.available_behavior), ...strings(codeSnapshot.files_modified), ...strings(status.known_gaps).map((gap) => "Gap: " + gap)];
  return { id: feature.id, name: feature.name, state: typeof status.implementation_state === "string" ? status.implementation_state : feature.status, summary: oneSentence(candidate), detail };
}

function oneSentence(value: string) {
  const match = value.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] ?? value).trim().slice(0, 280);
}

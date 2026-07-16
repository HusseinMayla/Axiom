import { notFound, redirect } from "next/navigation";
import { ContextApprovalPanel } from "@/components/context-approval-panel";
import { ContextSynthesisPanel } from "@/components/context-synthesis-panel";
import { DiscoveryWizard } from "@/components/discovery-wizard";
import { RepositoryConnectionPanel } from "@/components/repository-connection-panel";
import { TaskPlanningPanel } from "@/components/task-planning-panel";
import { contextDraftSchema } from "@/lib/ai/context-synthesis";
import { getGeminiModel } from "@/lib/ai/gemini";
import type { DiscoveryAnswers } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectPage({
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
    .select("id, state, objective, human_summary, human_actions, human_actions_completed_at, feature_id, features(name)")
    .eq("project_id", projectId)
    .in("state", ["waiting_for_approval", "approved", "pending_review", "running"])
    .order("created_at", { ascending: false });

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
        tasks={(tasks ?? []).map((task) => ({
          id: task.id,
          state: task.state,
          objective: task.objective,
          humanSummary: task.human_summary,
          humanActions: Array.isArray(task.human_actions) ? task.human_actions as Array<{ action: string; optional: boolean }> : [],
          humanActionsCompletedAt: task.human_actions_completed_at,
          featureName: (task.features as { name?: string } | null)?.name ?? "Active feature",
        }))}
      />}
    </main>
  );
}

import { notFound, redirect } from "next/navigation";
import { ContextApprovalPanel } from "@/components/context-approval-panel";
import { ContextSynthesisPanel } from "@/components/context-synthesis-panel";
import { DiscoveryWizard } from "@/components/discovery-wizard";
import { RepositoryConnectionPanel } from "@/components/repository-connection-panel";
import { contextDraftSchema } from "@/lib/ai/context-synthesis";
import { getGeminiModel } from "@/lib/ai/gemini";
import type { DiscoveryAnswers } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectSetupPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/projects/" + projectId + "/setup");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, state, repository_state, repository_url, settings")
    .eq("id", projectId)
    .single();
  if (!project) notFound();
  if (project.state === "active") redirect("/projects/" + projectId + "/dashboard");

  const [{ data: discovery }, { data: questions }, { data: contextNode }, { data: features }, { data: featureNodes }, { data: repositoryMap }] = await Promise.all([
    supabase.from("project_discovery").select("answers, stage").eq("project_id", projectId).single(),
    supabase.from("clarification_questions").select("id, question, rationale, answer, status").eq("project_id", projectId).in("status", ["open", "answered"]).order("created_at"),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("features").select("id, name, description, priority, status, context_node_id").eq("project_id", projectId).order("priority"),
    supabase.from("context_nodes").select("id, content").eq("project_id", projectId).eq("kind", "feature").in("status", ["draft", "approved"]),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const rootContent = (contextNode?.content ?? {}) as Record<string, unknown>;
  const draftPayload = {
    ...rootContent,
    features: rootContent.features ?? (features ?? []).map((feature) => {
      const node = featureNodes?.find((item) => item.id === feature.context_node_id);
      return {
        name: feature.name,
        description: feature.description,
        priority: feature.priority,
        use_cases: ((node?.content ?? {}) as Record<string, unknown>).use_cases ?? [],
      };
    }),
  };
  const draftResult = contextDraftSchema.safeParse(draftPayload);
  const repositoryContent = (repositoryMap?.content ?? {}) as Record<string, unknown>;
  const repositoryTree = strings(repositoryContent.tree);
  const fileSizes = Object.fromEntries(Object.entries((repositoryContent.file_sizes ?? {}) as Record<string, unknown>).flatMap(([path, size]) => typeof size === "number" ? [[path, size]] : []));
  const inspectedFiles = Array.isArray(repositoryContent.inspected_files) ? repositoryContent.inspected_files.flatMap((file) => {
    const candidate = file as Record<string, unknown>;
    return typeof candidate.path === "string" && typeof candidate.content === "string" ? [{ path: candidate.path, charCount: candidate.content.length }] : [];
  }) : [];
  const repositoryMetadata = (repositoryContent.repository ?? {}) as Record<string, unknown>;
  const languageHints = strings(repositoryMetadata.language_hints);
  const settings = (project.settings ?? {}) as { github?: { full_name?: unknown } };
  const repositoryName = typeof settings.github?.full_name === "string" ? settings.github.full_name : null;
  const stage = discovery?.stage ?? "draft";
  const showDiscoveryWizard = project.repository_state === "empty" && ["draft", "submitted"].includes(stage);

  return (
    <main className="setup-page">
      <header className="setup-header">
        <a className="project-brand" href="/projects"><span className="brand-mark">A</span><span>AXIOM</span></a>
        <span className="setup-project-name">SETTING UP · {project.name}</span>
      </header>
      <section className="setup-intro">
        <p className="eyebrow">PROJECT INITIALIZATION</p>
        <h1>Give Axiom the context to work safely.</h1>
        <p>Connect the codebase, capture the delivery context, then approve the plan. Nothing runs until you decide it is ready.</p>
        <ol className="setup-progress" aria-label="Setup progress">
          <li className={project.repository_state === "ready" ? "complete" : "active"}><span>1</span>Connect repository</li>
          <li className={stage === "approved" ? "complete" : project.repository_state === "ready" ? "active" : ""}><span>2</span>Capture context</li>
          <li className={stage === "approved" ? "complete" : draftResult.success ? "active" : ""}><span>3</span>Approve plan</li>
        </ol>
      </section>
      <section className="setup-content">
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
        {showDiscoveryWizard && <DiscoveryWizard projectId={project.id} projectName={project.name} initialAnswers={(discovery?.answers ?? {}) as DiscoveryAnswers} initialStage={stage as "draft" | "submitted" | "clarifying" | "ready_for_review" | "approved"} />}
        <ContextSynthesisPanel projectId={project.id} stage={stage} questions={(questions ?? []) as Array<{ id: string; question: string; rationale: string | null; answer: string | null; status: "open" | "answered" | "dismissed" }>} draft={draftResult.success ? draftResult.data : null} />
        <ContextApprovalPanel key={(features ?? []).filter((feature) => feature.status === "draft").map((feature) => feature.id).join("|")} projectId={project.id} stage={stage} draft={draftResult.success ? draftResult.data : null} features={(features ?? []) as Array<{ id: string; name: string; description: string; priority: number; status: "draft" | "active" | "in_development" | "needs_clarification" | "on_hold" | "completed" }>} />
      </section>
    </main>
  );
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

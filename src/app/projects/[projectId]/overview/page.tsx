import { notFound, redirect } from "next/navigation";
import { ContextSynthesisPanel } from "@/components/context-synthesis-panel";
import { ProjectNavigation } from "@/components/project-navigation";
import { ProjectOverviewMap } from "@/components/project-overview-map";
import { contextDraftSchema } from "@/lib/ai/context-synthesis";
import { normalizeHumanPrerequisites } from "@/lib/human-prerequisites";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/projects/" + projectId + "/overview");

  const [{ data: project }, { data: projects }] = await Promise.all([
    supabase.from("projects").select("id, name, state, repository_state, repository_url, settings, automation_state").eq("id", projectId).single(),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
  ]);
  if (!project) notFound();

  const [{ data: discovery }, { data: contextNode }, { data: repositoryMap }, { data: features }, { data: featureNodes }, { data: tasks }, { data: questions }, { data: humanTodos }] = await Promise.all([
    supabase.from("project_discovery").select("stage").eq("project_id", projectId).single(),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "project").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("context_nodes").select("content").eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("features").select("id, name, description, priority, status, context_node_id").eq("project_id", projectId).order("priority"),
    supabase.from("context_nodes").select("id, content").eq("project_id", projectId).eq("kind", "feature").in("status", ["draft", "approved"]),
    supabase.from("tasks").select("id, feature_id, objective, state, branch_name, head_sha, developer_report, human_actions, updated_at, archived_at, features(name)").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(100),
    supabase.from("clarification_questions").select("id, question, rationale, answer, status").eq("project_id", projectId).in("status", ["open", "answered"]).order("created_at"),
    supabase.from("human_todos").select("id").eq("project_id", projectId).eq("status", "open"),
  ]);

  const rootContent = (contextNode?.content ?? {}) as Record<string, unknown>;
  const draftPayload = {
    ...rootContent,
    features: rootContent.features ?? (features ?? []).map((feature) => {
      const node = featureNodes?.find((item) => item.id === feature.context_node_id);
      return { name: feature.name, description: feature.description, priority: feature.priority, use_cases: ((node?.content ?? {}) as Record<string, unknown>).use_cases ?? [] };
    }),
  };
  const draftResult = contextDraftSchema.safeParse(draftPayload);
  const repositoryContent = (repositoryMap?.content ?? {}) as Record<string, unknown>;
  const repository = (repositoryContent.repository ?? {}) as Record<string, unknown>;
  const repositoryTree = strings(repositoryContent.tree);
  const languageHints = strings(repository.language_hints);
  const inspectedFiles = Array.isArray(repositoryContent.inspected_files) ? repositoryContent.inspected_files.flatMap((file) => {
    const item = file as Record<string, unknown>;
    return typeof item.path === "string" ? [item.path] : [];
  }) : [];
  const openQuestions = (questions ?? []).filter((question) => question.status === "open");
  const attentionCount = (tasks ?? []).filter((task) => !task.archived_at && ["waiting_for_approval", "planned", "failed"].includes(task.state)).length + openQuestions.length + (tasks ?? []).filter((task) => !task.archived_at).flatMap((task) => normalizeHumanPrerequisites((task as { human_actions?: unknown }).human_actions).filter((action) => !action.optional && !action.acknowledgedAt)).length + (humanTodos?.length ?? 0);

  return <div className="project-workspace"><ProjectNavigation projectId={project.id} projectName={project.name} repositoryUrl={project.repository_url} projects={projects ?? []} automationState={project.automation_state as "running" | "frozen" | null} attentionCount={attentionCount} /><main className="workspace-main overview-main">
    <div className="workspace-page-heading overview-page-heading"><div><p className="eyebrow">PROJECT INTELLIGENCE</p><h1>Overview</h1></div><span className="overview-state">{project.state.replaceAll("_", " ")}</span></div>
    <section className="overview-facts"><article><span>CONTEXT</span><strong>{discovery?.stage === "approved" ? "Approved" : discovery?.stage?.replaceAll("_", " ") ?? "Not started"}</strong></article><article><span>REPOSITORY</span><strong>{project.repository_state}</strong></article><article><span>FEATURES</span><strong>{features?.filter((feature) => feature.status === "active").length ?? 0} active</strong></article><article><span>INSPECTED FILES</span><strong>{inspectedFiles.length}</strong></article></section>
    <section className="overview-layout"><div className="overview-primary"><section className="overview-section context-brief"><div className="overview-section-heading"><div><p className="eyebrow">PROJECT CONTEXT</p><h2>Project brief</h2></div></div><p>{draftResult.success ? draftResult.data.project_summary : "Generate and approve context to create a concise project brief."}</p><details><summary>Inspect or edit full context</summary><ContextSynthesisPanel projectId={project.id} stage={discovery?.stage ?? "draft"} questions={(questions ?? []) as Array<{ id: string; question: string; rationale: string | null; answer: string | null; status: "open" | "answered" | "dismissed" }>} draft={draftResult.success ? draftResult.data : null} /></details></section></div>
      <aside className="overview-side"><section className="overview-section repository-overview"><p className="eyebrow">REPOSITORY EVIDENCE</p><h2>{typeof repository.full_name === "string" ? repository.full_name : "No repository scan yet"}</h2>{languageHints.length > 0 ? <div className="language-badges">{languageHints.map((language) => <span key={language}>{language}</span>)}</div> : null}{repositoryTree.length > 0 ? <details open><summary>Folder structure · {repositoryTree.length} paths</summary><ul>{repositoryTree.slice(0, 80).map((path) => <li key={path}><code>{path}</code></li>)}</ul>{repositoryTree.length > 80 ? <p>Showing the first 80 scanned paths.</p> : null}</details> : <p>The repository map will appear after a successful scan.</p>}</section></aside></section>
    <ProjectOverviewMap
      projectId={project.id}
      projectName={project.name}
      features={(features ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        priority: f.priority,
        status: f.status,
      }))}
      tasks={(tasks ?? []).map((t) => ({
        id: t.id,
        feature_id: t.feature_id,
        objective: t.objective,
        state: t.state,
        branch_name: t.branch_name,
        head_sha: t.head_sha,
        developer_report: t.developer_report,
      }))}
      initialRepositoryTree={repositoryTree}
      defaultBranch={typeof repository.default_branch === "string" ? repository.default_branch : "main"}
    />
    <section className="overview-section"><div className="overview-section-heading"><div><p className="eyebrow">DELIVERY HISTORY</p><h2>Recent task evidence</h2></div></div><div className="delivery-history">{tasks?.length ? tasks.map((task) => { const report = (task.developer_report ?? {}) as Record<string, unknown>; return <article key={task.id}><div><span>{task.state.replaceAll("_", " ")}</span><strong>{task.objective}</strong><p>{typeof report.summary === "string" ? report.summary : "No implementation report has been attached."}</p></div><small>{(task.features as { name?: string } | null)?.name ?? "Project work"}{task.branch_name ? ` · ${task.branch_name}` : ""}{task.head_sha ? ` · ${task.head_sha.slice(0, 8)}` : ""}</small></article>; }) : <p className="overview-empty">No task delivery evidence exists yet.</p>}</div></section>
  </main></div>;
}

function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }


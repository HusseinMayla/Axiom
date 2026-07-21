import { notFound, redirect } from "next/navigation";
import { ProjectConfigurationPanel } from "@/components/project-configuration-panel";
import { ProjectNavigation } from "@/components/project-navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectConfigurationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/projects/" + projectId + "/configuration");
  const [{ data: project }, { data: projects }] = await Promise.all([
    supabase.from("projects").select("id, name, repository_state, repository_url, settings, automation_state, automation_pause_reason, automation_cooldown_until").eq("id", projectId).single(),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
  ]);
  if (!project) notFound();
  const [{ data: contextNode }, { data: tasks }, { count: openClarifications }] = await Promise.all([
    supabase.from("context_nodes").select("id").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").maybeSingle(),
    supabase.from("tasks").select("state, objective").eq("project_id", projectId).is("archived_at", null).in("state", ["waiting_for_approval", "running", "pending_review", "waiting_for_human_approval"]).order("updated_at", { ascending: false }).limit(1),
    supabase.from("clarification_questions").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "open"),
  ]);
  const settings = (project.settings ?? {}) as { github?: { full_name?: unknown; default_branch?: unknown }; developer?: { model?: unknown; max_steps?: unknown }; engineer?: { model?: unknown } };
  const repositoryName = typeof settings.github?.full_name === "string" ? settings.github.full_name : project.repository_url ?? "No repository connected";
  const model = settings.developer?.model === "gemini-3.5-flash" || settings.developer?.model === "gemini-3.1-flash-lite" ? settings.developer.model : "gemini-3.1-flash-lite";
  const maxSteps = settings.developer?.max_steps === 60 || settings.developer?.max_steps === 90 || settings.developer?.max_steps === 30 ? settings.developer.max_steps : 30;
  const engineerModel = settings.engineer?.model === "gemini-3.5-flash" || settings.engineer?.model === "gemini-3.1-flash-lite" ? settings.engineer.model : "gemini-3.1-flash-lite";
  const defaultBranch = typeof settings.github?.default_branch === "string" ? settings.github.default_branch : null;
  return (
    <div className="project-workspace">
      <ProjectNavigation
        projectId={project.id}
        projectName={project.name}
        repositoryUrl={project.repository_url}
        projects={projects ?? []}
        automationState={project.automation_state as "running" | "frozen" | null}
      />
      <main className="workspace-main configuration-main">
        <ProjectConfigurationPanel
          projectId={project.id}
          initialModel={model}
          initialEngineerModel={engineerModel}
          initialMaxSteps={maxSteps}
          repositoryName={repositoryName}
          repositoryUrl={project.repository_url}
          defaultBranch={defaultBranch}
          automationState={project.automation_state as "running" | "frozen" | null}
          automationPauseReason={project.automation_pause_reason}
          automationCooldownUntil={project.automation_cooldown_until}
          repositoryState={project.repository_state ?? "disconnected"}
          openClarifications={openClarifications ?? 0}
          hasContext={!!contextNode}
          activeTask={tasks?.[0] ?? null}
        />
      </main>
    </div>
  );
}

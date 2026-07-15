import { notFound, redirect } from "next/navigation";
import { DiscoveryWizard } from "@/components/discovery-wizard";
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
    .select("id, name")
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

  return (
    <main className="shell wizard-shell">
      <DiscoveryWizard
        projectId={project.id}
        projectName={project.name}
        initialAnswers={(discovery?.answers ?? {}) as DiscoveryAnswers}
        initialStage={(discovery?.stage ?? "draft") as "draft" | "submitted" | "clarifying" | "ready_for_review" | "approved"}
      />
    </main>
  );
}


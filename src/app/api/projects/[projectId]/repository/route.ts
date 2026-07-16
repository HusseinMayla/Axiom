import { NextRequest } from "next/server";
import { z } from "zod";
import { listAvailableRepositories } from "@/lib/github/app";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const repositorySchema = z.object({
  repositoryId: z.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const parsed = repositorySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Choose a repository to connect." }, { status: 400 });
  }

  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before connecting a repository." }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("id", projectId)
    .single();

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const repository = (await listAvailableRepositories()).find((item) => item.id === parsed.data.repositoryId);
    if (!repository) {
      return Response.json({ error: "This repository is not available through the installed GitHub App." }, { status: 403 });
    }

    const settings = (project.settings ?? {}) as Record<string, unknown>;
    const github = {
      repository_id: repository.id,
      installation_id: repository.installationId,
      owner: repository.owner,
      name: repository.name,
      full_name: repository.fullName,
      default_branch: repository.defaultBranch,
      private: repository.private,
    };

    const { error } = await supabase
      .from("projects")
      .update({
        repository_url: repository.htmlUrl,
        repository_state: "connected",
        settings: { ...settings, github },
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("events").insert({
      project_id: projectId,
      actor_type: "human",
      event_type: "repository_connected",
      payload: { repository: repository.fullName },
    });

    return Response.json({ repository });
  } catch (error) {
    console.error("Axiom repository connection failed", error);
    return Response.json({ error: "Axiom could not connect that repository. Check the GitHub App installation and try again." }, { status: 502 });
  }
}

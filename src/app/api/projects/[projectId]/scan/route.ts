import { z } from "zod";
import { scanRepository, type AvailableRepository } from "@/lib/github/app";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const githubConnectionSchema = z.object({
  repository_id: z.number().int().positive(),
  installation_id: z.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  private: z.boolean(),
});

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before scanning a repository." }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("id", projectId)
    .single();

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const settings = (project.settings ?? {}) as { github?: unknown };
  const parsed = githubConnectionSchema.safeParse(settings.github);
  if (!parsed.success) {
    return Response.json({ error: "Connect a GitHub repository before scanning." }, { status: 409 });
  }

  const repository: AvailableRepository = {
    id: parsed.data.repository_id,
    installationId: parsed.data.installation_id,
    owner: parsed.data.owner,
    name: parsed.data.name,
    fullName: parsed.data.full_name,
    htmlUrl: "",
    defaultBranch: parsed.data.default_branch,
    private: parsed.data.private,
  };

  await supabase
    .from("projects")
    .update({ repository_state: "scanning", updated_at: new Date().toISOString() })
    .eq("id", projectId);

  try {
    const scan = await scanRepository(repository);

    await supabase
      .from("context_nodes")
      .delete()
      .eq("project_id", projectId)
      .eq("kind", "repository_map")
      .eq("source", "scanner")
      .eq("status", "draft");

    const { error: mapError } = await supabase.from("context_nodes").insert({
      project_id: projectId,
      kind: "repository_map",
      status: "draft",
      source: "scanner",
      title: "Repository map: " + repository.fullName,
      content: {
        repository: {
          full_name: repository.fullName,
          default_branch: repository.defaultBranch,
          private: repository.private,
          source_file_count: scan.sourceFileCount,
          language_hints: scan.languageHints,
          scan_truncated: scan.truncated,
        },
        tree: scan.tree,
        file_sizes: scan.fileSizes,
        inspected_files: scan.inspectedFiles,
      },
    });

    if (mapError) {
      return Response.json({ error: mapError.message }, { status: 500 });
    }

    await supabase
      .from("projects")
      .update({ repository_state: scan.isEmpty ? "empty" : "ready", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    if (!scan.isEmpty) {
      await supabase
        .from("project_discovery")
        .update({ stage: "submitted", updated_at: new Date().toISOString() })
        .eq("project_id", projectId)
        .eq("stage", "draft");
    }

    await supabase.from("events").insert({
      project_id: projectId,
      actor_type: "scanner",
      event_type: "repository_scanned",
      payload: {
        repository: repository.fullName,
        source_file_count: scan.sourceFileCount,
        scanned_file_count: scan.tree.length,
        truncated: scan.truncated,
      },
    });

    return Response.json({
      type: scan.isEmpty ? "empty" : "ready_for_context",
      repository: repository.fullName,
      sourceFileCount: scan.sourceFileCount,
      inspectedFileCount: scan.inspectedFiles.length,
    });
  } catch (error) {
    console.error("Axiom repository scan failed", error);
    await supabase
      .from("projects")
      .update({ repository_state: "connected", updated_at: new Date().toISOString() })
      .eq("id", projectId);
    return Response.json({ error: "Axiom could not scan this repository. Check the GitHub App permissions and try again." }, { status: 502 });
  }
}

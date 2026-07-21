import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRepositoryBranches, repositoryFromProjectSettings } from "@/lib/github/app";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before viewing branches." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle();
  const repository = repositoryFromProjectSettings(project?.settings);
  if (!repository) return Response.json({ error: "Connect a repository before viewing branches." }, { status: 409 });
  try { return Response.json({ defaultBranch: repository.defaultBranch, branches: await listRepositoryBranches(repository) }); }
  catch { return Response.json({ error: "Axiom could not load branches from GitHub." }, { status: 502 }); }
}

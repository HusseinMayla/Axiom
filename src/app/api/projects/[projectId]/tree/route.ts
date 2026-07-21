import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRepositoryTree, repositoryFromProjectSettings } from "@/lib/github/app";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const branchName = url.searchParams.get("branch");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before viewing repository tree." }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle();
  const repository = repositoryFromProjectSettings(project?.settings);
  if (!repository) return Response.json({ error: "Connect a repository before viewing tree." }, { status: 409 });

  const activeBranch = branchName || repository.defaultBranch;

  try {
    const tree = await getRepositoryTree(repository, activeBranch);
    return Response.json({ branch: activeBranch, tree });
  } catch (error: any) {
    return Response.json({ error: "Axiom could not load repository tree from GitHub: " + error.message }, { status: 502 });
  }
}

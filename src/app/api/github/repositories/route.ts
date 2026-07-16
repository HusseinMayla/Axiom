import { getGithubAppEnv } from "@/lib/env";
import { listAvailableRepositories } from "@/lib/github/app";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before connecting a repository." }, { status: 401 });
  }

  try {
    const { slug } = getGithubAppEnv();
    const repositories = await listAvailableRepositories();

    return Response.json({
      repositories,
      installationUrl: "https://github.com/apps/" + encodeURIComponent(slug) + "/installations/new",
    });
  } catch (error) {
    console.error("Axiom GitHub App repository listing failed", error);
    return Response.json({
      error: "Axiom could not reach its GitHub App. Confirm the App variables are valid and that the App is installed on at least one repository.",
    }, { status: 502 });
  }
}

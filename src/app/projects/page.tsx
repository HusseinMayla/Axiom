import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/projects");
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, state, repository_state, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <main className="shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">AXIOM WORKSPACE</p>
          <h1>Projects</h1>
          <p className="lede compact">Project context is the foundation for every planned task.</p>
        </div>
        <Link className="button" href="/projects/new">New project</Link>
      </header>

      {projects?.length ? (
        <section className="project-grid">
          {projects.map((project) => (
            <Link className="project-card" href={"/projects/" + project.id} key={project.id}>
              <p className="eyebrow">{project.state.replace("_", " ")}</p>
              <h2>{project.name}</h2>
              <p>{project.repository_state === "empty" ? "Client-discovery brief" : "Repository-connected project"}</p>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <p className="eyebrow">NO PROJECTS YET</p>
          <h2>Start with the client brief.</h2>
          <p>Answer the discovery questions once. Axiom will turn the confirmed brief into durable project context.</p>
          <Link className="button" href="/projects/new">Create your first project</Link>
        </section>
      )}
    </main>
  );
}


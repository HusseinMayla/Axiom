import Link from "next/link";
import { redirect } from "next/navigation";
import { NewProjectForm } from "@/components/new-project-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewProjectPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/projects/new");
  }

  return (
    <main className="shell narrow">
      <Link className="back-link" href="/projects">← Projects</Link>
      <section className="hero compact-hero">
        <p className="eyebrow">NEW PROJECT</p>
        <h1>Start from code or a client brief.</h1>
        <p className="lede">Connect an existing repository for a grounded scan, or use focused client questions to define a new build.</p>
      </section>
      <section className="panel">
        <NewProjectForm />
      </section>
    </main>
  );
}

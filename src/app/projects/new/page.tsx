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
        <h1>Begin with a client brief.</h1>
        <p className="lede">We will ask focused questions, then build context Axiom can use for every future task.</p>
      </section>
      <section className="panel">
        <NewProjectForm />
      </section>
    </main>
  );
}


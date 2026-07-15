import Link from "next/link";
import { SignInForm } from "@/components/sign-in-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = next?.startsWith("/") ? next : "/projects";

  return (
    <main className="shell narrow">
      <Link className="back-link" href="/">← Axiom</Link>
      <section className="hero compact-hero">
        <p className="eyebrow">SIGN IN</p>
        <h1>Your engineering workspace.</h1>
        <p className="lede">Use a magic link to keep your projects and project context private.</p>
      </section>
      <section className="panel">
        <SignInForm nextPath={nextPath} />
      </section>
    </main>
  );
}


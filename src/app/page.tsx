import Link from "next/link";
import { LandingAccountActions } from "@/components/landing-account-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  let displayName: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const metadataName = user?.user_metadata?.full_name ?? user?.user_metadata?.name;
    displayName = typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().split(/\s+/)[0]
      : user?.email?.split("@")[0] ?? null;
  } catch {
    // Keep the marketing page available before local Supabase configuration exists.
  }

  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-brand" href="/"><span className="brand-mark">A</span> AXIOM</Link>
        <LandingAccountActions displayName={displayName} />
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker"><i /> HUMAN CONTROLLED AI ENGINEERING</p>
          <h1>AI can build.<br /><em>You stay in command.</em></h1>
          <p className="landing-lede">Axiom turns your product direction into bounded engineering work, then brings every consequential decision back to you—with the evidence to decide.</p>
          <div className="hero-actions">
            <Link className="button landing-primary" href="/projects">Enter the control room <span>→</span></Link>
            <a className="landing-watch" href="#how-it-works"><span>▶</span> See how it works</a>
          </div>
          <div className="landing-proof"><span>Built for shipping</span><i /><span>Designed for human judgment</span><i /><span>Never merges on its own</span></div>
        </div>
        <div className="landing-console" aria-label="Illustration of Axiom's controlled delivery workflow">
          <div className="console-top"><span><i /> LIVE HARNESS</span><small>PROJECT / LUMEN</small></div>
          <div className="console-flow">
            <div className="console-node human"><b>01</b><strong>Human</strong><span>Sets direction</span></div>
            <div className="console-line active" />
            <div className="console-node planner"><b>02</b><strong>Planner</strong><span>Bounds the task</span></div>
            <div className="console-line amber" />
            <div className="console-node approval"><b>03</b><strong>Approval</strong><span>Decision required</span></div>
            <div className="console-line muted" />
            <div className="console-node worker"><b>04</b><strong>Worker</strong><span>Executes safely</span></div>
          </div>
          <div className="console-alert"><span>03</span><div><small>ACTION REQUIRED</small><strong>Review completed authentication flow</strong></div><button type="button">Review →</button></div>
          <div className="console-footer"><span><i /> Worker paused for your decision</span><span>01:42 elapsed</span></div>
        </div>
      </section>

      <section id="how-it-works" className="landing-principles">
        <p className="eyebrow">THE OPERATING MODEL</p>
        <h2>Autonomy for execution.<br />Accountability for decisions.</h2>
        <div className="principle-grid">
          <article><span>01</span><h3>Grounded in your project</h3><p>Axiom starts with approved context, repository evidence, and explicit delivery constraints.</p></article>
          <article><span>02</span><h3>Work is deliberately bounded</h3><p>Every task carries its allowed files, acceptance criteria, and validation commands.</p></article>
          <article><span>03</span><h3>Nothing consequential is hidden</h3><p>Review the branch, tests, reports, and preview before deciding what moves forward.</p></article>
        </div>
      </section>

      <section className="landing-cta">
        <p className="eyebrow">THE CONTROL ROOM IS READY</p>
        <h2>Delegate the implementation.<br />Keep the judgment.</h2>
        <Link className="button landing-primary" href="/projects">Open Axiom <span>→</span></Link>
      </section>

      <footer className="landing-footer">
        <Link className="landing-brand" href="/"><span className="brand-mark">A</span> AXIOM</Link>
        <p>Human-controlled AI engineering.</p>
        <div>
          <Link href="/projects">Workspace</Link>
          <Link href="/login?next=/projects">Log in</Link>
        </div>
      </footer>
    </main>
  );
}

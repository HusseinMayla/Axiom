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
          <p className="landing-kicker"><i /> HUMAN-CONTROLLED ENGINEERING</p>
          <h1>Delegate the work.<br /><em>Keep the decision.</em></h1>
          <p className="landing-lede">Axiom turns a product request into a bounded task, runs it in an isolated workspace, and returns evidence for your review.</p>
          <div className="hero-actions">
            <Link className="button landing-primary" href="/projects">Enter the control room <span>→</span></Link>
            <a className="landing-watch" href="#how-it-works"><span>▶</span> See how it works</a>
          </div>
          <div className="landing-proof"><span>Bounded tasks</span><i /><span>Inspectable results</span><i /><span>Never merges on its own</span></div>
        </div>
        <div className="landing-console" aria-label="Illustration of Axiom's controlled delivery workflow">
          <div className="console-top"><span><i /> CONTROL ROOM</span><small>PROJECT / LUMEN</small></div>
          <div className="console-summary">
            <div><small>ACTIVE TASK</small><strong>Authentication flow</strong></div>
            <span><i /> REVIEW READY</span>
          </div>
          <div className="console-flow" aria-label="Task delivery pipeline">
            <div className="console-node"><b>01</b><strong>Request</strong><span>Direction set</span></div>
            <div className="console-arrow">→</div>
            <div className="console-node"><b>02</b><strong>Task</strong><span>Scope approved</span></div>
            <div className="console-arrow">→</div>
            <div className="console-node worker"><b>03</b><strong>Worker</strong><span>Checks passed</span></div>
            <div className="console-arrow amber">→</div>
            <div className="console-node approval"><b>04</b><strong>Review</strong><span>Your decision</span></div>
          </div>
          <div className="console-evidence">
            <span><i>✓</i> 12 checks passed</span><span><i>↗</i> Preview ready</span><span><i>±</i> 8 files changed</span>
          </div>
          <div className="console-alert"><span>04</span><div><small>HUMAN DECISION REQUIRED</small><strong>Review the completed authentication flow</strong></div><button type="button">Open review <b>→</b></button></div>
          <div className="console-footer"><span><i /> Worker paused for your decision</span><span>01:42 elapsed</span></div>
        </div>
      </section>

      <section id="how-it-works" className="landing-principles">
        <p className="eyebrow">THE OPERATING MODEL</p>
        <h2>Autonomy for execution.<br />Accountability for every decision.</h2>
        <div className="principle-grid">
          <article><span>01</span><h3>Grounded in your project</h3><p>Approved context and repository evidence give every task a useful starting point.</p></article>
          <article><span>02</span><h3>Work stays bounded</h3><p>Tasks name their allowed files, acceptance criteria, and validation commands.</p></article>
          <article><span>03</span><h3>Results stay inspectable</h3><p>Review the branch, tests, reports, and preview before deciding what moves forward.</p></article>
        </div>
      </section>

      <section className="landing-cta">
        <p className="eyebrow">THE CONTROL ROOM IS READY</p>
        <h2>Delegate the implementation.<br />Keep the judgment.</h2>
        <Link className="button landing-primary" href="/projects">Open Axiom <span>→</span></Link>
      </section>

      <footer className="landing-footer">
        <Link className="landing-brand" href="/"><span className="brand-mark">A</span> AXIOM</Link>
        <p>© 2026 Axiom. All rights reserved.</p>
        <div>
          <Link href="/projects">Workspace</Link>
          <Link href="/login?next=/projects">Log in</Link>
        </div>
      </footer>
    </main>
  );
}

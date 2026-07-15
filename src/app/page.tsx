import Link from "next/link";
import { setupStatus } from "@/lib/env";

export default function Home() {
  const setup = setupStatus();

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">AXIOM / PHASE 1</p>
        <h1>Human-controlled AI engineering.</h1>
        <p className="lede">
          Axiom turns a serious client brief into approved project context, active features, and bounded task proposals.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/projects">Open workspace</Link>
          <Link className="button secondary" href="/login?next=/projects">Sign in</Link>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="eyebrow">Foundation</p>
          <h2>Configuration status</h2>
          <ul className="status-list">
            <li><span className={setup.supabase ? "dot ready" : "dot"} />Supabase public configuration</li>
            <li><span className={setup.gemini ? "dot ready" : "dot"} />Gemini server configuration</li>
          </ul>
          {!setup.complete && <p className="notice">Add the missing variables to <code>.env.local</code>, then restart the development server.</p>}
        </article>

        <article className="panel">
          <p className="eyebrow">Current milestone</p>
          <h2>Project discovery</h2>
          <p className="panel-copy">Capture the real delivery context first. Gemini synthesis begins after the human approves the brief.</p>
        </article>
      </section>
    </main>
  );
}

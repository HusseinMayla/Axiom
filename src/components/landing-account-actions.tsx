"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LandingAccountActions({ displayName }: { displayName: string | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  if (!displayName) {
    return (
      <div className="landing-nav-actions">
        <Link className="button landing-nav-button" href="/login?next=/projects">Log in <span>↗</span></Link>
      </div>
    );
  }

  return (
    <div className="landing-nav-actions account-actions">
      <span className="welcome-profile"><i />Welcome, {displayName}</span>
      <Link className="button landing-nav-button" href="/projects">Open workspace <span>↗</span></Link>
      <button className="text-link logout-button" type="button" onClick={signOut} disabled={signingOut}>
        {signingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}

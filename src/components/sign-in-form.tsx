"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + "/auth/callback?next=" + encodeURIComponent(nextPath),
      },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }

    setState("sent");
    setMessage("Check your inbox for the Axiom sign-in link.");
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <button className="button" disabled={state === "sending"}>
        {state === "sending" ? "Sending link…" : "Send magic link"}
      </button>
      {message && <p className={state === "error" ? "form-error" : "form-note"}>{message}</p>}
    </form>
  );
}


"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setError("");

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setState("error");
      setError(payload.error ?? "Could not create the project.");
      return;
    }

    router.push("/projects/" + payload.project.id);
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label htmlFor="project-name">Project name</label>
      <input
        id="project-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Axiom"
        minLength={1}
        maxLength={120}
        required
      />
      <p className="field-hint">
        This starts an empty-project discovery. Repository connection arrives after the wizard path is complete.
      </p>
      <button className="button" disabled={state === "saving"}>
        {state === "saving" ? "Creating project…" : "Start discovery"}
      </button>
      {state === "error" && <p className="form-error">{error}</p>}
    </form>
  );
}


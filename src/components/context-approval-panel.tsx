"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContextDraft } from "@/lib/ai/context-synthesis";

type Feature = {
  id: string;
  name: string;
  description: string;
  priority: number;
  status: "draft" | "active" | "needs_clarification" | "on_hold" | "completed";
};

export function ContextApprovalPanel({
  projectId,
  stage,
  draft,
  features,
}: {
  projectId: string;
  stage: string;
  draft: ContextDraft | null;
  features: Feature[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState(() =>
    features.filter((feature) => feature.status === "draft" || feature.status === "active").map((feature) => feature.id),
  );
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!draft || (stage !== "ready_for_review" && stage !== "approved")) {
    return null;
  }

  const approved = stage === "approved";

  async function approveContext() {
    setState("saving");
    setMessage("");

    const response = await fetch("/api/projects/" + projectId + "/approve-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeFeatureIds: selectedIds }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not approve the context.");
      return;
    }

    setState("idle");
    setMessage("Context approved. Selected features are now active.");
    router.refresh();
  }

  return (
    <section className="approval-panel">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">{approved ? "APPROVED CONTEXT" : "HUMAN APPROVAL GATE"}</p>
          <h2>{approved ? "Context is now the project source of truth." : "Choose the features Axiom may work on."}</h2>
          <p className="panel-copy">
            {approved
              ? "Future task planning is limited to the active features below."
              : "Approve only the work that should enter Axiom’s automatic planning loop. Other draft features stay on hold."}
          </p>
        </div>
      </div>

      <div className="approval-feature-list">
        {features.map((feature) => (
          <label className={approved ? "approval-feature approved" : "approval-feature"} key={feature.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(feature.id)}
              disabled={approved || state === "saving"}
              onChange={(event) => {
                setSelectedIds((current) =>
                  event.target.checked
                    ? [...current, feature.id]
                    : current.filter((id) => id !== feature.id),
                );
              }}
            />
            <span>
              <strong>{feature.name}</strong>
              <small>Priority {feature.priority} · {feature.status.replace("_", " ")}</small>
              <em>{feature.description}</em>
            </span>
          </label>
        ))}
      </div>

      {!approved && (
        <button className="button" disabled={state === "saving" || selectedIds.length === 0} onClick={approveContext}>
          {state === "saving" ? "Approving…" : "Approve context and activate selected features"}
        </button>
      )}
      {message && <p className={state === "error" ? "form-error" : "form-note"}>{message}</p>}
    </section>
  );
}


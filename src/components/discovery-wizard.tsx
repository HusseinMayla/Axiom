"use client";

import { FormEvent, useMemo, useState } from "react";
import { discoverySections, type DiscoveryAnswers } from "@/lib/discovery";

type Stage = "draft" | "submitted" | "clarifying" | "ready_for_review" | "approved";

export function DiscoveryWizard({
  projectId,
  projectName,
  initialAnswers,
  initialStage,
}: {
  projectId: string;
  projectName: string;
  initialAnswers: DiscoveryAnswers;
  initialStage: Stage;
}) {
  const [answers, setAnswers] = useState<DiscoveryAnswers>(initialAnswers);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [stage, setStage] = useState<Stage>(initialStage);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const section = discoverySections[sectionIndex];
  const completed = useMemo(
    () => discoverySections.filter((item) => answers[item.key]?.trim()).length,
    [answers],
  );

  async function persist(nextStage: Stage) {
    setSaveState("saving");
    setMessage("");

    const response = await fetch("/api/projects/" + projectId + "/discovery", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, stage: nextStage }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setSaveState("error");
      setMessage(payload.error ?? "Could not save the discovery brief.");
      return false;
    }

    setStage(nextStage);
    setSaveState("saved");
    setMessage(nextStage === "submitted" ? "Discovery brief saved. Context synthesis is the next milestone." : "Draft saved.");
    return true;
  }

  async function continueWizard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await persist("draft");

    if (saved && sectionIndex < discoverySections.length - 1) {
      setSectionIndex((index) => index + 1);
      setSaveState("idle");
      setMessage("");
    }
  }

  return (
    <div className="wizard-layout">
      <aside className="wizard-sidebar">
        <p className="eyebrow">{projectName}</p>
        <h2>Client discovery</h2>
        <p className="sidebar-copy">{completed} of {discoverySections.length} discovery areas captured.</p>
        <ol className="step-list">
          {discoverySections.map((item, index) => (
            <li key={item.key}>
              <button
                className={index === sectionIndex ? "step-button active" : "step-button"}
                onClick={() => setSectionIndex(index)}
                type="button"
              >
                <span>{index + 1}</span>
                {item.title}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="wizard-panel">
        <p className="eyebrow">Section {sectionIndex + 1} of {discoverySections.length}</p>
        <h1>{section.title}</h1>
        <p className="lede compact">{section.prompt}</p>

        <form className="form-stack" onSubmit={continueWizard}>
          <label htmlFor={section.key}>Your answer</label>
          <textarea
            id={section.key}
            rows={10}
            value={answers[section.key] ?? ""}
            onChange={(event) => setAnswers((current) => ({ ...current, [section.key]: event.target.value }))}
            placeholder={section.hint}
          />
          <p className="field-hint">{section.hint}</p>

          <div className="wizard-actions">
            <button
              className="button secondary"
              type="button"
              disabled={sectionIndex === 0 || saveState === "saving"}
              onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}
            >
              Back
            </button>
            {sectionIndex < discoverySections.length - 1 ? (
              <button className="button" disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving…" : "Save and continue"}
              </button>
            ) : (
              <button
                className="button"
                type="button"
                disabled={saveState === "saving"}
                onClick={() => persist("submitted")}
              >
                {saveState === "saving" ? "Saving…" : "Submit discovery brief"}
              </button>
            )}
          </div>
          {message && <p className={saveState === "error" ? "form-error" : "form-note"}>{message}</p>}
          {stage === "submitted" && (
            <p className="notice">
              Your brief is ready. The next build step turns this human-authored input into a Gemini context draft.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}


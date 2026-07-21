"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContextDraft } from "@/lib/ai/context-synthesis";

type Question = {
  id: string;
  question: string;
  rationale: string | null;
  answer: string | null;
  status: "open" | "answered" | "dismissed";
};

export function ContextSynthesisPanel({
  projectId,
  stage,
  questions,
  draft,
}: {
  projectId: string;
  stage: string;
  questions: Question[];
  draft: ContextDraft | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((question) => [question.id, question.answer ?? ""])),
  );
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");

  const openQuestions = questions.filter((question) => question.status === "open");

  async function generateContext() {
    setState("working");
    setMessage("");

    const response = await fetch("/api/projects/" + projectId + "/synthesize", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not generate project context.");
      return;
    }

    setState("idle");
    setMessage(payload.type === "clarifications" ? "Gemini needs a few focused answers before drafting context." : "Context draft generated.");
    router.refresh();
  }

  async function reviseContext() {
    setState("working");
    setMessage("");
    const response = await fetch("/api/projects/" + projectId + "/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not revise the context.");
      return;
    }
    setState("idle");
    setFeedback("");
    setMessage(payload.type === "clarifications" ? "Axiom needs a clarification before it can revise the draft." : "Context draft revised from your feedback.");
    router.refresh();
  }

  async function saveClarifications() {
    setState("working");
    setMessage("");

    const response = await fetch("/api/projects/" + projectId + "/clarifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: openQuestions.map((question) => ({ id: question.id, answer: answers[question.id] ?? "" })),
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "Could not save the clarification answers.");
      return;
    }

    setState("idle");
    setMessage("Answers saved! Proposing next task...");
    await fetch("/api/projects/" + projectId + "/plan-next", { method: "POST" }).catch(() => null);
    router.refresh();
  }

  if (stage === "draft") {
    return null;
  }

  return (
    <section className="synthesis-panel">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">AI CONTEXT SYNTHESIS</p>
          <h2>Turn the brief into Axiom context.</h2>
          <p className="panel-copy">Gemini can draft context or call Axiom’s clarification tool when an answer materially changes the plan.</p>
        </div>
        {!draft && openQuestions.length === 0 && (
          <button className="button" disabled={state === "working"} onClick={generateContext}>
            {state === "working" ? "Synthesizing…" : "Generate context"}
          </button>
        )}
      </div>

      {message && <p className={state === "error" ? "form-error" : "form-note"}>{message}</p>}

      {openQuestions.length > 0 && (
        <div className="clarification-list">
          <p className="eyebrow">CLARIFICATION REQUESTS</p>
          {openQuestions.map((question) => (
            <article className="clarification-card" key={question.id}>
              <h3>{question.question}</h3>
              {question.rationale && <p>{question.rationale}</p>}
              <textarea
                rows={4}
                value={answers[question.id] ?? ""}
                placeholder="Write the specification answer for Axiom."
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            </article>
          ))}
          <button className="button" disabled={state === "working"} onClick={saveClarifications}>
            {state === "working" ? "Saving…" : "Save answers"}
          </button>
        </div>
      )}

      {draft && (
        <div className="context-draft">
          <p className="eyebrow">DRAFT CONTEXT / REVIEW NEXT</p>
          <h3>Project summary</h3>
          <p>{draft.project_summary}</p>
          <div className="context-columns">
            <ContextList title="Goals" items={draft.goals} />
            <ContextList title="Operating rules" items={draft.operating_rules} />
            <ContextList title="Technical constraints" items={draft.technical_constraints} />
            <ContextList title="Future plans" items={draft.future_plans} />
          </div>
          <div className="context-feedback">
            <label htmlFor="context-feedback">Request a revision</label>
            <textarea id="context-feedback" rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Explain what is inaccurate, missing, or should change in this context draft." />
            <button className="button secondary compact-button" disabled={state === "working" || feedback.trim().length < 10} onClick={reviseContext}>
              {state === "working" ? "Revising…" : "Send feedback and regenerate"}
            </button>
          </div>
          <h3>Feature proposals</h3>
          <div className="feature-list">
            {draft.features.map((feature) => (
              <article className="feature-card" key={feature.name}>
                <p className="eyebrow">PRIORITY {feature.priority}</p>
                <h4>{feature.name}</h4>
                <p>{feature.description}</p>
                <p className="use-case-count">{feature.use_cases.length} use case{feature.use_cases.length === 1 ? "" : "s"} captured</p>
                <details className="use-case-details">
                  <summary>Inspect use cases</summary>
                  {feature.use_cases.map((useCase) => (
                    <article key={useCase.actor + useCase.goal}>
                      <strong>{useCase.actor}: {useCase.goal}</strong>
                      <p><b>Trigger:</b> {useCase.trigger}</p>
                    </article>
                  ))}
                </details>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <article className="context-card">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

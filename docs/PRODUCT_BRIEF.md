# Axiom product brief

## Vision

Software teams should be able to delegate well-scoped implementation work to capable AI agents without delegating product judgment, access to production, or the final decision to ship.

## Problem

Today, using coding agents usually means manually managing prompts, context, terminals, branches, and follow-up reviews. The process is powerful but fragile: agents can lose the project intent, make broad changes, or leave the human with an opaque result.

## Product thesis

**Axiom gives a human project manager an operating layer for AI engineering work.** The human sets direction and approves outcomes. Axiom supplies the right project context, turns that direction into a small executable task, runs a developer agent in an isolated workspace, and returns an evidence-backed change for review.

## Primary user

A technical founder, product-minded engineer, or small-team lead who can judge a requested outcome and review a diff, but does not want to supervise every coding-agent step.

## Core loop

1. **Task Creation**: A task is created either:
   - *By AI Proposal*: The planner analyzes an engineering request and proposes a task to the human.
   - *By Direct Human Input*: The human defines a task directly, placing it directly into the queue.
2. **Continuous Queue Loop**: The agentic execution engine runs continuously, picking up tasks from the queue sequentially.
3. **Worker Execution**: An isolated worker implements the active task on a dedicated Git branch and runs validation checks.
4. **SE Review & Feedback**: A Software Engineer (SE) reviewer agent evaluates the worker's changes, test outputs, and preview.
   - *If Unsatisfied*: The SE reviewer automatically re-queues the task with pointers/feedback for retry, keeping the loop running.
   - *If Satisfied*: The SE reviewer forwards the task to the human.
5. **Human Inspection**: The human reviews the plain-English report, live preview, and visual artifacts, then approves or rejects.
6. **PR / Handoff**: Approval opens or marks a pull request ready (Axiom never merges autonomously).

## What makes the demo compelling

- **Control is visible:** an approval gate is a product feature, not a disclaimer.
- **Context is deliberate:** the planning request shows the project, feature, and file context that informed it.
- **Work is bounded:** each task names its allowed files, definition of done, and validation command.
- **Results are inspectable:** the UI shows the branch, live preview deployment link, visual screenshot/video artifacts, diff summary, test output, AI review, and estimated spend.

## Non-goals for the MVP

- Replacing a full software-engineering organization.
- Multi-agent parallel execution.
- Autonomous deployments, merges, or credential creation.
- A general-purpose cloud IDE.
- Perfect sandboxing against a malicious coding model.
- Deep retrieval, embeddings, or a knowledge graph.

## Product language

Use **request** for the human's goal, **task** for a bounded unit of implementation work, **worker** for the Dockerized coding agent, and **review** for the model's quality report. Avoid presenting the model as an independent decision maker; the human owns the decision.

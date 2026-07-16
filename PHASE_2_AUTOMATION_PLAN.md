# Phase 2: Controlled Task Queues

## Goal

After human approval of project context, Axiom proposes bounded tasks from approved context. The human reviews proposals and controls when tasks enter implementation or review. No developer-agent or reviewer-agent execution is implemented in this phase.

## Core correction: project readiness before feature work

An active feature is not automatically ready for implementation. Axiom must first inspect the approved project `current_status`.

If the repository has no application foundation, or the approved project status says the foundation is not implemented, Axiom proposes **general** tasks first. Examples:

- Establish the selected frontend/backend project structure.
- Add the approved technology stack and base configuration.
- Create the database schema and environment template.

Feature tasks are not proposed until the project status establishes that the required foundation exists. This prevents Axiom from proposing feature work against a repository that only contains documentation.

## Source of truth: current status

Do not reuse `context_nodes.status`; it already means the lifecycle of a context record (`draft`, `approved`, `superseded`). Store implementation truth in structured context content instead.

Every approved project context and feature context has:

```ts
current_status: {
  implementation_state: "not_started" | "in_progress" | "implemented" | "blocked" | "unknown";
  summary: string;
  confirmed_by: "human" | "scanner" | "task_outcome";
  confirmed_at: string;
  evidence_paths: string[];
  known_gaps: string[];
}
```

Rules:

- Initial project and feature contexts start as `not_started` unless the scan has concrete evidence otherwise.
- The planner treats `current_status` as the implementation source of truth; it does not infer implemented work from the desired feature list.
- A completed task updates only the affected project or feature `current_status`, with its report/evidence. This is reserved for the later execution/review phase.
- A feature task may only depend on work declared implemented in the relevant project/feature status or an approved active task.

## Task categories and ordering

Tasks gain a `category`:

- `general`: project-wide foundation, architecture, infrastructure, or cross-feature work. It has no feature owner.
- `feature`: work owned by one feature.

General tasks always sort before feature tasks. Within a category, use ascending numeric priority and then creation time.

Database direction:

- Make `tasks.feature_id` nullable.
- Add `tasks.category` (`general` or `feature`).
- Add `tasks.priority`.
- Keep one active task per feature for feature tasks.
- Use a separate constraint/policy for general tasks if we want only one active general task at a time. For the MVP, use one active general task at a time; it keeps the foundation sequential and predictable.

## Planning inputs

For each manual planning trigger, Axiom loads:

1. Approved root project context and its `current_status`.
2. Approved feature context and its `current_status`, when considering a feature task.
3. Folder structure and file metadata only. The planner does not need to re-read code to decide what has already been implemented; status is authoritative.
4. The list of all active tasks, including category, state, priority, objective, and affected feature.
5. Recent completed/rejected task reports and human feedback.
6. Roadmap/future plans and remaining budget.

The planner chooses in this order:

1. Eligible general task, if the project foundation is incomplete or a general dependency is pending.
2. Eligible feature task, only when no higher-priority general task blocks it and the feature has no active task.
3. A clarification request if an essential decision is missing.
4. Nothing when no item is eligible.

The planner creates one proposal per trigger, never a batch.

## Queues shown in the UI

### 1. Proposal queue — human approval

Contains `waiting_for_approval` tasks. Show the high-level purpose, affected scope, expected outcome, risk/dependency summary, and human prerequisites. Keep the full developer prompt hidden in this human view.

Human actions: approve, request changes/leave feedback, or reject/hold.

### 2. Developer queue — ready to implement

Contains approved tasks ordered as:

1. General tasks by priority.
2. Feature tasks by priority.

Later, Docker consumes this queue sequentially. For testing, the human explicitly presses **Run next task**; no automatic queue draining occurs.

### 3. Review queue — work awaiting a decision

Contains `pending_review` tasks with the developer report. The future human decision is:

- Submit/accept: mark task completed and update `current_status`.
- Return to developer: attach feedback and put the task back in the developer queue.

No developer or reviewer execution logic is added in this phase.

## Manual trigger mode for the demo

Keep automation observable but credit-safe:

- **Plan next task** manually invokes one planning pass.
- **Run next task** will be manual when the Docker worker exists.
- **Review next task** will be manual when the review worker exists.

Later, a worker/cron trigger may invoke the same endpoints when a queue changes. The task state machine and ordering must be identical in manual and automatic modes.

## Implementation order

1. Replace the current auto-planning-on-context-approval call with a manual planning trigger.
2. Add the category, priority, and nullable feature ownership migration.
3. Add `current_status` to root and feature context drafts; ensure approval persists it.
4. Change planner eligibility: general-first, status-aware, one proposal per trigger, include active task list.
5. Replace the current proposal card with the three queue UI sections.
6. Add task feedback/rejection state transitions and report fields, but do not execute developer/reviewer models.
7. Only after the queue UI is stable, add Docker execution and review logic.

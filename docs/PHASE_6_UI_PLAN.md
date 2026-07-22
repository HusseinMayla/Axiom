# Phase 6: Mobile-first product UI

## Goal

Turn Axiom's backend harness into a clear, project-scoped control room. The UI must
make human decisions fast—especially a decision on completed work—while preserving
the evidence needed to make that decision responsibly. It must be comfortable to use
from a phone as well as from a desktop browser.

## Product principles

- The human owns task approval, product judgment, and the final merge decision.
- A completed task waiting for a human decision is the highest-priority UI state: it
  blocks the execution loop and must be surfaced before every other action.
- The dashboard is the fast path for workflow decisions. A user should be able to
  approve, reject, request changes, or propose work without navigating away.
- Overview is evidence and project understanding; Configuration contains durable
  operating policies, not day-to-day decisions.
- Use the terms `request`, `task`, `worker`, and `review` consistently.
- Design for a narrow phone viewport first; desktop adds density and side-by-side
  inspection without hiding or changing the core workflow.

## Information architecture

Persistent navigation is project-scoped:

```text
/projects/:projectId/dashboard       Human control centre
/projects/:projectId/overview        Project knowledge and evidence
/projects/:projectId/configuration   Durable controls and harness topology
```

Supporting routes remain outside the persistent workspace:

```text
/projects                         Project picker
/projects/new                     Create a project
/projects/:projectId/setup        Repository connection and discovery wizard
/login                            Authentication
```

`/setup` is intentionally separate from the three main routes. It is a temporary,
linear initialization flow; once project context is approved, the user enters the
Dashboard. A project that still needs setup may redirect there from its project root.

## Shared workspace frame

### Desktop

- Fixed left rail: project switcher, Dashboard, Overview, Configuration, and an
  always-visible worker/automation status.
- Main workspace header: project name, repository state, automation state, and a
  compact `actions required` count.
- The active worker can remain visible as a small status widget, but it must never
  obscure an approval control.

### Mobile

- Sticky top bar: project switcher, connection/automation state, and the current
  action-required count.
- Bottom navigation: Dashboard, Overview, Settings (Configuration). A numeric badge
  on Dashboard represents urgent human decisions.
- Content is one column. Do not compress data tables or three-column queue views into
  an unreadable mobile layout.
- Detail, logs, task proposals, context edits, and graph-node inspection open in
  bottom sheets. They retain a clear close affordance and do not lose the current
  page state.
- On task-review screens, Approve / Request changes / Reject actions are placed in a
  sticky, thumb-reachable bottom action bar.

## Route 1: Dashboard

### Purpose

The Dashboard answers: **What needs my judgment now, and how do I unblock Axiom?**
It is the default project route and supports quick action for users checking work in
short sessions.

### Page order

1. **Unblock Axiom** — a single priority-sorted action stack.
2. **Quick controls** — immediately available, no navigation required.
3. **Now running** — current worker and task progress.
4. **Queue** — compact planned, approved, and blocked task summary.
5. **Recent evidence** — latest validation/review outcome and activity.

### Unblock Axiom priority

Actions are sorted by their effect on automation, not creation time:

1. **Completed work awaiting human decision** (`waiting_for_human_approval`). This
   is highest priority because the task holds the execution loop. The card presents
   the worker report, reviewer verdict, deterministic validation results, changed
   file count, branch/head SHA, and preview/diff links before the decision.
2. **Task-creation approval** (`waiting_for_approval`). Approving a bounded proposal
   lets it enter the executable queue.
3. **Clarifications and unmet required prerequisites.** These prevent planning or
   execution and show the affected task or feature.

Each action card has a primary action and a secondary `View evidence` action. The
usual decision must be possible directly in the card or its mobile bottom sheet:

- Completed work: Merge/handoff, Request retry, or Reject.
- Task proposal: Approve to queue, Edit/request changes, or Decline/archive.
- Clarification: answer and submit; explain which task/feature remains blocked.

### Quick controls

Place these in a persistent action row on desktop and an expandable quick-actions
sheet on mobile:

- Propose next task
- Refresh project context
- Run next approved task / run automation cycle
- Freeze or continue automation

Refreshing context may surface a new suggestion, but the Dashboard only links to that
suggestion. Reviewing or changing context is deliberately performed in Overview,
where the full project brief, constraints, assumptions, and repository evidence give
the human enough information to judge the proposed edit.

### Now running and queue

- Show one active task with phase, elapsed time, active command/step, worker state,
  branch, and a route to activity details.
- Use compact queue counts and task cards rather than a dense kanban board on mobile.
- Clearly distinguish `waiting for you`, `ready to run`, `running`, `blocked`, and
  `retry needed` states with text labels in addition to color.

## Route 2: Overview

### Purpose

Overview answers: **What do we know about this project, what has been delivered, and
what evidence supports the current status?** It is the inspection and orientation
space, not the required-action inbox.

### Sections

1. **Project status** — concise delivery summary, active feature, current task,
   implementation state, and automation health.
2. **Features and implementation** — feature list, priorities, active/completed
   status, current implementation notes, and links to related tasks.
3. **Project context** — approved project brief, technical constraints, active
   assumptions, and context change history. This is the sole place to inspect, edit,
   accept, or dismiss AI-proposed changes to canonical project context. Each
   suggestion displays the proposed diff, rationale, and affected source/context
   before an accept/edit/dismiss decision.
4. **Repository map** — connected repository, language hints, folder tree, inspected
   files, and scan freshness.
5. **Task and delivery history** — completed/rejected/retried tasks, reports,
   validation evidence, branches, and handoff/PR links.

On mobile, folders use a collapsible tree and reports/logs open in bottom sheets or
dedicated detail views; do not render long raw outputs inline by default.

## Route 3: Configuration

### Purpose

Configuration answers: **How is this project allowed to operate, and how is work
flowing through the harness?** It holds durable controls rather than individual task
decisions.

### Settings and controls

- Repository connection and scan/refresh controls.
- Automation state: freeze/continue, run caps, cooldown visibility, and stop reason.
- Execution controls: allowed operational limits, retry policy, and safe worker
  settings exposed by the backend contract.
- AI/planning controls: proposal mode and model/configuration settings only where
  they are deliberate, safe user-facing settings.
- Context refresh policy and the ability to start a new synthesis/suggestion cycle.
- A clear audit/activity entry point for automation events, leases, skips, and
  recoveries.

### Interactive harness topology

Create an Axiom-specific, Cisco Packet Tracer-inspired data-flow view. It is not a
generic flowchart: its entities represent the live harness and animated packets show
actual current or recent activity.

```text
Human --request--> Context engine --> Planner --> Approval gate
  ^                                                    |
  |                                                    v
  +--decision--- Review <---------- Worker <-- approved task
                                      |
                                      v
                               Sandbox / Git branch
```

Nodes: Human, Context engine, Planner, Approval gate, Worker, Sandbox/Git branch,
Review, and optionally the Scheduler/Automation controller. Nodes show their current
state, last event, inputs, and outputs.

Packet semantics:

- Teal: normal context, task, and evidence flow.
- Amber: awaiting human input or approval.
- Blue: active worker execution.
- Red: validation failure, rejected review, or blocked flow.
- Green: approved handoff.

Interaction rules:

- Selecting a node reveals its input/output payload summary, status, and recent
  events—not sensitive content.
- Selecting an amber Approval gate links directly to the relevant Dashboard action.
- The active route pulses subtly; inactive routes remain visible for mental-model
  clarity. Respect `prefers-reduced-motion` by replacing animation with static state
  and explicit labels.
- On mobile, default to `Follow active task`: only the current route is emphasized.
  The graph supports horizontal pan and zoom; node details open in a bottom sheet.

The Dashboard may show a compact read-only version of this map when a worker is
active. The full explorable topology lives in Configuration.

## Visual and accessibility requirements

- Preserve the existing dark operational aesthetic, but use hierarchy and readable
  spacing over decorative density.
- Every state has a text label, icon/shape, and color; color alone is never the only
  signal.
- Meet keyboard navigation and visible-focus requirements on desktop.
- Use responsive touch targets of at least 44 by 44 CSS pixels for mobile controls.
- Do not rely on hover for required evidence or actions.
- Support reduced motion, screen-reader labels for live worker state, and respectful
  live-region announcements only for meaningful state changes.
- Keep raw logs collapsed and fetch/render them on demand where possible.

## Implementation boundaries

- Reorganize existing project-page panels into route-specific, reusable components;
  do not duplicate task state transitions or API behavior in the UI.
- Derive Dashboard priority from server-authoritative task/clarification/prerequisite
  state so a completed-work decision always wins over lower-priority actions.
- Keep URL-addressable task, report, and activity detail views for shareability and
  browser back-navigation, even when the common mobile presentation is a sheet.
- The graph is an observability view over existing activity/task state. It must not
  invent execution state, expose secrets, or become an alternate control plane.

## Definition of done

Phase 6 is complete when a user can, on desktop or phone, enter a project Dashboard,
see completed work awaiting their decision first, review sufficient evidence, make
the decision and unblock the queue; approve proposed work and answer clarifications
without route hunting; inspect project and repository evidence and responsibly
accept/edit/dismiss an AI context suggestion in Overview; and understand the live
harness through an accessible, Packet-Tracer-inspired Configuration topology.

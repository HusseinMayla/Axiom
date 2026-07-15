# Axiom activity diagrams — phase 1

## Project initialization

```mermaid
flowchart TD
    S["New project"] --> Repo{"Codebase connected?"}

    Repo -->|"No / empty"| Wizard["Client-discovery wizard"]
    Wizard --> Answers["Collect structured answers:<br/>problem, users, workflows, MVP scope,<br/>constraints, integrations, brand,<br/>success criteria, deadlines, future plans"]
    Answers --> Discovery{"AI has enough clarity?"}
    Discovery -->|No| Followup["Ask targeted follow-up questions"]
    Followup --> Answers
    Discovery -->|Yes| Draft["Draft project context,<br/>rules, feature map, initial roadmap"]

    Repo -->|Yes| Map["Stage 1: scan repository map,<br/>docs, manifests, configuration"]
    Map --> DeepScan["Stage 2: recursively inspect<br/>relevant source code and entry points"]
    DeepScan --> Coverage{"Context coverage sufficient?"}
    Coverage -->|No| Expand["Inspect more relevant code<br/>or ask human clarification"]
    Expand --> DeepScan
    Coverage -->|Yes| Draft

    Draft --> Confirm["Human reviews and corrects context"]
    Confirm --> Store["Store approved project context"]
```

The wizard acts as a real client-discovery process. It asks about the customer's problem, target users, workflows, desired MVP outcome, integrations, technical constraints, brand, approval boundaries, deadline, and future plans. It does not merely ask, “What project do you want?”

For an existing codebase, Axiom begins with repository metadata but progressively reads relevant code until it has sufficient evidence. Small repositories can be read almost entirely; generated files, dependencies, binaries, build output, and secrets are excluded. Each context summary retains its source files and content hashes.

## Automatic feature-planning loop

```mermaid
flowchart TD
    Trigger["Task finishes or project context changes"] --> Eligible{"Feature is active,<br/>not completed/on hold,<br/>and has no active task?"}

    Eligible -->|No| Stop["Do nothing"]
    Eligible -->|Yes| Budget{"Budget and planning<br/>cooldown available?"}

    Budget -->|No| Stop
    Budget -->|Yes| Context["Load project context,<br/>feature context, related code,<br/>recent task outcomes, roadmap"]

    Context --> Clear{"Enough clarity?"}
    Clear -->|No| Ask["Create clarification request<br/>and pause feature planning"]
    Clear -->|Yes| Propose["Automatically create one<br/>proposed task"]

    Propose --> Execute["Task execution and<br/>human approval flow"]
```

Feature status controls whether planning may continue:

- `active` — Axiom can propose the next bounded task automatically.
- `needs_clarification` — planning pauses for a human answer.
- `on_hold` — the human has paused the feature.
- `completed` — the human considers the feature done.

A task is considered active while it is proposed, queued, running, under review, or waiting for approval. This prevents duplicate task proposals. A project-level roadmap reassessment runs automatically after a small configurable number of approved tasks, or when all active features are idle.

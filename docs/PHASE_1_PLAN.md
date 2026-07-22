# Phase 1 implementation plan — project discovery and context

## Objective

Build the Axiom control plane that turns an empty-project client brief or a connected repository into approved project context, active features, and one automatic task proposal per eligible feature.

This phase deliberately excludes the Docker coding worker, code modification, deployment, pull requests, and task-result review.

## User journey

```text
Create project
  -> choose empty project or connected repository
  -> complete client-discovery wizard / scan repository
  -> Gemini drafts context and feature map
  -> answer any clarification questions
  -> review and approve context
  -> automatically propose the next task for each eligible feature
```

## Delivery sequence

### 1. Application foundation

- Create a Next.js App Router application with TypeScript and Tailwind CSS.
- Add Supabase browser/server clients, environment validation, and a minimal dashboard shell.
- Keep the Gemini key server-only; configure model aliases rather than hard-coding model IDs in feature code.

**Done when:** the app starts locally and reports a useful error if the Supabase configuration is missing.

### 2. Database and security baseline

Create one SQL migration for these Phase 1 tables:

| Table | Purpose |
| --- | --- |
| `projects` | Project name, owner, repository state, lifecycle, budget settings. |
| `project_discovery` | Wizard answers and discovery stage; keep answers as JSONB for speed. |
| `context_nodes` | Versioned draft/approved context: project, repository map, feature, file anchor. |
| `features` | Feature name, priority, status, and planning state. |
| `clarification_questions` | AI questions, human answers, and resolution state. |
| `tasks` | Proposed tasks only; worker fields are postponed. |
| `events` | Append-only human/system/AI audit events. |

Enable Row Level Security and restrict every row to the owning authenticated user. Add a unique partial index so a feature cannot have two active proposed tasks.

**Done when:** the SQL migration runs in Supabase and a user can only access their own project data.

### 3. Project creation and client-discovery wizard

Build `/projects/new` with two entry paths:

- **Empty project:** a multi-section client-discovery wizard.
- **Existing repository:** a repository URL/form placeholder until GitHub App scanning is added.

Wizard sections:

1. Problem and business context
2. Target users and roles
3. Main workflows and desired outcomes
4. MVP scope and non-goals
5. Features and priorities
6. Data, integrations, and external accounts
7. Technical constraints
8. Brand and UI direction
9. Security and approval boundaries
10. Success criteria, deadlines, and future plans

Save a draft after each section. Do not make every question mandatory; instead let the model identify meaningful gaps.

**Done when:** a user can leave, return to, and submit a discovery draft without losing answers.

### 4. Gemini context generation and clarification loop

Implement a server-only AI service with two model tiers:

| Tier | Model | Use |
| --- | --- | --- |
| Fast | `gemini-3.1-flash-lite` | Extraction, normalization, routine structured output. |
| Smart | `gemini-3.5-flash` | Initial synthesis, ambiguous requirements, complex feature decomposition. |

Require Zod-validated structured output for:

- project summary and technical constraints;
- feature proposals and priorities;
- future-plan summary;
- confidence/gaps;
- zero or more clarification questions.

The model may propose context but may not write database rows itself. Route handlers validate the result, save a versioned draft, and log an event.

**Done when:** submitted wizard answers create a context draft or a focused clarification question; answering a question produces an updated draft.

### 5. Human approval and automatic planning

The context screen lets the user edit and approve the project summary and selected features. Approval marks context nodes as approved and sets selected features to `active`.

On context approval and every task state change, run the eligibility check:

```text
feature.status = active
AND no active task exists
AND no open clarification exists
AND project budget remains
=> create exactly one planned task
```

The planner receives only approved project context, one feature's context, relevant recent outcomes, and future-plan context. It returns a bounded task proposal with acceptance criteria and allowed file placeholders.

**Done when:** approving a feature automatically creates one `planned` task and never duplicates it.

### 6. Existing-repository scan (after GitHub App setup)

Implement progressive scanning, not a shallow README-only summary:

1. Collect the file tree, manifests, configuration, and docs.
2. Identify entry points and candidate feature folders.
3. Recursively read relevant source files, excluding dependencies, generated output, binaries, and secrets.
4. Expand the scan or ask a question if context coverage is insufficient.
5. Save traceable repository-map and file-anchor nodes with source paths and content hashes.

**Done when:** a connected repository produces an inspectable repository map and an AI-generated feature draft linked to source files.

## Implementation order for this week

1. Foundation, migration, and project dashboard shell.
2. Empty-project wizard with persisted answers.
3. Gemini draft context and clarification UI.
4. Context approval, features, and automatic first task proposal.
5. GitHub App connection and repository scan only if the first path is polished.

## Environment configuration

Required now:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL_FAST=gemini-3.1-flash-lite
GEMINI_MODEL_SMART=gemini-3.5-flash
```

Later, after the GitHub App is created:

```env
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
```

Never expose `GEMINI_API_KEY`, a Supabase secret key, or GitHub App private key to browser code or commit them to Git.

## Phase 1 demo definition of done

A person can create an empty project, answer the client-discovery wizard, see an AI-generated context draft, answer a clarification question if necessary, approve the context, activate a feature, and observe Axiom propose the first bounded task automatically.

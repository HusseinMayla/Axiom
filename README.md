# Axiom

**Axiom is a human-controlled AI engineering harness.** It turns product intent into a bounded engineering task, coordinates an isolated coding worker, and brings back a tested result for a human decision.

This repository is being built for the [OpenAI Build Week Challenge](https://openai.com/build-week/). The working deadline is **20 July 2026**; the official submission deadline is **21 July 2026**.

## The MVP in one sentence

Axiom uses project context to suggest a useful task (or accepts a direct request), runs approved work in an isolated workspace, and reports the outcome so the human can decide what happens next.

## Demo promise

The demo makes the human visibly responsible for product direction and the final decision. Agents may propose, plan, implement, test, and report; they do not autonomously deploy or merge.

## Built with Codex and GPT-5.6

I built Axiom as a solo developer with Codex, powered by GPT-5.6, as an active part of the development process. I used it to:

- Plan the product architecture and the task lifecycle.
- Pressure-test the safety boundaries of the coding harness.
- Break down implementation work into small, testable changes.
- Implement, debug, and refine the Next.js application and its API routes.
- Design the human-control workflow, dashboard, and task-review experience.
- Review edge cases around tool calls, Docker execution, Git branches, validation, and retries.

Codex was not used as a one-off code generator. It was a collaborative engineering partner throughout the build: helping me move from an idea to a working application while I made the product and technical decisions.

## Product documents

- [Product brief](PRODUCT_BRIEF.md) — problem, users, and the product thesis.
- [MVP scope](MVP_SCOPE.md) — the thin vertical slice, explicit cuts, and acceptance criteria.
- [Architecture](ARCHITECTURE.md) — system boundaries, data model, execution flow, and safety model.
- [Build plan](BUILD_PLAN.md) — five-day implementation and demo plan.
- [Budget](BUDGET.md) — cost model, limits, and service choices.

## Current MVP stack

| Concern | Choice |
| --- | --- |
| Web application and API | Next.js + TypeScript |
| Persistence, auth, realtime | Supabase |
| Runtime AI developer | Google Gemini API with function calling |
| Coding worker | Isolated Docker workspace |
| Repository | GitHub, with one branch per task |

The runtime harness gives the AI developer controlled tools to inspect files, write within the approved scope, run commands, validate the work, and return a structured report.

## Run locally

1. Install Node.js 22+, Docker Desktop, and npm.
2. Create a Supabase project and apply the migrations in `supabase/migrations`.
3. Copy `.env.example` to `.env.local` and add your Supabase, Gemini, and GitHub App credentials.
4. Install dependencies and start the application:

   ```bash
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`, sign in, connect a GitHub repository, then create or approve a task.

The GitHub App must have access to the repository you want Axiom to work on. Docker Desktop must be running before you dispatch a task.

## Repository conventions

- Keep the MVP single-organization and single-repository. Multi-tenancy is not a hackathon requirement.
- Treat all generated code as untrusted until the user approves the diff.
- Store secret *references* in Axiom data; store secret values in AWS Secrets Manager or the deployment environment, never in Supabase rows, task prompts, logs, or Git commits.
- Every state transition and agent report is auditable.

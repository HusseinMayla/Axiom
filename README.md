# Axiom

**Axiom is a human-controlled AI engineering organization.** It turns a product decision into a proposed, reviewable code change by coordinating a planning model, an isolated coding worker, and a human approver.

This repository is being built for the [OpenAI Build Week Challenge](https://openai.com/build-week/). The working deadline is **20 July 2026**; the official submission deadline is **21 July 2026**.

## The MVP in one sentence

A user submits an engineering request, Axiom creates one precise task using project context, an ephemeral worker implements it on a branch, and the user approves or rejects the reviewed diff.

## Demo promise

The demo must make the human visibly responsible for the high-level decision and for the final merge. Agents may propose, plan, implement, test, and report; they do not autonomously deploy or merge.

## Product documents

- [Product brief](PRODUCT_BRIEF.md) — problem, users, and the product thesis.
- [MVP scope](MVP_SCOPE.md) — the thin vertical slice, explicit cuts, and acceptance criteria.
- [Architecture](ARCHITECTURE.md) — system boundaries, data model, execution flow, and safety model.
- [Build plan](BUILD_PLAN.md) — five-day implementation and demo plan.
- [Budget](BUDGET.md) — cost model, limits, and service choices.

## Stack decision for the MVP

| Concern | Choice |
| --- | --- |
| Web application | Next.js on Vercel |
| Control-plane API | AWS API Gateway + Lambda |
| Persistence, auth, realtime | Supabase |
| AI planner and reviewer | OpenAI Responses API (`gpt-5.6-terra` by default; `gpt-5.6` for the single showcase run) |
| Coding worker | A Docker image run as a single AWS ECS Fargate task |
| Queueing | SQS FIFO with one worker consumer |
| Repository | GitHub, with one branch per task |

The stack is intentionally asymmetric: Lambda handles short control-plane requests, while Fargate runs the long-lived, disposable developer container.

## Repository conventions

- Keep the MVP single-organization and single-repository. Multi-tenancy is not a hackathon requirement.
- Treat all generated code as untrusted until the user approves the diff.
- Store secret *references* in Axiom data; store secret values in AWS Secrets Manager or the deployment environment, never in Supabase rows, task prompts, logs, or Git commits.
- Every state transition and agent report is auditable.

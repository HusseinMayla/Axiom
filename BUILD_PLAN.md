# Five-day build and demo plan

## Build order

Build the visible, reliable path first. Do not begin deployment hardening, context automation, or second-agent work until a local seeded repository can complete the full lifecycle.

| Day | Outcome | Deliverables |
| --- | --- | --- |
| 1 — Foundation | A human can create a project and a request. | Next.js shell; Supabase schema/auth; project/task/event tables; seeded demo repository; basic dashboard. |
| 2 — Brain + context | A request becomes a valid task for human dispatch. | Context-node editor/seed; repository map ingestion; structured planner response; task detail screen; cost estimate. |
| 3 — Execution | A task changes a branch, sequentially. | Worker image; local runner first, then ECS Fargate; GitHub App/token flow; SQS FIFO; logs and worker report. |
| 4 — Review + control | A human can trust and decide on the result. | Diff/PR link; Vercel preview URL integration; visual screenshots/videos (Playwright/Puppeteer); reviewer structured report; approval/rejection actions; feedback-to-revised-task path; budget guardrail. |
| 5 — Demo hardening | The story is repeatable. | One 10-minute rehearsed demo; failure states; seed/reset script; screenshots/video; README deployment notes. |

## The first end-to-end test

Use a tiny seed repository owned for the demo. The request should be deliberately simple but visually meaningful, for example:

> Add a dark-mode toggle to the dashboard, preserve the existing design system, update the relevant component and tests, and do not change authentication.

This produces a readable task, a narrow changed-file list, visible test evidence, and a safe human approval moment. Do not use the Axiom production codebase as the first worker target.

## Demo script (about six minutes)

1. Introduce the problem: coding agents are powerful, but the person still has to manage context and risk.
2. Open Axiom's project dashboard and point to the context tree and spend cap.
3. Enter the dark-mode request and show the planner's task contract: file scope, acceptance criteria, and validation command.
4. Dispatch it; show that only one worker can run and that it receives an isolated task.
5. Show the worker result: branch, changed files, tests, and reviewer verdict.
6. Inspect the actual GitHub diff from Axiom, add a short human comment if desired, and approve.
7. End with the principle: humans set direction and approve outcomes; Axiom makes the software work inspectable and repeatable.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| ECS/GitHub integration is delayed | Run the same worker image locally or in a controlled backend environment for the demo; keep the task/approval UI and interfaces unchanged. Do not pretend this is cloud isolation. |
| Coding model is inconsistent | Use the seeded repository and a pre-tested request; let the worker report a failure honestly and demonstrate reject/revise. |
| Model/API quota problem | Use Gemini only for worker experimentation and reserve OpenAI calls for the planner/reviewer showcase. Cache prior successful demo data only as an explicitly labelled replay. |
| Context ingestion is incomplete | Seed the repository map, project summary, and one feature node manually. The important demo is context *selection*, not autonomous documentation generation. |
| Time runs short | Cut GitHub OAuth, multi-repo support, realtime streaming, and Fargate deployment before cutting the approval gate or evidence view. |

## Definition of done for Build Week

The project is done when a judge can watch a real request produce a real branch and a human decision, understand why the agent had the context it used, and see that Axiom constrained execution rather than hiding it.

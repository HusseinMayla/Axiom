# Budget and service strategy

## Recommendation

Set a **hard hackathon variable-spend cap of $20** and an internal Axiom project cap of **$5 per demo project**. This is enough for repeated rehearsals while preventing an accidental agent loop from turning into a surprise bill.

The main variable cost is model output, not the frontend, database, or short worker container. Keep prompts bounded, make a single task per request, and do not retry automatically more than once.

## Five-day build budget

| Category | Working budget | How to control it |
| --- | ---: | --- |
| OpenAI planner/reviewer | $6 | Use `gpt-5.6-terra` for normal planning/review; reserve `gpt-5.6` (Sol) for one polished showcase interaction. |
| Gemini coding-worker experiments | $5 | Start on its free tier if available; switch to paid only with a provider-side quota/budget alert. |
| AWS Lambda/API/SQS/ECR | $0–2 | Keep traffic tiny; use alerts and do not enable provisioned concurrency. |
| ECS Fargate worker runs | $1–3 | One worker at a time, 10-minute timeout, small Linux task, always exit. |
| Vercel + Supabase | $0 | Use the free tiers for the hackathon demo. |
| Contingency | $4 | Only spend after the vertical slice works. |
| **Total** | **$20** | Stop non-essential runs when the cap is reached. |

This is a planning budget, not a promise of provider billing. Prices and free-tier eligibility depend on account, region, and model access; verify the provider dashboards before enabling billing.

## Model routing

| Job | Model choice | Reason |
| --- | --- | --- |
| Plan a task / review a diff | `gpt-5.6-terra` | Current OpenAI docs position Terra as the GPT-5.6 tier balancing intelligence and cost. |
| Showcase a difficult plan or final review | `gpt-5.6` / Sol | Strongest visible reasoning and coding story for the Build Week judges. |
| Coding worker during development | Gemini model behind one provider interface | Lets the demo distinguish Axiom's orchestration layer from the executor and allows low-cost experiments. |

OpenAI lists GPT-5.6 Sol at **$5/M input tokens and $30/M output tokens**, and Terra at **$2.50/M input and $15/M output**. A representative Terra plan with 20k input + 3k output tokens costs about **$0.095** before any tool charges. A Sol showcase call at 20k input + 5k output is about **$0.25**. Keep inputs below 272k tokens: long-context GPT-5.6 requests have higher pricing.

Example Gemini pricing depends on the selected model and tier. Google's current pricing page lists a free tier for some Gemini models and paid prices per token; decide the exact worker model at implementation time and put a spend limit on that provider account. Do not send source code to a free tier unless its data-use terms are acceptable for the selected repository.

## Infrastructure costs

- **Vercel Hobby:** free for the demo. Treat it as a personal/hackathon deployment; check plan terms before a commercial launch.
- **Supabase Free:** currently includes a 500 MB database, 1 GB storage, 5 GB egress, and is paused after one week of inactivity. It is ample for a small demo but not an unattended production service.
- **AWS Lambda:** the published free tier includes 1M requests and 400,000 GB-seconds per month. This control plane should be far below that.
- **Fargate:** use it only for agent execution. In us-east-1, AWS's illustrative 1 vCPU / 2 GB Linux x86 example prices CPU at $0.000011244 per vCPU-second and memory at $0.000001235 per GB-second; a 10-minute run is roughly $0.0082 of compute before logs, image pulls, public IPv4, network transfer, or other AWS services. Regional prices vary.

## Guardrails to implement, not merely document

1. Store `budget_cap_cents`, `spent_estimate_cents`, and `per_run_cap_cents` on the project.
2. Estimate planning cost before dispatch and refuse dispatch over the cap.
3. Set the worker timeout to 10 minutes and max retries to one human-triggered retry.
4. Enforce worker concurrency = 1 per project.
5. Create an AWS Budget with a low alert threshold and enable provider-side limits/alerts for OpenAI and Gemini.
6. Turn off or delete ECS tasks and unused public resources after the demo.

## Sources checked 14 July 2026

- [OpenAI Build Week](https://openai.com/build-week/) — dates and challenge context.
- [OpenAI GPT-5.6 Sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and [model catalog](https://developers.openai.com/api/docs/models) — model positioning and token prices.
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing) — model/tier-dependent pricing and free-tier availability.
- [Vercel pricing](https://vercel.com/pricing) and [Hobby limits](https://vercel.com/docs/plans/hobby) — frontend-tier baseline.
- [Supabase pricing](https://supabase.com/pricing) — free-tier limits and inactivity behavior.
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) and [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/) — serverless and container cost assumptions.

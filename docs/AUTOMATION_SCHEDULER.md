# Automation scheduler deployment

The scheduler endpoint is `POST /api/automation/tick`. It must run on the same
trusted worker environment that can run Docker developer sessions; it is not a
browser endpoint.

Set these server-only environment variables in that environment:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTOMATION_TICK_SECRET` (a long random value)
- the existing Gemini, GitHub App, and Docker worker configuration

Use an external scheduler or worker loop to send this request every 15 seconds:

```http
POST https://your-axiom-host/api/automation/tick
Authorization: Bearer <AUTOMATION_TICK_SECRET>
```

The tick is safe to overlap: planning and delivery use independent durable leases,
and a second tick cannot take a live lease. Long-running actions heartbeat their
lease every minute. If a worker dies, its lease expires after ten minutes and the
next tick records a recovery event before safely reassessing eligibility.

Do not configure this endpoint as a public cron URL or put the secret in client
code. A platform with a 60-second-only cron can trigger it as a fallback, but a
15-second trusted worker loop is the intended cadence for the current harness.

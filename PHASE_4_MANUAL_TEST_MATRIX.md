# Phase 4 Manual Harness Test Matrix

Run these against a disposable repository or branch with the connected GitHub App,
Docker, Supabase migrations `0008` and `0009`, and a Gemini key configured. Each run
must be started manually from the project page; do not queue a second task while one
is running.

## Evidence to capture for every run

- The fixed agent activity widget updates without a page refresh.
- `tasks.execution_attempt_count` never exceeds 30.
- `task_execution_events` shows ordered tool observations and contains no secret
  values, `.env` contents, installation token, or private-key content.
- The final task state and branch outcome match the expected result below.

| Scenario | Setup / task | Expected result |
| --- | --- | --- |
| Existing React edit | Add one small, clearly scoped UI behavior in existing `src/` files. | The developer inspects then edits, validates, and finishes below turn 30. The widget shows each observation; AI review can pass. |
| Dependency/config update | Add a small declared dependency or config-only feature with a validation command. | The lockfile/config files appear in the diff, dependency preparation succeeds, and validation evidence is recorded. |
| Tailwind v4 styling | Apply a style task in a Vite + Tailwind v4 repository. | No `tailwindcss init -p` call occurs. If setup is needed, the diff uses `@tailwindcss/postcss` and `@import "tailwindcss";`. |
| Validation repair | Give a task whose first implementation should trigger a known lint/build error. | The agent receives the failed observation, changes course rather than repeating the exact failure blindly, and finishes or reports a clear blocker. |
| Foundation repository | Use a clone with only a README/docs directory. Ask for a minimal React/Vite UI. | The scaffold is non-interactive, does not loop through scaffold variants, and starter-file replacements are written directly. |
| Allowed-path violation | Create a feature task limited to one directory; ask it to change a file outside it. | `write_files` is blocked before commit/push. The task records a safe failure or retry path. |
| Impossible task | Ask for a capability unavailable to the repository and give no credentials/prerequisite. | It finishes with a specific blocker or evaluator retry; it does not burn turns on repeated commands or push an invalid implementation. |
| Command policy | Ask for an ordinary setup command chained with `&&`, then test a request containing `;`, `||`, a pipe, recursive `rm`, `curl`, or `git push`. | A short dependent `&&` command runs. All other operators/mutations receive a function observation explaining the rejection; the harness stays alive. |
| Rate limit | Temporarily force the Gemini adapter to return 429/quota responses. | Retries occur about every five seconds. After at most 100 seconds of continuous limiting, the run fails with quota/rate-limit feedback rather than hanging. |
| Human cancellation | Start a deliberately slow task, then archive or reset it while a command/model call is active. | The model request/container are stopped, a `cancelled` event is written, the task reports cancellation (not infrastructure failure), and no branch is pushed. |
| Required prerequisite | Plan a task that requires an env variable, provider account, or migration acknowledgement. | The UI displays rationale and verification guidance. Execution is blocked until every required item is acknowledged; optional items do not block. |
| Evaluator retry | Produce a branch that builds but deliberately misses one acceptance criterion. | The reviewer receives only net diff/status/validation/event evidence, returns `retry` with criterion-specific feedback, deletes the branch, and returns the task to `approved`. |

## Pass criteria for Phase 4

Phase 4 is ready for model-tier tuning only after at least one successful existing-app
edit, one dependency/config update, one validation-repair run, evaluator pass and retry,
and human cancellation have been observed in the real connected environment. Record the
task ID, turns used, elapsed time, final state, and any unexpected tool observation for
each run.

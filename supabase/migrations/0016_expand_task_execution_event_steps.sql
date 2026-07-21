-- Preserve a complete terminal trace for high-effort developer runs and AI review.
alter table public.task_execution_events
  drop constraint if exists task_execution_events_step_check,
  add constraint task_execution_events_step_check check (step >= 0 and step <= 100);

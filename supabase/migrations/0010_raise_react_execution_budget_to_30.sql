alter table public.tasks
  drop constraint if exists tasks_execution_attempt_count_check;

alter table public.tasks
  add constraint tasks_execution_attempt_count_check
  check (execution_attempt_count >= 0 and execution_attempt_count <= 30);

alter table public.task_execution_events
  drop constraint if exists task_execution_events_step_check;

alter table public.task_execution_events
  add constraint task_execution_events_step_check
  check (step >= 0 and step <= 31);

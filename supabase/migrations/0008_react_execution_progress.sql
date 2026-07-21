alter table public.tasks
  drop constraint if exists tasks_execution_attempt_count_check;

alter table public.tasks
  add constraint tasks_execution_attempt_count_check
  check (execution_attempt_count >= 0 and execution_attempt_count <= 20);

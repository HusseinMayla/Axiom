alter type public.task_status add value if not exists 'waiting_for_human_approval';

alter table public.tasks
  add column if not exists branch_name text,
  add column if not exists base_sha text,
  add column if not exists head_sha text,
  add column if not exists execution_attempt_count smallint not null default 0 check (execution_attempt_count >= 0 and execution_attempt_count <= 2),
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_finished_at timestamptz,
  add column if not exists execution_logs jsonb not null default '[]'::jsonb;

create index if not exists tasks_project_execution_state_idx
  on public.tasks (project_id, state, category, priority, created_at);

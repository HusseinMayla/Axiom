alter table public.tasks
  add column if not exists archived_at timestamptz;

create index if not exists tasks_project_archived_idx
  on public.tasks(project_id, archived_at, created_at desc);

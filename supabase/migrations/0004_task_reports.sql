alter table public.tasks
  add column if not exists developer_report jsonb not null default '{}'::jsonb,
  add column if not exists review_feedback text,
  add column if not exists reviewed_at timestamptz;

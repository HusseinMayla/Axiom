alter table public.tasks
  add column if not exists human_summary text not null default '',
  add column if not exists developer_prompt text not null default '',
  add column if not exists human_actions jsonb not null default '[]'::jsonb,
  add column if not exists human_actions_completed_at timestamptz,
  add column if not exists human_feedback text,
  add column if not exists planning_context jsonb not null default '{}'::jsonb;

create index if not exists tasks_project_feature_state_idx
  on public.tasks (project_id, feature_id, state, created_at desc);

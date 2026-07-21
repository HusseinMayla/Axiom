alter table public.tasks
  alter column feature_id drop not null,
  add column if not exists category text not null default 'feature' check (category in ('general', 'feature')),
  add column if not exists priority smallint not null default 100 check (priority >= 0 and priority <= 1000);

alter table public.tasks
  add constraint tasks_category_feature_owner_check
  check ((category = 'general' and feature_id is null) or (category = 'feature' and feature_id is not null));

drop index if exists public.one_active_task_per_feature;

create unique index one_active_task_per_feature
  on public.tasks (feature_id)
  where feature_id is not null and state in ('planned', 'queued', 'running', 'pending_review', 'waiting_for_approval', 'approved');

create unique index one_active_general_task
  on public.tasks (category)
  where category = 'general' and state in ('planned', 'queued', 'running', 'pending_review', 'waiting_for_approval', 'approved');

create index tasks_project_category_priority_idx
  on public.tasks (project_id, category, priority, created_at);

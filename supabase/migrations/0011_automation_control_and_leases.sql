alter table public.projects
  add column if not exists automation_state text not null default 'running'
  check (automation_state in ('running', 'frozen')),
  add column if not exists automation_pause_reason text,
  add column if not exists automation_last_action_at timestamptz;

create table if not exists public.automation_leases (
  project_id uuid primary key references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  action text not null check (action in ('propose', 'execute', 'evaluate')),
  owner text not null,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now()
);

create index if not exists automation_leases_expires_at_idx
  on public.automation_leases (expires_at);

alter table public.automation_leases enable row level security;

create policy "Users view their project automation leases" on public.automation_leases
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create table public.task_execution_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  step smallint not null check (step >= 0 and step <= 20),
  tool_name text not null,
  tool_args jsonb not null default '{}'::jsonb,
  tool_result jsonb not null default '{}'::jsonb,
  status text not null check (status in ('running', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index task_execution_events_task_created_idx
  on public.task_execution_events (task_id, created_at);

alter table public.task_execution_events enable row level security;

create policy "Users view their task execution events" on public.task_execution_events
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users create their task execution events" on public.task_execution_events
  for insert with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

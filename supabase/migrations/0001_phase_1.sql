create extension if not exists pgcrypto;

create type public.project_state as enum ('discovery', 'context_draft', 'active', 'on_hold', 'archived');
create type public.context_status as enum ('draft', 'approved', 'superseded');
create type public.feature_status as enum ('draft', 'active', 'needs_clarification', 'on_hold', 'completed');
create type public.question_status as enum ('open', 'answered', 'dismissed');
create type public.task_status as enum ('planned', 'queued', 'running', 'pending_review', 'waiting_for_approval', 'approved', 'rejected', 'completed', 'cancelled', 'failed');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 120),
  repository_url text,
  repository_state text not null default 'empty' check (repository_state in ('empty', 'connected', 'scanning', 'ready')),
  state public.project_state not null default 'discovery',
  budget_cap_cents integer not null default 500 check (budget_cap_cents >= 0),
  spent_estimate_cents integer not null default 0 check (spent_estimate_cents >= 0),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_discovery (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  stage text not null default 'draft' check (stage in ('draft', 'submitted', 'clarifying', 'ready_for_review', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.context_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.context_nodes(id) on delete cascade,
  kind text not null check (kind in ('project', 'repository_map', 'feature', 'file_anchor', 'future_plan', 'instruction')),
  status public.context_status not null default 'draft',
  source text not null check (source in ('human', 'scanner', 'ai_summary')),
  title text not null,
  path text,
  content jsonb not null default '{}'::jsonb,
  content_hash text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  context_node_id uuid references public.context_nodes(id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '',
  priority smallint not null default 0,
  status public.feature_status not null default 'draft',
  planning_lock_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clarification_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id uuid references public.features(id) on delete cascade,
  question text not null,
  rationale text,
  answer text,
  status public.question_status not null default 'open',
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  state public.task_status not null default 'planned',
  objective text not null,
  rationale text not null default '',
  allowed_paths jsonb not null default '[]'::jsonb,
  implementation_steps jsonb not null default '[]'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  validation_commands jsonb not null default '[]'::jsonb,
  context_node_ids jsonb not null default '[]'::jsonb,
  estimated_cost_cents integer not null default 0 check (estimated_cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_type text not null check (actor_type in ('human', 'system', 'ai', 'scanner')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index one_active_task_per_feature
  on public.tasks (feature_id)
  where state in ('planned', 'queued', 'running', 'pending_review', 'waiting_for_approval');

create index context_nodes_project_parent_idx on public.context_nodes (project_id, parent_id);
create index features_project_status_idx on public.features (project_id, status);
create index clarification_questions_project_status_idx on public.clarification_questions (project_id, status);
create index events_project_created_at_idx on public.events (project_id, created_at desc);

alter table public.projects enable row level security;
alter table public.project_discovery enable row level security;
alter table public.context_nodes enable row level security;
alter table public.features enable row level security;
alter table public.clarification_questions enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;

create policy "Users manage their projects" on public.projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Users manage their project discovery" on public.project_discovery
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users manage their context" on public.context_nodes
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users manage their features" on public.features
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users manage their clarifications" on public.clarification_questions
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users manage their tasks" on public.tasks
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users view their events" on public.events
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "Users create their events" on public.events
  for insert with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));


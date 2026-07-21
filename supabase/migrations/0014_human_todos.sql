create type public.human_todo_status as enum ('open', 'completed', 'cancelled', 'superseded');

create table public.human_todos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 280),
  rationale text not null default '' check (char_length(rationale) <= 900),
  suggested_action text not null default '' check (char_length(suggested_action) <= 900),
  status public.human_todo_status not null default 'open',
  human_comment text,
  source text not null default 'ai' check (source in ('ai', 'human')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);

create index human_todos_project_status_created_idx
  on public.human_todos (project_id, status, created_at desc);

alter table public.human_todos enable row level security;

create policy "Users manage their human todos" on public.human_todos
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

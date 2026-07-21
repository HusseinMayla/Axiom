alter table public.projects
  add column if not exists automation_cooldown_until timestamptz,
  add column if not exists automation_cooldown_reason text;

alter table public.tasks
  add column if not exists automation_attempt_count smallint not null default 0 check (automation_attempt_count >= 0 and automation_attempt_count <= 10),
  add column if not exists last_automation_outcome text,
  add column if not exists automation_paused_at timestamptz;

create or replace function public.claim_automation_lease(
  p_project_id uuid,
  p_lane text,
  p_task_id uuid,
  p_action text,
  p_owner text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'Not permitted to claim this automation lease';
  end if;
  if p_lane not in ('planning', 'delivery') then raise exception 'Invalid automation lane'; end if;
  if p_lane = 'planning' and p_action <> 'propose' then raise exception 'Planning lane only supports propose'; end if;
  if p_lane = 'delivery' and p_action not in ('execute', 'evaluate') then raise exception 'Delivery lane only supports execute/evaluate'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then raise exception 'Invalid lease expiry'; end if;

  delete from public.automation_leases
  where project_id = p_project_id and lane = p_lane and expires_at <= now();

  insert into public.automation_leases (project_id, lane, task_id, action, owner, expires_at, heartbeat_at)
  values (p_project_id, p_lane, p_task_id, p_action, p_owner, p_expires_at, now())
  on conflict (project_id, lane) do nothing;

  return found;
end;
$$;

create or replace function public.heartbeat_automation_lease(
  p_project_id uuid,
  p_lane text,
  p_owner text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'Not permitted to heartbeat this automation lease';
  end if;
  if p_lane not in ('planning', 'delivery') or p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'Invalid lease heartbeat';
  end if;

  update public.automation_leases
  set heartbeat_at = now(), expires_at = p_expires_at
  where project_id = p_project_id and lane = p_lane and owner = p_owner and expires_at > now();

  return found;
end;
$$;

create index if not exists projects_automation_cooldown_idx
  on public.projects (automation_cooldown_until)
  where automation_cooldown_until is not null;

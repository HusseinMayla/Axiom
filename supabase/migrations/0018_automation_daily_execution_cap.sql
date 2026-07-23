-- Keep automatic delivery conservative even when more than one scheduler is
-- active. The counter is updated in the same transaction as the lease claim.
alter table public.projects
  add column if not exists automation_daily_run_limit smallint not null default 3
    check (automation_daily_run_limit between 1 and 20),
  add column if not exists automation_run_day date not null default current_date,
  add column if not exists automation_runs_today smallint not null default 0
    check (automation_runs_today >= 0);

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
declare
  v_claimed boolean := false;
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'Not permitted to claim this automation lease';
  end if;
  if p_lane not in ('planning', 'delivery') then raise exception 'Invalid automation lane'; end if;
  if p_lane = 'planning' and p_action <> 'propose' then raise exception 'Planning lane only supports propose'; end if;
  if p_lane = 'delivery' and p_action not in ('execute', 'evaluate') then raise exception 'Delivery lane only supports execute/evaluate'; end if;
  if p_lane = 'delivery' and p_task_id is null then raise exception 'Delivery leases require a task'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then raise exception 'Invalid lease expiry'; end if;

  delete from public.automation_leases
  where project_id = p_project_id and lane = p_lane and expires_at <= now();

  insert into public.automation_leases (project_id, lane, task_id, action, owner, expires_at, heartbeat_at)
  values (p_project_id, p_lane, p_task_id, p_action, p_owner, p_expires_at, now())
  on conflict (project_id, lane) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then return false; end if;

  if p_lane = 'delivery' then
    update public.tasks
    set automation_lease_owner = p_owner,
        updated_at = now()
    where id = p_task_id and project_id = p_project_id;

    if not found then
      raise exception 'Task does not belong to this project';
    end if;
  end if;

  if p_action = 'execute' then
    update public.projects
    set automation_runs_today = case when automation_run_day = current_date then automation_runs_today + 1 else 1 end,
        automation_run_day = current_date,
        updated_at = now()
    where id = p_project_id
      and (automation_run_day <> current_date or automation_runs_today < automation_daily_run_limit);

    if not found then
      delete from public.automation_leases
      where project_id = p_project_id and lane = p_lane and owner = p_owner;
      update public.tasks
      set automation_lease_owner = null,
          updated_at = now()
      where id = p_task_id and project_id = p_project_id and automation_lease_owner = p_owner;
      return false;
    end if;
  end if;

  return true;
end;
$$;

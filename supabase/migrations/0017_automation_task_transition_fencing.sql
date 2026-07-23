-- A delivery lease is also a fence token for the task it operates on. This
-- prevents a worker that lost its lease from overwriting the outcome of a
-- newer worker or lease recovery.
alter table public.tasks
  add column if not exists automation_lease_owner text;

create index if not exists tasks_automation_lease_owner_idx
  on public.tasks (automation_lease_owner)
  where automation_lease_owner is not null;

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

  return true;
end;
$$;

create or replace function public.fail_recovered_automation_task(
  p_project_id uuid,
  p_task_id uuid,
  p_owner text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'Not permitted to recover this automation task';
  end if;

  -- The null case is a one-time rollout fallback for leases created before
  -- this migration. New leases always have an owner recorded on the task.
  update public.tasks
  set state = 'failed',
      execution_finished_at = now(),
      review_feedback = 'Automation worker lease expired before the run completed. A human must acknowledge or reset this task before another execution.',
      last_automation_outcome = 'lease_expired',
      automation_paused_at = now(),
      automation_lease_owner = null,
      updated_at = now()
  where id = p_task_id
    and project_id = p_project_id
    and state = 'running'
    and (automation_lease_owner = p_owner or automation_lease_owner is null);

  return found;
end;
$$;

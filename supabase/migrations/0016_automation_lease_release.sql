create or replace function public.release_automation_lease(
  p_project_id uuid,
  p_lane text,
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
    raise exception 'Not permitted to release this automation lease';
  end if;

  delete from public.automation_leases
  where project_id = p_project_id
    and lane = p_lane
    and owner = p_owner;

  return found;
end;
$$;

create or replace function public.recover_expired_automation_lease(
  p_project_id uuid,
  p_lane text,
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
    raise exception 'Not permitted to recover this automation lease';
  end if;

  delete from public.automation_leases
  where project_id = p_project_id
    and lane = p_lane
    and owner = p_owner
    and expires_at <= now();

  return found;
end;
$$;

create or replace function public.recover_stale_automation_lease(
  p_project_id uuid,
  p_lane text,
  p_owner text,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'Not permitted to recover this automation lease';
  end if;
  if p_lane <> 'planning' then raise exception 'Only planning leases may be recovered as stale'; end if;

  delete from public.automation_leases
  where project_id = p_project_id
    and lane = p_lane
    and owner = p_owner
    and heartbeat_at < p_stale_before;

  return found;
end;
$$;

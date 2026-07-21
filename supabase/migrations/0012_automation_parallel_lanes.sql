alter table public.automation_leases
  add column if not exists lane text;

update public.automation_leases
set lane = case when action = 'propose' then 'planning' else 'delivery' end
where lane is null;

alter table public.automation_leases
  alter column lane set not null,
  drop constraint if exists automation_leases_pkey,
  add constraint automation_leases_pkey primary key (project_id, lane),
  add constraint automation_leases_lane_check check (lane in ('planning', 'delivery'));

create or replace function public.claim_automation_lease(
  p_project_id uuid,
  p_lane text,
  p_task_id uuid,
  p_action text,
  p_owner text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
as $$
begin
  if p_lane not in ('planning', 'delivery') then raise exception 'Invalid automation lane'; end if;
  if p_lane = 'planning' and p_action <> 'propose' then raise exception 'Planning lane only supports propose'; end if;
  if p_lane = 'delivery' and p_action not in ('execute', 'evaluate') then raise exception 'Delivery lane only supports execute/evaluate'; end if;

  delete from public.automation_leases
  where project_id = p_project_id and lane = p_lane and expires_at <= now();

  insert into public.automation_leases (project_id, lane, task_id, action, owner, expires_at)
  values (p_project_id, p_lane, p_task_id, p_action, p_owner, p_expires_at)
  on conflict (project_id, lane) do nothing;

  return found;
end;
$$;

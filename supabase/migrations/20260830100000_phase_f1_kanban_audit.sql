-- F.1: additive audit only. No data backfill, stage renaming or RLS relaxation.
begin;

-- Capability gate: no cached client membership can activate writes without this check.
create or replace function public.kanban_access(target_organization uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller_role text;
begin
  caller_role := public.current_membership_role(target_organization);
  if not coalesce(caller_role in ('owner','manager','agent'),false) then
    raise exception using errcode='42501',message='Kanban access denied';
  end if;
  return jsonb_build_object('role',caller_role,'status','active','version',1);
end; $$;

-- Preserve Phase D API and role rules, but reject NULL roles explicitly.
create or replace function public.assign_lead(target_organization uuid,target_lead uuid,target_user uuid)
returns public.leads language plpgsql volatile security definer set search_path='' as $$
declare previous_user uuid; updated_lead public.leads; action_name text;
begin
  if not coalesce(public.current_membership_role(target_organization) in ('owner','manager'),false) then
    raise exception using errcode='42501',message='Lead assignment access denied';
  end if;
  select assigned_to into previous_user from public.leads where id=target_lead and organization_id=target_organization for update;
  if not found then raise exception using errcode='22023',message='Lead not found in organization'; end if;
  if target_user is not null and not exists(select 1 from public.organization_members where organization_id=target_organization and user_id=target_user and status='active') then
    raise exception using errcode='22023',message='Assignee must be an active member of the same organization';
  end if;
  update public.leads set assigned_to=target_user where id=target_lead and organization_id=target_organization returning * into updated_lead;
  action_name:=case when previous_user is null then 'lead_assigned' else 'lead_transferred' end;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead',target_lead,action_name,jsonb_build_object('previous_assigned_to',previous_user,'new_assigned_to',target_user));
  return updated_lead;
end; $$;

create or replace function public.list_team_members(target_organization uuid)
returns table(user_id uuid,full_name text,email text,role text,status text,joined_at timestamptz,can_manage boolean)
language plpgsql stable security definer set search_path='' as $$
declare caller_role text;
begin
  caller_role:=public.current_membership_role(target_organization);
  if not coalesce(caller_role in ('owner','manager'),false) then
    raise exception using errcode='42501',message='Team management access denied';
  end if;
  return query select m.user_id,p.full_name,u.email::text,m.role,m.status,m.created_at,
    case when caller_role='owner' then m.role<>'owner' else m.role='agent' end
    from public.organization_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
    where m.organization_id=target_organization and (caller_role='owner' or m.role='agent' or m.user_id=auth.uid())
    order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end,lower(p.full_name),m.created_at;
end; $$;

-- The existing team-audit endpoint must not expose the new events via a NULL role.
create or replace function public.list_team_audit(target_organization uuid, result_limit integer default 100)
returns table(id uuid,actor_id uuid,entity_type text,entity_id uuid,action text,metadata jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.current_membership_role(target_organization) in ('owner','manager'),false) then
    raise exception using errcode='42501',message='Audit access denied';
  end if;
  return query select a.id,a.actor_id,a.entity_type,a.entity_id,a.action,a.metadata,a.created_at from public.audit_events a
    where a.organization_id=target_organization order by a.created_at desc limit least(greatest(coalesce(result_limit,100),1),200);
end; $$;

create index if not exists audit_events_lead_history_idx
  on public.audit_events (organization_id, entity_id, created_at desc, id desc)
  where entity_type = 'lead';

create or replace function public.audit_kanban_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.stage is distinct from new.stage then
    insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, action, metadata)
    values (new.organization_id, auth.uid(), 'lead', new.id, 'lead_stage_changed',
      jsonb_build_object('previous_stage', old.stage, 'new_stage', new.stage));
  end if;
  return new;
end; $$;

create or replace function public.audit_kanban_note()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, action, metadata)
  values (new.organization_id, auth.uid(), 'lead', new.lead_id, 'lead_note_created',
    jsonb_build_object('note_id', new.id));
  return new;
end; $$;

-- Replacing these F.1-only triggers makes a repeated application safe.
drop trigger if exists phase_f1_stage_audit on public.leads;
create trigger phase_f1_stage_audit after update of stage on public.leads
  for each row execute function public.audit_kanban_stage();
drop trigger if exists phase_f1_note_audit on public.lead_notes;
create trigger phase_f1_note_audit after insert on public.lead_notes
  for each row execute function public.audit_kanban_note();

create or replace function public.list_lead_activity(target_lead uuid, result_limit integer default 100)
returns table(id uuid, actor_id uuid, action text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare target_org uuid;
begin
  -- Resolve tenant from the entity; caller cannot supply or override it.
  select l.organization_id into target_org from public.leads l where l.id = target_lead;
  if not coalesce(public.can_access_lead(target_lead, target_org), false) then
    raise exception using errcode = '42501', message = 'Lead activity access denied';
  end if;
  return query select a.id, a.actor_id, a.action, a.metadata, a.created_at
    from public.audit_events a
    where a.organization_id = target_org and a.entity_type = 'lead' and a.entity_id = target_lead
      and a.action in ('lead_stage_changed','lead_note_created','lead_assigned','lead_transferred')
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(result_limit,100),1),200);
end; $$;

revoke all on function public.audit_kanban_stage() from public, anon, authenticated;
revoke all on function public.audit_kanban_note() from public, anon, authenticated;
revoke all on function public.list_lead_activity(uuid,integer) from public, anon, authenticated;
grant execute on function public.list_lead_activity(uuid,integer) to authenticated;
revoke all on function public.kanban_access(uuid) from public,anon,authenticated;
grant execute on function public.kanban_access(uuid) to authenticated;
revoke all on function public.assign_lead(uuid,uuid,uuid) from public,anon;
revoke all on function public.list_team_members(uuid) from public,anon;
grant execute on function public.assign_lead(uuid,uuid,uuid),public.list_team_members(uuid) to authenticated;
revoke all on function public.list_team_audit(uuid,integer) from public,anon;
grant execute on function public.list_team_audit(uuid,integer) to authenticated;
commit;

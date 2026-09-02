-- Fase F.2-F.7: CRM avancado. Alteracoes aditivas, sem exclusao de dados.
begin;

-- Fail closed globally: SQL NULL made legacy `role NOT IN (...)` checks unsafe.
create or replace function public.current_membership_role(target_organization uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select m.role from public.organization_members m
    where auth.uid() is not null and target_organization is not null
      and m.organization_id=target_organization and m.user_id=auth.uid() and m.status='active'
    limit 1),'__none__'::text)
$$;

-- F.2: evolve appointments instead of introducing a parallel task system.
alter table public.appointments
  add column if not exists title text not null default 'Acompanhamento',
  add column if not exists priority smallint not null default 2,
  add column if not exists completed_at timestamptz,
  add column if not exists canceled_at timestamptz;
alter table public.appointments drop constraint if exists appointments_kind_check;
alter table public.appointments add constraint appointments_kind_check
  check(kind in ('retorno','visita','tarefa','reuniao'));
alter table public.appointments add constraint appointments_priority_check check(priority between 1 and 3);
update public.appointments set completed_at=coalesce(completed_at,updated_at) where status='concluido';
update public.appointments set canceled_at=coalesce(canceled_at,updated_at) where status='cancelado';
alter table public.appointments add constraint appointments_status_dates_check check(
  (status='concluido' and completed_at is not null and canceled_at is null)
  or (status='cancelado' and canceled_at is not null and completed_at is null)
  or (status='agendado' and completed_at is null and canceled_at is null));
create index if not exists appointments_org_status_scheduled_idx
  on public.appointments(organization_id,status,scheduled_at,id);
create index if not exists appointments_assignee_status_scheduled_idx
  on public.appointments(organization_id,assigned_to,status,scheduled_at);

-- F.3: small, objective preference set; legacy text fields stay intact.
alter table public.leads
  add column if not exists preference_property_type text,
  add column if not exists preference_city text,
  add column if not exists preference_min_price numeric(14,2),
  add column if not exists preference_max_price numeric(14,2),
  add column if not exists preference_min_bedrooms smallint,
  add column if not exists preference_min_area numeric(12,2);
alter table public.leads add constraint leads_preference_prices_check check(
  (preference_min_price is null or preference_min_price>=0) and
  (preference_max_price is null or preference_max_price>=0) and
  (preference_min_price is null or preference_max_price is null or preference_min_price<=preference_max_price));
alter table public.leads add constraint leads_preference_bedrooms_check
  check(preference_min_bedrooms is null or preference_min_bedrooms between 0 and 30);
alter table public.leads add constraint leads_preference_area_check
  check(preference_min_area is null or preference_min_area>=0);
create index if not exists lead_interests_property_code_idx
  on public.lead_interests(organization_id,property_code) where property_code is not null;

-- F.6: organization-owned defaults; alerts are derived, not sent externally.
create table if not exists public.crm_automation_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stale_lead_days smallint not null default 7 check(stale_lead_days between 1 and 90),
  follow_up_reminder_hours smallint not null default 24 check(follow_up_reminder_hours between 1 and 168),
  alert_unassigned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_automation_settings enable row level security;
alter table public.crm_automation_settings force row level security;
create policy "phase_f_automation_settings_select" on public.crm_automation_settings
  for select to authenticated using(public.is_active_organization_member(organization_id));
create policy "phase_f_automation_settings_insert" on public.crm_automation_settings
  for insert to authenticated with check(public.can_operate_organization(organization_id));
create policy "phase_f_automation_settings_update" on public.crm_automation_settings
  for update to authenticated using(public.can_operate_organization(organization_id))
  with check(public.can_operate_organization(organization_id));
revoke all on public.crm_automation_settings from public,anon,authenticated;
grant select on public.crm_automation_settings to authenticated;
grant insert(organization_id,stale_lead_days,follow_up_reminder_hours,alert_unassigned),
  update(stale_lead_days,follow_up_reminder_hours,alert_unassigned) on public.crm_automation_settings to authenticated;
drop trigger if exists crm_automation_settings_updated on public.crm_automation_settings;
create trigger crm_automation_settings_updated before update on public.crm_automation_settings
  for each row execute function public.set_updated_at();
insert into public.crm_automation_settings(organization_id)
  select id from public.organizations on conflict(organization_id) do nothing;
create or replace function public.ensure_crm_automation_settings() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into public.crm_automation_settings(organization_id) values(new.id) on conflict do nothing; return new;
end $$;
drop trigger if exists organizations_crm_automation_settings on public.organizations;
create trigger organizations_crm_automation_settings after insert on public.organizations
  for each row execute function public.ensure_crm_automation_settings();

-- Validated activity writes centralize assignee and cross-tenant rules.
create or replace function public.save_crm_activity(
  target_organization uuid,target_activity uuid,target_lead uuid,target_assignee uuid,
  target_kind text,target_title text,target_scheduled_at timestamptz,target_priority smallint,target_notes text default null)
returns public.appointments language plpgsql volatile security definer set search_path='' as $$
declare role_name text; saved public.appointments; existing public.appointments;
begin
  role_name:=public.current_membership_role(target_organization);
  if role_name not in ('owner','manager','agent') or not public.can_access_lead(target_lead,target_organization) then
    raise exception using errcode='42501',message='Activity access denied'; end if;
  if target_kind not in ('retorno','visita','tarefa','reuniao') or nullif(trim(target_title),'') is null
    or char_length(trim(target_title))>160 or target_scheduled_at is null or target_priority not between 1 and 3 then
    raise exception using errcode='22023',message='Invalid activity'; end if;
  if target_notes is not null and char_length(target_notes)>5000 then raise exception using errcode='22023',message='Activity notes too long'; end if;
  if role_name='agent' and target_assignee is distinct from auth.uid() then raise exception using errcode='42501',message='Agent assignment denied'; end if;
  if target_assignee is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=target_assignee and m.status='active') then
    raise exception using errcode='22023',message='Activity assignee invalid'; end if;
  if target_activity is null then
    insert into public.appointments(organization_id,lead_id,assigned_to,kind,title,scheduled_at,priority,status,notes)
      values(target_organization,target_lead,target_assignee,target_kind,trim(target_title),target_scheduled_at,target_priority,'agendado',nullif(trim(target_notes),'')) returning * into saved;
    insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
      values(target_organization,auth.uid(),'appointment',saved.id,'activity_created',jsonb_build_object('lead_id',target_lead,'kind',target_kind,'scheduled_at',target_scheduled_at,'assigned_to',target_assignee));
  else
    select * into existing from public.appointments a where a.id=target_activity and a.organization_id=target_organization for update;
    if not found or not public.can_access_lead(existing.lead_id,target_organization) then raise exception using errcode='42501',message='Activity access denied'; end if;
    update public.appointments set lead_id=target_lead,assigned_to=target_assignee,kind=target_kind,title=trim(target_title),scheduled_at=target_scheduled_at,priority=target_priority,notes=nullif(trim(target_notes),'') where id=target_activity returning * into saved;
    insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
      values(target_organization,auth.uid(),'appointment',saved.id,'activity_rescheduled',jsonb_build_object('lead_id',target_lead,'previous_scheduled_at',existing.scheduled_at,'new_scheduled_at',target_scheduled_at,'assigned_to',target_assignee));
  end if;
  return saved;
end $$;

create or replace function public.set_crm_activity_status(target_organization uuid,target_activity uuid,target_status text)
returns public.appointments language plpgsql volatile security definer set search_path='' as $$
declare existing public.appointments; saved public.appointments; role_name text;
begin
  role_name:=public.current_membership_role(target_organization);
  select * into existing from public.appointments a where a.id=target_activity and a.organization_id=target_organization for update;
  if role_name not in ('owner','manager','agent') or not found or not public.can_access_lead(existing.lead_id,target_organization) then raise exception using errcode='42501',message='Activity access denied'; end if;
  if target_status not in ('agendado','concluido','cancelado') then raise exception using errcode='22023',message='Invalid activity status'; end if;
  update public.appointments set status=target_status,
    completed_at=case when target_status='concluido' then now() end,
    canceled_at=case when target_status='cancelado' then now() end
    where id=target_activity returning * into saved;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'appointment',target_activity,'activity_status_changed',jsonb_build_object('lead_id',existing.lead_id,'previous_status',existing.status,'new_status',target_status));
  return saved;
end $$;

-- Structured interest audit without removing captured legacy rows.
create or replace function public.audit_phase_f_interest() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(coalesce(new.organization_id,old.organization_id),auth.uid(),'lead',coalesce(new.lead_id,old.lead_id),
      case when tg_op='INSERT' then 'lead_interest_added' else 'lead_interest_removed' end,
      jsonb_build_object('interest_id',coalesce(new.id,old.id),'property_code',coalesce(new.property_code,old.property_code),'source',coalesce(new.source,old.source)));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists phase_f_interest_insert_audit on public.lead_interests;
create trigger phase_f_interest_insert_audit after insert on public.lead_interests for each row execute function public.audit_phase_f_interest();
drop trigger if exists phase_f_interest_delete_audit on public.lead_interests;
create trigger phase_f_interest_delete_audit after delete on public.lead_interests for each row execute function public.audit_phase_f_interest();

create or replace function public.list_lead_activity(target_lead uuid,result_limit integer default 100)
returns table(id uuid,actor_id uuid,action text,metadata jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare target_org uuid;
begin
  select l.organization_id into target_org from public.leads l where l.id=target_lead;
  if not coalesce(public.can_access_lead(target_lead,target_org),false) then raise exception using errcode='42501',message='Lead activity access denied'; end if;
  return query select a.id,a.actor_id,a.action,a.metadata,a.created_at from public.audit_events a
    where a.organization_id=target_org and (
      (a.entity_type='lead' and a.entity_id=target_lead and a.action in ('lead_stage_changed','lead_note_created','lead_assigned','lead_transferred','lead_interest_added','lead_interest_removed'))
      or (a.entity_type='appointment' and a.metadata->>'lead_id'=target_lead::text and a.action in ('activity_created','activity_rescheduled','activity_status_changed')))
    order by a.created_at desc,a.id desc limit least(greatest(coalesce(result_limit,100),1),200);
end $$;

-- Grants for added columns; assignment remains RPC-only.
grant insert(title,priority,completed_at,canceled_at),update(title,priority,completed_at,canceled_at) on public.appointments to authenticated;
grant insert(preference_property_type,preference_city,preference_min_price,preference_max_price,preference_min_bedrooms,preference_min_area),
 update(preference_property_type,preference_city,preference_min_price,preference_max_price,preference_min_bedrooms,preference_min_area) on public.leads to authenticated;
do $$ declare signature text; begin foreach signature in array array[
  'save_crm_activity(uuid,uuid,uuid,uuid,text,text,timestamptz,smallint,text)',
  'set_crm_activity_status(uuid,uuid,text)'] loop
  execute format('revoke all on function public.%s from public,anon',signature);
  execute format('grant execute on function public.%s to authenticated',signature);
end loop; end $$;
revoke all on function public.ensure_crm_automation_settings() from public,anon,authenticated;
revoke all on function public.audit_phase_f_interest() from public,anon,authenticated;

commit;

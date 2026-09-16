-- Bloco 4: equipe, metas, distribuicao, onboarding, importacao e operacao segura.
-- Aditiva, tenant-scoped e sem depender de segredos no cliente.
begin;

alter table public.sales_goals drop constraint if exists sales_goals_metric_check;
alter table public.sales_goals add constraint sales_goals_metric_check
  check (metric in ('contacts','leads','follow_ups','visits','proposals','sales','vgv'));

create table public.user_onboarding_progress (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_steps text[] not null default '{}',
  current_step text,
  skipped_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id,user_id),
  check (current_step is null or current_step in ('profile','organization','first_lead','first_property','overview')),
  check (completed_steps <@ array['profile','organization','first_lead','first_property','overview']::text[])
);

create table public.lead_undo_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  field_name text not null check (field_name in ('stage','assigned_to','temperature')),
  before_value text,
  after_value text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index user_onboarding_user_idx on public.user_onboarding_progress(user_id,updated_at desc);
create index lead_undo_actor_active_idx on public.lead_undo_actions(actor_id,expires_at desc) where consumed_at is null;
create index sales_goals_org_user_period_idx on public.sales_goals(organization_id,user_id,period_start,period_end);

alter table public.user_onboarding_progress enable row level security;
alter table public.user_onboarding_progress force row level security;
alter table public.lead_undo_actions enable row level security;
alter table public.lead_undo_actions force row level security;

create policy onboarding_own_select on public.user_onboarding_progress for select to authenticated
  using (user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy lead_undo_own_select on public.lead_undo_actions for select to authenticated
  using (actor_id=auth.uid() and public.can_access_lead(lead_id,organization_id));

revoke all on public.user_onboarding_progress,public.lead_undo_actions from public,anon,authenticated;
grant select on public.user_onboarding_progress,public.lead_undo_actions to authenticated;
revoke insert,update,delete on public.sales_goals,public.lead_distribution_settings,public.integration_webhooks from authenticated;

create trigger user_onboarding_updated before update on public.user_onboarding_progress
  for each row execute function public.set_updated_at();

create or replace function public.save_onboarding_progress(
  target_organization uuid,target_completed text[],target_current text default null,target_skip boolean default false
) returns public.user_onboarding_progress language plpgsql volatile security definer set search_path='' as $$
declare result public.user_onboarding_progress;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager','agent') then
    raise exception using errcode='42501',message='ONBOARDING_ACCESS_DENIED';
  end if;
  if exists(select 1 from unnest(coalesce(target_completed,'{}')) s where s not in ('profile','organization','first_lead','first_property','overview'))
    or (target_current is not null and target_current not in ('profile','organization','first_lead','first_property','overview')) then
    raise exception using errcode='22023',message='ONBOARDING_INVALID_STEP';
  end if;
  insert into public.user_onboarding_progress(organization_id,user_id,completed_steps,current_step,skipped_at,completed_at)
  values(target_organization,auth.uid(),coalesce(target_completed,'{}'),target_current,
    case when target_skip then now() end,
    case when cardinality(coalesce(target_completed,'{}'))=5 then now() end)
  on conflict(organization_id,user_id) do update set
    completed_steps=excluded.completed_steps,current_step=excluded.current_step,
    skipped_at=coalesce(public.user_onboarding_progress.skipped_at,excluded.skipped_at),
    completed_at=case when cardinality(excluded.completed_steps)=5 then coalesce(public.user_onboarding_progress.completed_at,now()) else public.user_onboarding_progress.completed_at end,
    updated_at=now()
  returning * into result;
  return result;
end $$;

create or replace function public.save_sales_goal(
  target_organization uuid,target_goal uuid,target_user uuid,target_metric text,
  target_start date,target_end date,target_value numeric
) returns public.sales_goals language plpgsql volatile security definer set search_path='' as $$
declare result public.sales_goals;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then
    raise exception using errcode='42501',message='GOAL_ACCESS_DENIED';
  end if;
  if target_metric not in ('contacts','leads','follow_ups','visits','proposals','sales','vgv')
    or target_start is null or target_end is null or target_start>target_end or target_value is null or target_value<0 then
    raise exception using errcode='22023',message='GOAL_INVALID';
  end if;
  if target_user is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=target_user and m.status='active') then
    raise exception using errcode='23514',message='GOAL_MEMBER_INVALID';
  end if;
  if target_goal is null then
    select * into result from public.sales_goals g where g.organization_id=target_organization
      and g.user_id is not distinct from target_user and g.metric=target_metric
      and g.period_start=target_start and g.period_end=target_end for update;
    if result.id is null then
      insert into public.sales_goals(organization_id,user_id,metric,period_start,period_end,target_value,created_by)
      values(target_organization,target_user,target_metric,target_start,target_end,target_value,auth.uid()) returning * into result;
    else
      update public.sales_goals set target_value=save_sales_goal.target_value,updated_at=now() where id=result.id returning * into result;
    end if;
  else
    update public.sales_goals set user_id=target_user,metric=target_metric,period_start=target_start,period_end=target_end,target_value=save_sales_goal.target_value,updated_at=now()
      where id=target_goal and organization_id=target_organization returning * into result;
    if result.id is null then raise exception using errcode='P0002',message='GOAL_NOT_FOUND'; end if;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'sales_goal',result.id,'sales_goal_saved',jsonb_build_object('metric',target_metric,'user_id',target_user,'period_start',target_start,'period_end',target_end));
  return result;
end $$;

create or replace function public.get_team_operations(
  target_organization uuid,target_start timestamptz,target_end timestamptz
) returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then
    raise exception using errcode='42501',message='TEAM_OPERATIONS_ACCESS_DENIED';
  end if;
  if target_start is null or target_end is null or target_start>=target_end or target_end-target_start>interval '2 years' then
    raise exception using errcode='22023',message='TEAM_OPERATIONS_PERIOD_INVALID';
  end if;
  return query
  select jsonb_build_object(
    'user_id',m.user_id,'name',coalesce(nullif(p.full_name,''),'Sem nome'),'role',m.role,'status',m.status,
    'active_leads',(select count(*) from public.leads l where l.organization_id=target_organization and l.assigned_to=m.user_id and l.stage not in ('fechado','perdido')),
    'without_next_action',(select count(*) from public.leads l where l.organization_id=target_organization and l.assigned_to=m.user_id and l.stage not in ('fechado','perdido') and l.next_follow_up is null),
    'activities',(select count(*) from public.appointments a where a.organization_id=target_organization and a.assigned_to=m.user_id and a.created_at>=target_start and a.created_at<target_end),
    'follow_ups',(select count(*) from public.appointments a where a.organization_id=target_organization and a.assigned_to=m.user_id and a.kind='retorno' and a.scheduled_at>=target_start and a.scheduled_at<target_end),
    'overdue',(select count(*) from public.appointments a where a.organization_id=target_organization and a.assigned_to=m.user_id and a.status='agendado' and a.scheduled_at<now()),
    'visits',(select count(*) from public.appointments a where a.organization_id=target_organization and a.assigned_to=m.user_id and a.kind='visita' and a.status<>'cancelado' and a.scheduled_at>=target_start and a.scheduled_at<target_end),
    'proposals',(select count(*) from public.proposals q where q.organization_id=target_organization and q.assigned_to=m.user_id and q.created_at>=target_start and q.created_at<target_end),
    'sales',(select count(*) from public.proposals q where q.organization_id=target_organization and q.assigned_to=m.user_id and q.status='accepted' and coalesce(q.closed_at,q.updated_at)>=target_start and coalesce(q.closed_at,q.updated_at)<target_end),
    'vgv',(select coalesce(sum(coalesce(q.final_price,q.proposed_price)),0) from public.proposals q where q.organization_id=target_organization and q.assigned_to=m.user_id and q.status='accepted' and coalesce(q.closed_at,q.updated_at)>=target_start and coalesce(q.closed_at,q.updated_at)<target_end),
    'commission_expected',(select coalesce(sum(q.commission_expected),0) from public.proposals q where q.organization_id=target_organization and q.assigned_to=m.user_id and q.status='accepted' and coalesce(q.closed_at,q.updated_at)>=target_start and coalesce(q.closed_at,q.updated_at)<target_end),
    'commission_received',(select coalesce(sum(q.commission_received),0) from public.proposals q where q.organization_id=target_organization and q.assigned_to=m.user_id and q.status='accepted' and coalesce(q.closed_at,q.updated_at)>=target_start and coalesce(q.closed_at,q.updated_at)<target_end),
    'acquisitions',(select count(*) from public.property_acquisitions c where c.organization_id=target_organization and c.assigned_to=m.user_id and c.created_at>=target_start and c.created_at<target_end)
  )
  from public.organization_members m left join public.profiles p on p.id=m.user_id
  where m.organization_id=target_organization and m.status='active'
  order by coalesce(nullif(p.full_name,''),m.user_id::text);
end $$;

create or replace function public.get_goal_progress(target_organization uuid,target_start date,target_end date)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text:=public.current_membership_role(target_organization);
begin
  if role_name not in ('owner','manager','agent') then raise exception using errcode='42501',message='GOAL_ACCESS_DENIED'; end if;
  if target_start is null or target_end is null or target_start>target_end then raise exception using errcode='22023',message='GOAL_PERIOD_INVALID'; end if;
  return query
  with goals as (
    select g.* from public.sales_goals g where g.organization_id=target_organization
      and g.period_start=target_start and g.period_end=target_end
      and (role_name in ('owner','manager') or g.user_id=auth.uid())
  ), values_by_goal as (
    select g.id,
      case g.metric
        when 'leads' then (select count(*)::numeric from public.leads l where l.organization_id=target_organization and (g.user_id is null or l.assigned_to=g.user_id) and l.created_at::date between target_start and target_end)
        when 'contacts' then (select count(*)::numeric from public.appointments a where a.organization_id=target_organization and (g.user_id is null or a.assigned_to=g.user_id) and a.status='concluido' and a.completed_at::date between target_start and target_end)
        when 'follow_ups' then (select count(*)::numeric from public.appointments a where a.organization_id=target_organization and (g.user_id is null or a.assigned_to=g.user_id) and a.kind='retorno' and a.status='concluido' and a.completed_at::date between target_start and target_end)
        when 'visits' then (select count(*)::numeric from public.appointments a where a.organization_id=target_organization and (g.user_id is null or a.assigned_to=g.user_id) and a.kind='visita' and a.status='concluido' and a.completed_at::date between target_start and target_end)
        when 'proposals' then (select count(*)::numeric from public.proposals q where q.organization_id=target_organization and (g.user_id is null or q.assigned_to=g.user_id) and q.proposal_date between target_start and target_end)
        when 'sales' then (select count(*)::numeric from public.proposals q where q.organization_id=target_organization and (g.user_id is null or q.assigned_to=g.user_id) and q.status='accepted' and coalesce(q.closed_at::date,q.updated_at::date) between target_start and target_end)
        when 'vgv' then (select coalesce(sum(coalesce(q.final_price,q.proposed_price)),0) from public.proposals q where q.organization_id=target_organization and (g.user_id is null or q.assigned_to=g.user_id) and q.status='accepted' and coalesce(q.closed_at::date,q.updated_at::date) between target_start and target_end)
      end as current_value from goals g
  )
  select jsonb_build_object('id',g.id,'user_id',g.user_id,'metric',g.metric,'period_start',g.period_start,'period_end',g.period_end,
    'target_value',g.target_value,'current_value',v.current_value,'remaining',greatest(g.target_value-v.current_value,0),
    'completed',v.current_value>=g.target_value,'progress_percent',case when g.target_value=0 then case when v.current_value>0 then 100 else 0 end else least(round(v.current_value*100/g.target_value,1),100) end)
  from goals g join values_by_goal v on v.id=g.id order by g.user_id nulls first,g.metric;
end $$;

create or replace function public.import_leads_batch(target_organization uuid,target_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare role_name text:=public.current_membership_role(target_organization); item jsonb; idx int:=0; inserted int:=0; rejected int:=0; lead_id uuid; v_phone text; v_email text; v_name text; result jsonb:='[]'::jsonb;
begin
  if role_name not in ('owner','manager','agent') then raise exception using errcode='42501',message='LEAD_IMPORT_ACCESS_DENIED'; end if;
  if jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows)<1 or jsonb_array_length(target_rows)>250 then raise exception using errcode='22023',message='LEAD_IMPORT_SIZE_INVALID'; end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    idx:=idx+1; v_name:=trim(coalesce(item->>'name','')); v_phone:=public.normalize_crm_phone(item->>'phone'); v_email:=lower(nullif(trim(item->>'email'),''));
    if char_length(v_name)<2 or v_phone is null or (v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      rejected:=rejected+1; result:=result||jsonb_build_array(jsonb_build_object('row',idx,'status','rejected','code','INVALID_DATA'));
    elsif exists(select 1 from public.leads l where l.organization_id=target_organization and (public.normalize_crm_phone(coalesce(l.phone,l.whatsapp))=v_phone or (v_email is not null and lower(l.email)=v_email))) then
      rejected:=rejected+1; result:=result||jsonb_build_array(jsonb_build_object('row',idx,'status','rejected','code','DUPLICATE'));
    else
      insert into public.leads(organization_id,assigned_to,name,phone,whatsapp,email,origin,budget,notes,stage,entered_at)
      values(target_organization,auth.uid(),v_name,v_phone,v_phone,v_email,coalesce(nullif(trim(item->>'origin'),''),'importacao'),nullif(trim(item->>'budget'),''),nullif(trim(item->>'notes'),''),'novo',now()) returning id into lead_id;
      inserted:=inserted+1; result:=result||jsonb_build_array(jsonb_build_object('row',idx,'status','inserted','lead_id',lead_id));
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_id,entity_type,action,metadata)
    values(target_organization,auth.uid(),'lead_import','lead_import_completed',jsonb_build_object('inserted',inserted,'rejected',rejected));
  return jsonb_build_object('inserted',inserted,'rejected',rejected,'rows',result);
end $$;

create or replace function public.review_duplicate_leads(target_organization uuid)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text:=public.current_membership_role(target_organization);
begin
  if role_name not in ('owner','manager','agent') then raise exception using errcode='42501',message='LEAD_DUPLICATE_ACCESS_DENIED'; end if;
  return query select jsonb_build_object('lead_a',a.id,'lead_b',b.id,'name_a',a.name,'name_b',b.name,
    'phone_match',public.normalize_crm_phone(coalesce(a.phone,a.whatsapp))=public.normalize_crm_phone(coalesce(b.phone,b.whatsapp)),
    'email_match',a.email is not null and b.email is not null and lower(a.email)=lower(b.email))
  from public.leads a join public.leads b on a.organization_id=b.organization_id and a.id<b.id
  where a.organization_id=target_organization and public.can_access_lead(a.id,target_organization) and public.can_access_lead(b.id,target_organization)
    and ((public.normalize_crm_phone(coalesce(a.phone,a.whatsapp)) is not null and public.normalize_crm_phone(coalesce(a.phone,a.whatsapp))=public.normalize_crm_phone(coalesce(b.phone,b.whatsapp)))
      or (a.email is not null and b.email is not null and lower(a.email)=lower(b.email)))
  order by a.updated_at desc limit 100;
end $$;

create or replace function public.change_lead_with_undo(target_organization uuid,target_lead uuid,target_expected_updated_at timestamptz,target_field text,target_value text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare current_lead public.leads; saved_lead public.leads; old_value text; action_id uuid; role_name text:=public.current_membership_role(target_organization);
begin
  select * into current_lead from public.leads where id=target_lead and organization_id=target_organization for update;
  if current_lead.id is null or not public.can_access_lead(target_lead,target_organization) then raise exception using errcode='42501',message='LEAD_UNDO_ACCESS_DENIED'; end if;
  if target_expected_updated_at is not null and date_trunc('milliseconds',current_lead.updated_at) is distinct from date_trunc('milliseconds',target_expected_updated_at) then raise exception using errcode='40001',message='CRM_LEAD_CONFLICT'; end if;
  if target_field='stage' then old_value:=current_lead.stage; update public.leads set stage=target_value where id=target_lead;
  elsif target_field='assigned_to' then
    if role_name not in ('owner','manager') then raise exception using errcode='42501',message='LEAD_ASSIGNMENT_ACCESS_DENIED'; end if;
    old_value:=current_lead.assigned_to::text;
    if target_value is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=target_value::uuid and m.status='active') then raise exception using errcode='23514',message='LEAD_ASSIGNEE_INVALID'; end if;
    update public.leads set assigned_to=nullif(target_value,'')::uuid where id=target_lead;
  elsif target_field='temperature' then old_value:=current_lead.temperature; update public.leads set temperature=target_value where id=target_lead;
  else raise exception using errcode='22023',message='LEAD_UNDO_FIELD_INVALID'; end if;
  insert into public.lead_undo_actions(organization_id,lead_id,actor_id,field_name,before_value,after_value)
    values(target_organization,target_lead,auth.uid(),target_field,old_value,target_value) returning id into action_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead',target_lead,'lead_change_with_undo',jsonb_build_object('field',target_field,'undo_id',action_id));
  select * into saved_lead from public.leads where id=target_lead;
  return jsonb_build_object('lead',to_jsonb(saved_lead),'undo_id',action_id,'expires_at',now()+interval '10 minutes');
end $$;

create or replace function public.undo_lead_change(target_organization uuid,target_action uuid)
returns public.leads language plpgsql volatile security definer set search_path='' as $$
declare action_row public.lead_undo_actions; result public.leads;
begin
  select * into action_row from public.lead_undo_actions where id=target_action and organization_id=target_organization and actor_id=auth.uid() for update;
  if action_row.id is null or action_row.consumed_at is not null or action_row.expires_at<now() or not public.can_access_lead(action_row.lead_id,target_organization) then raise exception using errcode='42501',message='LEAD_UNDO_UNAVAILABLE'; end if;
  if action_row.field_name='stage' then update public.leads set stage=action_row.before_value where id=action_row.lead_id;
  elsif action_row.field_name='assigned_to' then update public.leads set assigned_to=nullif(action_row.before_value,'')::uuid where id=action_row.lead_id;
  elsif action_row.field_name='temperature' then update public.leads set temperature=action_row.before_value where id=action_row.lead_id; end if;
  update public.lead_undo_actions set consumed_at=now() where id=action_row.id;
  select * into result from public.leads where id=action_row.lead_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead',action_row.lead_id,'lead_change_undone',jsonb_build_object('field',action_row.field_name,'undo_id',action_row.id));
  return result;
end $$;

create or replace function public.configure_lead_distribution(target_organization uuid,target_mode text,target_enabled boolean,target_rules jsonb default '{}'::jsonb)
returns public.lead_distribution_settings language plpgsql volatile security definer set search_path='' as $$
declare result public.lead_distribution_settings; referenced text;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='LEAD_DISTRIBUTION_ACCESS_DENIED'; end if;
  if target_mode not in ('manual','round_robin','smallest_portfolio','by_source','by_property') or jsonb_typeof(coalesce(target_rules,'{}'))<>'object' then raise exception using errcode='22023',message='LEAD_DISTRIBUTION_INVALID'; end if;
  for referenced in select value from jsonb_each_text(coalesce(target_rules,'{}')) loop
    if referenced !~ '^[0-9a-f-]{36}$' or not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=referenced::uuid and m.status='active' and m.role in ('manager','agent')) then raise exception using errcode='23514',message='LEAD_DISTRIBUTION_MEMBER_INVALID'; end if;
  end loop;
  insert into public.lead_distribution_settings(organization_id,mode,enabled,rules,updated_by)
    values(target_organization,target_mode,coalesce(target_enabled,false),coalesce(target_rules,'{}'),auth.uid())
    on conflict(organization_id) do update set mode=excluded.mode,enabled=excluded.enabled,rules=excluded.rules,updated_by=auth.uid(),updated_at=now()
    returning * into result;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead_distribution',target_organization,'distribution_configured',jsonb_build_object('mode',target_mode,'enabled',target_enabled));
  return result;
end $$;

create or replace function public.assign_lead_by_rule(target_lead uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_org uuid; settings public.lead_distribution_settings; chosen uuid; lead_origin text; lead_property text; eligible uuid[]; cursor_pos int;
begin
  select organization_id,origin,property_code into target_org,lead_origin,lead_property from public.leads where id=target_lead;
  if target_org is null or public.current_membership_role(target_org) not in ('owner','manager') then raise exception using errcode='42501',message='LEAD_ASSIGNMENT_ACCESS_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vcimob-distribution-'||target_org::text,0));
  select * into settings from public.lead_distribution_settings where organization_id=target_org for update;
  if settings is null or not settings.enabled or settings.mode='manual' then return null; end if;
  select array_agg(m.user_id order by m.created_at,m.user_id) into eligible from public.organization_members m where m.organization_id=target_org and m.status='active' and m.role in ('manager','agent');
  if coalesce(cardinality(eligible),0)=0 then return null; end if;
  if settings.mode='round_robin' then
    cursor_pos:=coalesce(array_position(eligible,settings.last_assigned_user_id),0)+1; if cursor_pos>cardinality(eligible) then cursor_pos:=1; end if; chosen:=eligible[cursor_pos];
  elsif settings.mode='smallest_portfolio' then
    select member into chosen from unnest(eligible) member left join public.leads l on l.organization_id=target_org and l.assigned_to=member and l.stage not in ('fechado','perdido') group by member order by count(l.id),member limit 1;
  elsif settings.mode='by_source' then chosen:=nullif(settings.rules->>coalesce(lead_origin,''),'')::uuid;
  elsif settings.mode='by_property' then chosen:=nullif(settings.rules->>coalesce(lead_property,''),'')::uuid; end if;
  if chosen is null or not(chosen=any(eligible)) then return null; end if;
  update public.leads set assigned_to=chosen,updated_at=now() where id=target_lead and organization_id=target_org;
  update public.lead_distribution_settings set last_assigned_user_id=chosen,updated_by=auth.uid(),updated_at=now() where organization_id=target_org;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_org,auth.uid(),'lead',target_lead,'lead_auto_assigned',jsonb_build_object('assignee',chosen,'mode',settings.mode));
  return chosen;
end $$;

create or replace function public.create_integration_webhook(target_organization uuid,target_name text,target_url text,target_events text[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result public.integration_webhooks; raw_secret text:=encode(extensions.gen_random_bytes(32),'hex'); allowed constant text[]:=array['lead.created','lead.updated','property.published','proposal.updated','appointment.updated'];
begin
  if public.current_membership_role(target_organization)<>'owner' then raise exception using errcode='42501',message='WEBHOOK_ACCESS_DENIED'; end if;
  if char_length(trim(coalesce(target_name,''))) not between 2 and 100 or target_url !~ '^https://[^[:space:]]+$' or coalesce(cardinality(target_events),0) not between 1 and 20 or exists(select 1 from unnest(target_events) e where not(e=any(allowed))) then raise exception using errcode='22023',message='WEBHOOK_INVALID'; end if;
  insert into public.integration_webhooks(organization_id,name,endpoint_url,events,secret_hash,enabled,created_by)
    values(target_organization,trim(target_name),target_url,target_events,encode(extensions.digest(raw_secret,'sha256'),'hex'),false,auth.uid()) returning * into result;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'integration_webhook',result.id,'webhook_created',jsonb_build_object('events',target_events,'enabled',false));
  return jsonb_build_object('id',result.id,'secret',raw_secret,'enabled',false);
end $$;

revoke all on function public.save_onboarding_progress(uuid,text[],text,boolean),public.save_sales_goal(uuid,uuid,uuid,text,date,date,numeric),public.get_team_operations(uuid,timestamptz,timestamptz),public.get_goal_progress(uuid,date,date),public.import_leads_batch(uuid,jsonb),public.review_duplicate_leads(uuid),public.change_lead_with_undo(uuid,uuid,timestamptz,text,text),public.undo_lead_change(uuid,uuid),public.configure_lead_distribution(uuid,text,boolean,jsonb),public.assign_lead_by_rule(uuid),public.create_integration_webhook(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.save_onboarding_progress(uuid,text[],text,boolean),public.save_sales_goal(uuid,uuid,uuid,text,date,date,numeric),public.get_team_operations(uuid,timestamptz,timestamptz),public.get_goal_progress(uuid,date,date),public.import_leads_batch(uuid,jsonb),public.review_duplicate_leads(uuid),public.change_lead_with_undo(uuid,uuid,timestamptz,text,text),public.undo_lead_change(uuid,uuid),public.configure_lead_distribution(uuid,text,boolean,jsonb),public.assign_lead_by_rule(uuid),public.create_integration_webhook(uuid,text,text,text[]) to authenticated;

commit;

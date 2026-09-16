-- Rodada final pós-beta: captação, marketing, metas e preferências operacionais.
-- Estruturas aditivas, tenant-scoped e sem qualquer segredo no cliente.
begin;

alter table public.organizations
  add column if not exists trade_name text,
  add column if not exists public_phone text,
  add column if not exists public_whatsapp text,
  add column if not exists creci text,
  add column if not exists logo_url text,
  add column if not exists brand_primary_color text,
  add column if not exists commercial_signature text;

create table public.property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  phone text,
  email text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create table public.property_acquisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 180),
  property_type text,
  neighborhood text,
  estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  stage text not null default 'new_contact' check (stage in ('new_contact','qualification','technical_visit','documentation','negotiation','authorization','acquired','lost')),
  loss_reason text check (loss_reason is null or loss_reason in ('price','financing','sold','location','withdrawal','competitor','no_response','timing','other')),
  next_action_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage = 'lost' or loss_reason is null)
);

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  source text not null,
  medium text,
  campaign text,
  content text,
  term text,
  landing_page text,
  property_id uuid references public.properties(id) on delete set null,
  cost numeric(14,2) check (cost is null or cost >= 0),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('draft','active','paused','finished')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

alter table public.leads
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists landing_page text,
  add column if not exists marketing_campaign_id uuid references public.marketing_campaigns(id) on delete set null;

create table public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  metric text not null check (metric in ('leads','contacts','visits','proposals','sales','vgv')),
  period_start date not null,
  period_end date not null,
  target_value numeric(16,2) not null check (target_value >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,user_id,metric,period_start,period_end),
  check (period_start <= period_end)
);

create table public.lead_distribution_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mode text not null default 'manual' check (mode in ('manual','round_robin','smallest_portfolio','by_source','by_property')),
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  last_assigned_user_id uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.user_dashboard_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visible_widgets text[] not null default array['my_day','opportunities','agenda','proposals','matching','site_status'],
  widget_order text[] not null default array['my_day','opportunities','agenda','proposals','matching','site_status'],
  updated_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  events text[] not null check (cardinality(events) between 1 and 20),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_delivery_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_id uuid not null references public.integration_webhooks(id) on delete cascade,
  event_name text not null,
  event_id uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','delivered','retrying','failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz,
  response_status smallint,
  last_error_code text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (webhook_id,event_id)
);

create index property_owners_org_name_idx on public.property_owners(organization_id,lower(full_name));
create index property_acquisitions_org_stage_idx on public.property_acquisitions(organization_id,stage,updated_at desc);
create index property_acquisitions_assignee_idx on public.property_acquisitions(organization_id,assigned_to,stage);
create index marketing_campaigns_org_status_idx on public.marketing_campaigns(organization_id,status,starts_on desc);
create index leads_marketing_campaign_idx on public.leads(organization_id,marketing_campaign_id) where marketing_campaign_id is not null;
create index sales_goals_org_period_idx on public.sales_goals(organization_id,period_start,period_end);
create index webhook_delivery_retry_idx on public.webhook_delivery_log(status,next_attempt_at) where status in ('pending','retrying');

alter table public.property_owners enable row level security; alter table public.property_owners force row level security;
alter table public.property_acquisitions enable row level security; alter table public.property_acquisitions force row level security;
alter table public.marketing_campaigns enable row level security; alter table public.marketing_campaigns force row level security;
alter table public.sales_goals enable row level security; alter table public.sales_goals force row level security;
alter table public.lead_distribution_settings enable row level security; alter table public.lead_distribution_settings force row level security;
alter table public.user_dashboard_preferences enable row level security; alter table public.user_dashboard_preferences force row level security;
alter table public.integration_webhooks enable row level security; alter table public.integration_webhooks force row level security;
alter table public.webhook_delivery_log enable row level security; alter table public.webhook_delivery_log force row level security;

create policy owners_manage on public.property_owners for all to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager'))
  with check (public.current_membership_role(organization_id) in ('owner','manager'));
create policy acquisitions_select on public.property_acquisitions for select to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager') or assigned_to=auth.uid());
create policy acquisitions_manage on public.property_acquisitions for all to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager'))
  with check (public.current_membership_role(organization_id) in ('owner','manager'));
create policy campaigns_manage on public.marketing_campaigns for all to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager'))
  with check (public.current_membership_role(organization_id) in ('owner','manager'));
create policy goals_select on public.sales_goals for select to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager') or user_id=auth.uid());
create policy goals_manage on public.sales_goals for all to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager'))
  with check (public.current_membership_role(organization_id) in ('owner','manager'));
create policy distribution_manage on public.lead_distribution_settings for all to authenticated
  using (public.current_membership_role(organization_id) in ('owner','manager'))
  with check (public.current_membership_role(organization_id) in ('owner','manager'));
create policy dashboard_preferences_own on public.user_dashboard_preferences for all to authenticated
  using (user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'))
  with check (user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy webhooks_manage on public.integration_webhooks for all to authenticated
  using (public.current_membership_role(organization_id)='owner')
  with check (public.current_membership_role(organization_id)='owner');
create policy webhook_logs_select on public.webhook_delivery_log for select to authenticated
  using (public.current_membership_role(organization_id)='owner');

revoke all on public.property_owners,public.property_acquisitions,public.marketing_campaigns,public.sales_goals,public.lead_distribution_settings,public.user_dashboard_preferences,public.integration_webhooks,public.webhook_delivery_log from public,anon,authenticated;
grant select,insert,update,delete on public.property_owners,public.property_acquisitions,public.marketing_campaigns,public.sales_goals,public.lead_distribution_settings,public.user_dashboard_preferences,public.integration_webhooks to authenticated;
grant select on public.webhook_delivery_log to authenticated;
grant insert(utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,marketing_campaign_id), update(utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,marketing_campaign_id) on public.leads to authenticated;

create trigger property_owners_updated before update on public.property_owners for each row execute function public.set_updated_at();
create trigger property_acquisitions_updated before update on public.property_acquisitions for each row execute function public.set_updated_at();
create trigger marketing_campaigns_updated before update on public.marketing_campaigns for each row execute function public.set_updated_at();
create trigger sales_goals_updated before update on public.sales_goals for each row execute function public.set_updated_at();
create trigger distribution_settings_updated before update on public.lead_distribution_settings for each row execute function public.set_updated_at();
create trigger dashboard_preferences_updated before update on public.user_dashboard_preferences for each row execute function public.set_updated_at();
create trigger integration_webhooks_updated before update on public.integration_webhooks for each row execute function public.set_updated_at();

create or replace function public.validate_acquisition_tenant_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.property_owners o where o.id=new.owner_id and o.organization_id=new.organization_id)
    or (new.property_id is not null and not exists(select 1 from public.properties p where p.id=new.property_id and p.organization_id=new.organization_id))
    or (new.assigned_to is not null and not exists(select 1 from public.organization_members m where m.organization_id=new.organization_id and m.user_id=new.assigned_to and m.status='active'))
  then raise exception using errcode='23514',message='Cross-tenant acquisition reference denied'; end if;
  return new;
end $$;
create or replace function public.validate_campaign_tenant_reference() returns trigger language plpgsql security definer set search_path='' as $$ begin if new.property_id is not null and not exists(select 1 from public.properties p where p.id=new.property_id and p.organization_id=new.organization_id) then raise exception using errcode='23514',message='Cross-tenant campaign reference denied'; end if; return new; end $$;
create or replace function public.validate_goal_tenant_reference() returns trigger language plpgsql security definer set search_path='' as $$ begin if new.user_id is not null and not exists(select 1 from public.organization_members m where m.organization_id=new.organization_id and m.user_id=new.user_id and m.status='active') then raise exception using errcode='23514',message='Cross-tenant goal reference denied'; end if; return new; end $$;
create or replace function public.validate_distribution_tenant_reference() returns trigger language plpgsql security definer set search_path='' as $$ begin if new.last_assigned_user_id is not null and not exists(select 1 from public.organization_members m where m.organization_id=new.organization_id and m.user_id=new.last_assigned_user_id and m.status='active') then raise exception using errcode='23514',message='Cross-tenant distribution reference denied'; end if; return new; end $$;
create or replace function public.validate_lead_campaign_tenant_reference() returns trigger language plpgsql security definer set search_path='' as $$ begin if new.marketing_campaign_id is not null and not exists(select 1 from public.marketing_campaigns c where c.id=new.marketing_campaign_id and c.organization_id=new.organization_id) then raise exception using errcode='23514',message='Cross-tenant campaign attribution denied'; end if; return new; end $$;
revoke all on function public.validate_acquisition_tenant_reference(),public.validate_campaign_tenant_reference(),public.validate_goal_tenant_reference(),public.validate_distribution_tenant_reference(),public.validate_lead_campaign_tenant_reference() from public,anon,authenticated;
create trigger acquisitions_tenant_reference before insert or update on public.property_acquisitions for each row execute function public.validate_acquisition_tenant_reference();
create trigger campaigns_tenant_reference before insert or update on public.marketing_campaigns for each row execute function public.validate_campaign_tenant_reference();
create trigger goals_tenant_reference before insert or update on public.sales_goals for each row execute function public.validate_goal_tenant_reference();
create trigger distribution_tenant_reference before insert or update on public.lead_distribution_settings for each row execute function public.validate_distribution_tenant_reference();
create trigger lead_campaign_tenant_reference before insert or update of marketing_campaign_id on public.leads for each row execute function public.validate_lead_campaign_tenant_reference();

create or replace function public.configure_lead_distribution(target_organization uuid,target_mode text,target_enabled boolean,target_rules jsonb default '{}'::jsonb)
returns public.lead_distribution_settings language plpgsql volatile security definer set search_path='' as $$
declare result public.lead_distribution_settings;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Lead distribution access denied'; end if;
  if target_mode not in ('manual','round_robin','smallest_portfolio','by_source','by_property') or jsonb_typeof(coalesce(target_rules,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='Invalid distribution settings'; end if;
  insert into public.lead_distribution_settings(organization_id,mode,enabled,rules,updated_by)
  values(target_organization,target_mode,coalesce(target_enabled,false),coalesce(target_rules,'{}'::jsonb),auth.uid())
  on conflict(organization_id) do update set mode=excluded.mode,enabled=excluded.enabled,rules=excluded.rules,updated_by=auth.uid(),updated_at=now()
  returning * into result;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
  values(target_organization,auth.uid(),'lead_distribution',target_organization,'distribution_configured',jsonb_build_object('mode',target_mode,'enabled',target_enabled));
  return result;
end $$;

create or replace function public.assign_lead_by_rule(target_lead uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_org uuid; settings public.lead_distribution_settings; chosen uuid; actor_role text;
begin
  select l.organization_id into target_org from public.leads l where l.id=target_lead;
  actor_role:=public.current_membership_role(target_org);
  if actor_role not in ('owner','manager') then raise exception using errcode='42501',message='Lead assignment access denied'; end if;
  select * into settings from public.lead_distribution_settings s where s.organization_id=target_org for update;
  if settings is null or not settings.enabled or settings.mode='manual' then return null; end if;
  if settings.mode='round_robin' then
    select m.user_id into chosen from public.organization_members m
      where m.organization_id=target_org and m.status='active' and m.role in ('manager','agent')
      order by case when settings.last_assigned_user_id is null then 0 when m.user_id=settings.last_assigned_user_id then 2 else 1 end,m.created_at,m.user_id limit 1;
  elsif settings.mode='smallest_portfolio' then
    select m.user_id into chosen from public.organization_members m left join public.leads l on l.organization_id=m.organization_id and l.assigned_to=m.user_id and l.stage not in ('fechado','perdido')
      where m.organization_id=target_org and m.status='active' and m.role in ('manager','agent') group by m.user_id,m.created_at order by count(l.id),m.created_at,m.user_id limit 1;
  else
    select nullif(settings.rules->>case when settings.mode='by_source' then coalesce((select origin from public.leads where id=target_lead),'') else coalesce((select property_code from public.leads where id=target_lead),'') end,'')::uuid into chosen;
    if not exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=chosen and m.status='active' and m.role in ('manager','agent')) then chosen:=null; end if;
  end if;
  if chosen is null then return null; end if;
  update public.leads set assigned_to=chosen,updated_at=now() where id=target_lead and organization_id=target_org;
  update public.lead_distribution_settings set last_assigned_user_id=chosen,updated_by=auth.uid(),updated_at=now() where organization_id=target_org;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_org,auth.uid(),'lead',target_lead,'lead_auto_assigned',jsonb_build_object('assignee',chosen,'mode',settings.mode));
  return chosen;
end $$;

create or replace function public.save_dashboard_preferences(target_organization uuid,target_visible text[],target_order text[])
returns public.user_dashboard_preferences language plpgsql volatile security definer set search_path='' as $$
declare result public.user_dashboard_preferences; allowed constant text[]:=array['my_day','opportunities','agenda','proposals','matching','team','site_status','results'];
begin
  if public.current_membership_role(target_organization) not in ('owner','manager','agent') then raise exception using errcode='42501',message='Dashboard access denied'; end if;
  if coalesce(cardinality(target_visible),0)>8 or coalesce(cardinality(target_order),0)>8 or exists(select 1 from unnest(coalesce(target_visible,'{}')) v where not(v=any(allowed))) or exists(select 1 from unnest(coalesce(target_order,'{}')) v where not(v=any(allowed))) then raise exception using errcode='22023',message='Invalid dashboard preferences'; end if;
  insert into public.user_dashboard_preferences(organization_id,user_id,visible_widgets,widget_order) values(target_organization,auth.uid(),coalesce(target_visible,'{}'),coalesce(target_order,'{}'))
  on conflict(organization_id,user_id) do update set visible_widgets=excluded.visible_widgets,widget_order=excluded.widget_order,updated_at=now() returning * into result;
  return result;
end $$;

create or replace function public.update_organization_branding(target_organization uuid,payload jsonb)
returns public.organizations language plpgsql volatile security definer set search_path='' as $$
declare result public.organizations; color text:=nullif(payload->>'brand_primary_color','');
begin
  if public.current_membership_role(target_organization)<>'owner' then raise exception using errcode='42501',message='Organization settings access denied'; end if;
  if color is not null and color !~ '^#[0-9A-Fa-f]{6}$' then raise exception using errcode='22023',message='Invalid brand color'; end if;
  update public.organizations set name=coalesce(nullif(trim(payload->>'name'),''),name),trade_name=nullif(trim(payload->>'trade_name'),''),public_phone=nullif(payload->>'public_phone',''),public_whatsapp=nullif(payload->>'public_whatsapp',''),creci=nullif(trim(payload->>'creci'),''),logo_url=nullif(payload->>'logo_url',''),brand_primary_color=color,commercial_signature=nullif(trim(payload->>'commercial_signature'),'') where id=target_organization returning * into result;
  if result.id is null then raise exception using errcode='P0002',message='Organization not found'; end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'organization',target_organization,'organization_branding_updated','{}');
  return result;
end $$;

revoke all on function public.configure_lead_distribution(uuid,text,boolean,jsonb),public.assign_lead_by_rule(uuid),public.save_dashboard_preferences(uuid,text[],text[]),public.update_organization_branding(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_lead_distribution(uuid,text,boolean,jsonb),public.assign_lead_by_rule(uuid),public.save_dashboard_preferences(uuid,text[],text[]),public.update_organization_branding(uuid,jsonb) to authenticated;

commit;

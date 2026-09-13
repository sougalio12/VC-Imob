-- Fase I: cadastro publico, trial de 7 dias, entitlement central e lifecycle de conta.
-- Migration aditiva: nao altera assinaturas existentes nem remove dados comerciais.
begin;

alter table public.plans
  add column if not exists annual_price_cents integer check (annual_price_cents is null or annual_price_cents >= 0);

update public.plans
set trial_days = 7,
    annual_price_cents = case code
      when 'start' then 39900
      when 'pro' then 79900
      when 'equipe' then 149900
    end
where code in ('start', 'pro', 'equipe');

alter table public.profiles
  add column if not exists phone text,
  add column if not exists creci text,
  add column if not exists signup_completed_at timestamptz;

alter table public.subscriptions
  add column if not exists billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  add column if not exists trial_starts_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists revoked_at timestamptz;

alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('trialing','active','past_due','grace_period','canceled','expired','refunded','revoked'));

create table if not exists public.trial_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id),
  unique (organization_id),
  check (ends_at = started_at + interval '7 days')
);

create table if not exists public.account_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  terms_version text not null check (char_length(trim(terms_version)) between 1 and 80),
  privacy_version text not null check (char_length(trim(privacy_version)) between 1 and 80),
  accepted_at timestamptz not null default now(),
  source text not null default 'public_signup' check (source in ('public_signup','admin_import')),
  unique (user_id, terms_version, privacy_version)
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  membership_role text not null check (membership_role in ('owner','manager','agent')),
  scope text not null check (scope in ('account','organization')),
  status text not null default 'pending_review' check (status in ('pending_review','approved','completed','rejected','canceled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check ((status = 'completed') = (completed_at is not null))
);

create unique index if not exists account_deletion_one_pending_per_user_idx
  on public.account_deletion_requests(user_id) where status = 'pending_review';
create index if not exists account_deletion_org_requested_idx
  on public.account_deletion_requests(organization_id, requested_at desc);
create index if not exists subscriptions_provider_external_idx
  on public.subscriptions(provider, provider_subscription_id) where provider_subscription_id is not null;
create index if not exists subscriptions_entitlement_window_idx
  on public.subscriptions(organization_id, status, current_period_ends_at, trial_ends_at) where is_current;

alter table public.trial_claims enable row level security;
alter table public.account_consents enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.trial_claims force row level security;
alter table public.account_consents force row level security;
alter table public.account_deletion_requests force row level security;
revoke all on table public.trial_claims, public.account_consents, public.account_deletion_requests from public, anon, authenticated;

create or replace function public.subscription_is_entitled(subscription public.subscriptions, at_time timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select case subscription.status
    when 'trialing' then subscription.trial_ends_at is not null and subscription.trial_ends_at > at_time
    when 'active' then subscription.current_period_ends_at is null or subscription.current_period_ends_at > at_time
    when 'past_due' then subscription.current_period_ends_at is not null and subscription.current_period_ends_at > at_time
    when 'grace_period' then subscription.current_period_ends_at is not null and subscription.current_period_ends_at > at_time
    when 'canceled' then subscription.current_period_ends_at is not null and subscription.current_period_ends_at > at_time
    else false
  end
$$;

create or replace function public.organization_has_commercial_access(target_organization uuid, at_time timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.organization_id = target_organization and s.is_current
      and public.subscription_is_entitled(s, at_time)
  )
$$;

create or replace function public.membership_role_for_account(target_organization uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select m.role from public.organization_members m
    where auth.uid() is not null and m.organization_id = target_organization
      and m.user_id = auth.uid() and m.status = 'active' limit 1),'__none__'::text)
$$;

-- A role operacional falha fechada quando o entitlement termina. RPCs de conta
-- e assinatura usam membership_role_for_account para permanecerem acessiveis.
create or replace function public.current_membership_role(target_organization uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when public.organization_has_commercial_access(target_organization, now())
    then public.membership_role_for_account(target_organization) else '__none__'::text end
$$;

create or replace function public.can_operate_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_has_commercial_access(target_organization, now())
    and public.membership_role_for_account(target_organization) in ('owner','manager')
$$;

create or replace function public.can_access_lead(target_lead uuid, target_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_has_commercial_access(target_organization, now()) and exists (
    select 1 from public.leads l join public.organization_members m
      on m.organization_id=l.organization_id and m.user_id=auth.uid() and m.status='active'
    where l.id=target_lead and l.organization_id=target_organization
      and (m.role in ('owner','manager') or (m.role='agent' and l.assigned_to=auth.uid()))
  )
$$;

create or replace function public.is_assignable_member(target_organization uuid, target_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_has_commercial_access(target_organization, now())
    and public.membership_role_for_account(target_organization) in ('owner','manager')
    and exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=target_user and m.status='active')
$$;

create or replace function public.ensure_default_subscription()
returns trigger language plpgsql security definer set search_path='' as $$
declare start_plan uuid; trial_end timestamptz := now() + interval '7 days';
begin
  select id into start_plan from public.plans where code='start' and active;
  if start_plan is null then raise exception 'Plano START ativo obrigatorio'; end if;
  insert into public.subscriptions(organization_id,plan_id,provider,status,is_current,current_period_starts_at,trial_starts_at,trial_ends_at,metadata)
  values(new.id,start_plan,'internal','trialing',true,now(),now(),trial_end,jsonb_build_object('source','public_trial'))
  on conflict do nothing;
  return new;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  new_org_id uuid; is_public boolean := coalesce((new.raw_user_meta_data->>'public_signup')::boolean,false);
  accepted boolean := coalesce((new.raw_user_meta_data->>'legal_accepted')::boolean,false);
  terms_version text := nullif(trim(new.raw_user_meta_data->>'terms_version'),'');
  privacy_version text := nullif(trim(new.raw_user_meta_data->>'privacy_version'),'');
  full_name text := nullif(trim(new.raw_user_meta_data->>'full_name'),'');
  phone_value text := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9+]','','g'),'');
  company_name text := nullif(trim(new.raw_user_meta_data->>'company_name'),'');
  trial_start timestamptz;
begin
  if is_public and (not accepted or terms_version is null or privacy_version is null or full_name is null or phone_value is null) then
    raise exception using errcode='22023', message='Cadastro publico incompleto';
  end if;
  insert into public.organizations(name) values(coalesce(company_name,nullif(trim(new.email),''),'VC Imob')) returning id into new_org_id;
  insert into public.profiles(id,organization_id,full_name,role,phone,creci,signup_completed_at)
  values(new.id,new_org_id,coalesce(full_name,''),'owner',phone_value,nullif(trim(new.raw_user_meta_data->>'creci'),''),case when is_public then now() end);
  insert into public.organization_members(organization_id,user_id,role,status) values(new_org_id,new.id,'owner','active');
  if is_public then
    select s.trial_starts_at into trial_start from public.subscriptions s where s.organization_id=new_org_id and s.is_current;
    insert into public.trial_claims(user_id,organization_id,started_at,ends_at)
      values(new.id,new_org_id,trial_start,trial_start+interval '7 days');
    insert into public.account_consents(user_id,organization_id,terms_version,privacy_version)
      values(new.id,new_org_id,terms_version,privacy_version);
  end if;
  return new;
end $$;

drop function if exists public.get_my_subscription(uuid);
create function public.get_my_subscription(target_organization uuid)
returns table(plan_code text,plan_name text,status text,billing_interval text,monthly_price_cents integer,annual_price_cents integer,currency text,current_period_starts_at timestamptz,current_period_ends_at timestamptz,trial_starts_at timestamptz,trial_ends_at timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,is_entitled boolean,pending_plan_code text,plan_change_effective_at timestamptz,provider text)
language plpgsql stable security definer set search_path='' as $$ begin
  if public.membership_role_for_account(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao plano negado'; end if;
  return query select p.code,p.name,s.status,s.billing_interval,p.monthly_price_cents,p.annual_price_cents,p.currency,s.current_period_starts_at,s.current_period_ends_at,s.trial_starts_at,s.trial_ends_at,s.cancel_at_period_end,s.canceled_at,public.subscription_is_entitled(s,now()),q.code,s.plan_change_effective_at,s.provider
  from public.subscriptions s join public.plans p on p.id=s.plan_id left join public.plans q on q.id=s.pending_plan_id where s.organization_id=target_organization and s.is_current;
end $$;

drop function if exists public.list_available_plans(uuid);
create function public.list_available_plans(target_organization uuid)
returns table(plan_code text,plan_name text,monthly_price_cents integer,annual_price_cents integer,currency text,trial_days integer,team_member_limit integer)
language plpgsql stable security definer set search_path='' as $$ begin
  if public.membership_role_for_account(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao catalogo de planos negado'; end if;
  return query select p.code,p.name,p.monthly_price_cents,p.annual_price_cents,p.currency,p.trial_days,(select e.limit_value from public.plan_entitlements e where e.plan_id=p.id and e.entitlement_key='team.members' and e.enabled)
  from public.plans p where p.active order by p.monthly_price_cents,p.code;
end $$;

create or replace function public.get_my_entitlements(target_organization uuid)
returns table(entitlement_key text,enabled boolean,limit_value integer,used_value integer)
language plpgsql stable security definer set search_path='' as $$ begin
  if public.membership_role_for_account(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao plano negado'; end if;
  return query select e.entitlement_key,e.enabled and public.subscription_is_entitled(s,now()),e.limit_value,
    case when e.entitlement_key='team.members' then (select count(*)::integer from public.organization_members m where m.organization_id=target_organization and m.status in ('active','disabled')) end
  from public.subscriptions s join public.plan_entitlements e on e.plan_id=s.plan_id where s.organization_id=target_organization and s.is_current order by e.entitlement_key;
end $$;

create or replace function public.get_my_access_state(target_organization uuid)
returns table(status text,is_entitled boolean,trial_ends_at timestamptz,current_period_ends_at timestamptz,can_manage_billing boolean)
language plpgsql stable security definer set search_path='' as $$ begin
  if public.membership_role_for_account(target_organization) = '__none__' then raise exception using errcode='42501',message='Acesso a organizacao negado'; end if;
  return query select s.status,public.subscription_is_entitled(s,now()),s.trial_ends_at,s.current_period_ends_at,public.membership_role_for_account(target_organization) in ('owner','manager')
  from public.subscriptions s where s.organization_id=target_organization and s.is_current;
end $$;

create or replace function public.public_signup_available()
returns boolean language sql stable security definer set search_path='' as $$ select true $$;

create or replace function public.request_account_deletion(target_organization uuid)
returns table(request_id uuid,request_status text,request_scope text,access_revoked boolean)
language plpgsql volatile security definer set search_path='' as $$
declare role_value text; owner_count integer; request_uuid uuid; scope_value text; revoked boolean := false;
begin
  role_value := public.membership_role_for_account(target_organization);
  if role_value = '__none__' then raise exception using errcode='42501',message='Acesso a organizacao negado'; end if;
  if exists(select 1 from public.account_deletion_requests r where r.user_id=auth.uid() and r.status='pending_review') then
    return query select r.id,r.status,r.scope,false from public.account_deletion_requests r where r.user_id=auth.uid() and r.status='pending_review' limit 1; return;
  end if;
  select count(*) into owner_count from public.organization_members m where m.organization_id=target_organization and m.role='owner' and m.status='active';
  scope_value := case when role_value='owner' and owner_count=1 then 'organization' else 'account' end;
  insert into public.account_deletion_requests(user_id,organization_id,membership_role,scope,metadata)
  values(auth.uid(),target_organization,role_value,scope_value,jsonb_build_object('active_owner_count',owner_count)) returning id into request_uuid;
  if role_value in ('agent','manager') or (role_value='owner' and owner_count>1) then
    update public.organization_members set status='disabled',updated_at=now() where organization_id=target_organization and user_id=auth.uid(); revoked := true;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
  values(target_organization,auth.uid(),'account_deletion_request',request_uuid,'account_deletion_requested',jsonb_build_object('scope',scope_value,'role',role_value,'access_revoked',revoked));
  return query select request_uuid,'pending_review'::text,scope_value,revoked;
end $$;

create or replace function public.billing_transition_allowed(old_status text,new_status text)
returns boolean language sql immutable security definer set search_path='' as $$
 select old_status is null or old_status=new_status
   or (old_status='trialing' and new_status in ('active','past_due','grace_period','canceled','expired','refunded','revoked'))
   or (old_status='active' and new_status in ('past_due','grace_period','canceled','expired','refunded','revoked'))
   or (old_status='past_due' and new_status in ('active','grace_period','canceled','expired','refunded','revoked'))
   or (old_status='grace_period' and new_status in ('active','past_due','canceled','expired','refunded','revoked'))
   or (old_status='canceled' and new_status in ('active','expired','refunded','revoked'))
   or (old_status in ('expired','refunded','revoked') and new_status in ('active','trialing'))
$$;

create or replace function public.apply_verified_billing_event(target_provider text,target_event_id text,target_event_type text,target_organization uuid,target_plan_code text,target_billing_interval text,target_status text,event_occurred_at timestamptz,period_starts_at timestamptz default null,period_ends_at timestamptz default null,cancel_at_end boolean default false,target_provider_customer_id text default null,target_provider_subscription_id text default null,event_metadata jsonb default '{}'::jsonb)
returns table(applied boolean,subscription_id uuid,result text)
language plpgsql volatile security definer set search_path='' as $$
declare event_uuid uuid; current_row public.subscriptions%rowtype; selected_plan uuid; subscription_uuid uuid;
begin
  if target_provider not in ('apple','google','web') or target_status not in ('active','past_due','grace_period','canceled','expired','refunded','revoked') or target_billing_interval not in ('month','year') or nullif(trim(target_event_id),'') is null or event_occurred_at is null then raise exception using errcode='22023',message='Evento verificado invalido'; end if;
  if target_status in ('active','past_due','grace_period','canceled') and (period_ends_at is null or period_ends_at<=event_occurred_at) then raise exception using errcode='22023',message='Periodo verificado invalido'; end if;
  select id into selected_plan from public.plans where code=target_plan_code and active; if selected_plan is null then raise exception using errcode='22023',message='Plano invalido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization::text,91));
  insert into public.billing_events(provider,external_event_id,event_type,organization_id,payload,occurred_at)
    values(target_provider,trim(target_event_id),trim(target_event_type),target_organization,coalesce(event_metadata,'{}'),event_occurred_at)
    on conflict(provider,external_event_id) do nothing returning id into event_uuid;
  select * into current_row from public.subscriptions s where s.organization_id=target_organization and s.is_current for update;
  if event_uuid is null then return query select false,current_row.id,'duplicate'::text; return; end if;
  if current_row.id is null then raise exception using errcode='22023',message='Organizacao sem assinatura corrente'; end if;
  if current_row.last_event_at is not null and event_occurred_at<current_row.last_event_at then update public.billing_events set subscription_id=current_row.id,processed_at=now(),result='ignored_out_of_order' where id=event_uuid; return query select false,current_row.id,'ignored_out_of_order'::text; return; end if;
  if not public.billing_transition_allowed(current_row.status,target_status) then raise exception using errcode='22023',message='Transicao comercial invalida'; end if;
  update public.subscriptions set plan_id=selected_plan,provider=target_provider,billing_interval=target_billing_interval,provider_customer_id=target_provider_customer_id,provider_subscription_id=target_provider_subscription_id,status=target_status,current_period_starts_at=period_starts_at,current_period_ends_at=period_ends_at,cancel_at_period_end=cancel_at_end,canceled_at=case when target_status='canceled' then event_occurred_at else canceled_at end,ended_at=case when target_status in ('expired','refunded','revoked') then event_occurred_at end,revoked_at=case when target_status in ('refunded','revoked') then event_occurred_at end,last_event_at=event_occurred_at,metadata=coalesce(event_metadata,'{}'),updated_at=now() where id=current_row.id returning id into subscription_uuid;
  update public.billing_events set subscription_id=subscription_uuid,processed_at=now(),result='applied' where id=event_uuid;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,null,'subscription',subscription_uuid,'verified_billing_event_applied',jsonb_build_object('provider',target_provider,'event_type',target_event_type,'status',target_status,'plan',target_plan_code,'interval',target_billing_interval,'external_event_id',trim(target_event_id)));
  return query select true,subscription_uuid,'applied'::text;
end $$;

revoke all on function public.organization_has_commercial_access(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.membership_role_for_account(uuid) from public,anon,authenticated;
revoke all on function public.get_my_access_state(uuid) from public,anon;
revoke all on function public.request_account_deletion(uuid) from public,anon;
grant execute on function public.get_my_access_state(uuid), public.request_account_deletion(uuid) to authenticated;
revoke all on function public.public_signup_available() from public;
grant execute on function public.public_signup_available() to anon, authenticated;
revoke all on function public.apply_verified_billing_event(text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,boolean,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_verified_billing_event(text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,boolean,text,text,jsonb) to service_role;

-- Reaplica grants das assinaturas alteradas (CREATE OR REPLACE preserva normalmente,
-- mas a declaracao explicita mantem o principio de privilegio minimo auditavel).
revoke all on function public.get_my_subscription(uuid), public.list_available_plans(uuid) from public,anon;
grant execute on function public.get_my_subscription(uuid), public.list_available_plans(uuid) to authenticated;
revoke all on function public.get_my_entitlements(uuid) from public,anon;
grant execute on function public.get_my_entitlements(uuid) to authenticated;

commit;
revoke all on function public.handle_new_user(), public.ensure_default_subscription(), public.subscription_is_entitled(public.subscriptions,timestamptz), public.billing_transition_allowed(text,text) from public,anon,authenticated;

comment on table public.trial_claims is 'Registro imutavel de elegibilidade de trial por usuario e organizacao; nao exposto ao cliente.';
comment on table public.account_consents is 'Aceites versionados de Termos e Privacidade; sem consentimento de marketing implicito.';
comment on table public.account_deletion_requests is 'Workflow seguro de encerramento; owners unicos exigem revisao para evitar organizacao orfa e perda de dados.';

commit;

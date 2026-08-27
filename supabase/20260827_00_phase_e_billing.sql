-- Fase E: dominio comercial provider-agnostic. Nao cobra, nao chama gateways e nao apaga dados.
begin;

alter table public.plans add column if not exists trial_days integer not null default 14 check (trial_days between 0 and 90);
update public.plans set trial_days=case code when 'start' then 7 else 14 end;

alter table public.subscriptions drop constraint if exists subscriptions_provider_check;
alter table public.subscriptions add constraint subscriptions_provider_check check(provider in ('apple','google','web','internal'));
alter table public.subscriptions
 add column if not exists provider_customer_id text,
 add column if not exists trial_ends_at timestamptz,
 add column if not exists canceled_at timestamptz,
 add column if not exists is_current boolean not null default false,
 add column if not exists last_event_at timestamptz,
 add column if not exists pending_plan_id uuid references public.plans(id),
 add column if not exists plan_change_effective_at timestamptz;
alter table public.subscriptions drop constraint if exists subscriptions_period_check;
alter table public.subscriptions add constraint subscriptions_period_check check(current_period_ends_at is null or current_period_starts_at is null or current_period_ends_at>current_period_starts_at);
alter table public.subscriptions drop constraint if exists subscriptions_pending_plan_check;
alter table public.subscriptions add constraint subscriptions_pending_plan_check check((pending_plan_id is null and plan_change_effective_at is null) or (pending_plan_id is not null and plan_change_effective_at is not null));

alter table public.billing_events drop constraint if exists billing_events_provider_check;
alter table public.billing_events add constraint billing_events_provider_check check(provider in ('apple','google','web','internal'));
alter table public.billing_events add column if not exists event_type text, add column if not exists occurred_at timestamptz,
 add column if not exists result text check(result is null or result in ('applied','duplicate','ignored_out_of_order'));

update public.subscriptions s set is_current=true where s.id=(select x.id from public.subscriptions x where x.organization_id=s.organization_id order by x.created_at desc,x.id desc limit 1);
create unique index if not exists subscriptions_one_current_row_per_org_idx on public.subscriptions(organization_id) where is_current;
create index if not exists billing_events_org_occurred_idx on public.billing_events(organization_id,occurred_at desc);

alter table public.plans force row level security; alter table public.plan_entitlements force row level security;
alter table public.subscriptions force row level security; alter table public.billing_products force row level security;
alter table public.billing_events force row level security;
revoke all on table public.plans,public.plan_entitlements,public.subscriptions,public.billing_products,public.billing_events from public,anon,authenticated;

create or replace function public.subscription_is_entitled(subscription public.subscriptions,at_time timestamptz default now()) returns boolean
language sql stable security definer set search_path='' as $$ select case subscription.status when 'active' then subscription.current_period_ends_at is null or subscription.current_period_ends_at>at_time when 'trialing' then subscription.trial_ends_at>at_time when 'grace_period' then subscription.current_period_ends_at is null or subscription.current_period_ends_at>at_time else false end $$;

create or replace function public.entitlement_limit(target_organization uuid,target_key text) returns integer
language sql stable security definer set search_path='' as $$ select case when public.subscription_is_entitled(s,now()) and e.enabled then e.limit_value end from public.subscriptions s join public.plan_entitlements e on e.plan_id=s.plan_id and e.entitlement_key=target_key where s.organization_id=target_organization and s.is_current limit 1 $$;

create or replace function public.can_use_entitlement(target_organization uuid,target_key text) returns boolean
language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null or not public.is_active_organization_member(target_organization,auth.uid()) then raise exception using errcode='42501',message='Acesso comercial negado'; end if;
 return exists(select 1 from public.subscriptions s join public.plan_entitlements e on e.plan_id=s.plan_id where s.organization_id=target_organization and s.is_current and e.entitlement_key=target_key and e.enabled and public.subscription_is_entitled(s,now()));
end $$;

create or replace function public.get_my_subscription(target_organization uuid)
returns table(plan_code text,plan_name text,status text,current_period_starts_at timestamptz,current_period_ends_at timestamptz,trial_ends_at timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,is_entitled boolean,pending_plan_code text,plan_change_effective_at timestamptz)
language plpgsql stable security definer set search_path='' as $$ begin
 if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao plano negado'; end if;
 return query select p.code,p.name,s.status,s.current_period_starts_at,s.current_period_ends_at,s.trial_ends_at,s.cancel_at_period_end,s.canceled_at,public.subscription_is_entitled(s,now()),q.code,s.plan_change_effective_at from public.subscriptions s join public.plans p on p.id=s.plan_id left join public.plans q on q.id=s.pending_plan_id where s.organization_id=target_organization and s.is_current;
end $$;

create or replace function public.get_my_entitlements(target_organization uuid) returns table(entitlement_key text,enabled boolean,limit_value integer,used_value integer)
language plpgsql stable security definer set search_path='' as $$ begin
 if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao plano negado'; end if;
 return query select e.entitlement_key,e.enabled and public.subscription_is_entitled(s,now()),e.limit_value,case when e.entitlement_key='team.members' then (select count(*)::integer from public.organization_members m where m.organization_id=target_organization and m.status in ('active','disabled')) end from public.subscriptions s join public.plan_entitlements e on e.plan_id=s.plan_id where s.organization_id=target_organization and s.is_current order by e.entitlement_key;
end $$;

create or replace function public.list_available_plans(target_organization uuid) returns table(plan_code text,plan_name text,monthly_price_cents integer,currency text,trial_days integer,team_member_limit integer)
language plpgsql stable security definer set search_path='' as $$ begin
 if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Acesso ao catalogo de planos negado'; end if;
 return query select p.code,p.name,p.monthly_price_cents,p.currency,p.trial_days,(select e.limit_value from public.plan_entitlements e where e.plan_id=p.id and e.entitlement_key='team.members' and e.enabled) from public.plans p where p.active order by p.monthly_price_cents,p.code;
end $$;

create or replace function public.billing_transition_allowed(old_status text,new_status text) returns boolean language sql immutable security definer set search_path='' as $$
 select old_status is null or old_status=new_status or (old_status='trialing' and new_status in ('active','past_due','canceled','expired')) or (old_status='active' and new_status in ('past_due','grace_period','canceled','expired')) or (old_status='past_due' and new_status in ('active','grace_period','canceled','expired')) or (old_status='grace_period' and new_status in ('active','past_due','canceled','expired')) or (old_status in ('canceled','expired') and new_status in ('active','trialing')) $$;

create or replace function public.apply_billing_event(target_provider text,target_event_id text,target_event_type text,target_organization uuid,target_plan_code text,target_status text,event_occurred_at timestamptz,period_starts_at timestamptz default null,period_ends_at timestamptz default null,trial_end timestamptz default null,cancel_at_end boolean default false,target_provider_customer_id text default null,target_provider_subscription_id text default null,event_metadata jsonb default '{}'::jsonb)
returns table(applied boolean,subscription_id uuid,result text) language plpgsql volatile security definer set search_path='' as $$
declare event_uuid uuid; current_row public.subscriptions%rowtype; selected_plan public.plans%rowtype; subscription_uuid uuid; old_plan text; computed_trial timestamptz;
begin
 if target_provider not in ('apple','google','web','internal') or nullif(trim(target_event_id),'') is null or nullif(trim(target_event_type),'') is null or event_occurred_at is null or target_organization is null then raise exception using errcode='22023',message='Evento comercial invalido'; end if;
 if target_status not in ('trialing','active','past_due','grace_period','canceled','expired') then raise exception using errcode='22023',message='Status comercial invalido'; end if;
 select * into selected_plan from public.plans where code=target_plan_code and active; if not found then raise exception using errcode='22023',message='Plano comercial invalido'; end if;
 if period_starts_at is not null and period_ends_at is not null and period_ends_at<=period_starts_at then raise exception using errcode='22023',message='Periodo comercial invalido'; end if;
 computed_trial:=case when target_status='trialing' then coalesce(trial_end,event_occurred_at+make_interval(days=>selected_plan.trial_days)) end;
 if target_status='trialing' and (selected_plan.trial_days=0 and trial_end is null or computed_trial<=event_occurred_at) then raise exception using errcode='22023',message='Trial comercial invalido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_organization::text,27));
 insert into public.billing_events(provider,external_event_id,event_type,organization_id,payload,occurred_at) values(target_provider,trim(target_event_id),trim(target_event_type),target_organization,coalesce(event_metadata,'{}'),event_occurred_at) on conflict(provider,external_event_id) do nothing returning id into event_uuid;
 if event_uuid is null then select s.id into subscription_uuid from public.subscriptions s where s.organization_id=target_organization and s.is_current; return query select false,subscription_uuid,'duplicate'::text; return; end if;
 select * into current_row from public.subscriptions s where s.organization_id=target_organization and s.is_current for update;
 if found and current_row.last_event_at is not null and event_occurred_at<current_row.last_event_at then update public.billing_events set subscription_id=current_row.id,processed_at=now(),result='ignored_out_of_order' where id=event_uuid; return query select false,current_row.id,'ignored_out_of_order'::text; return; end if;
 if found and not public.billing_transition_allowed(current_row.status,target_status)
   and not (current_row.provider='internal' and current_row.last_event_at is null and target_status='trialing')
 then raise exception using errcode='22023',message='Transicao comercial invalida'; end if;
 if found then
  select code into old_plan from public.plans where id=current_row.plan_id;
  update public.subscriptions set plan_id=selected_plan.id,provider=target_provider,provider_customer_id=target_provider_customer_id,provider_subscription_id=target_provider_subscription_id,status=target_status,current_period_starts_at=period_starts_at,current_period_ends_at=period_ends_at,trial_ends_at=computed_trial,cancel_at_period_end=cancel_at_end,canceled_at=case when target_status='canceled' then event_occurred_at end,last_event_at=event_occurred_at,pending_plan_id=null,plan_change_effective_at=null,metadata=coalesce(event_metadata,'{}'),updated_at=now() where id=current_row.id returning id into subscription_uuid;
 else
  insert into public.subscriptions(organization_id,plan_id,provider,provider_customer_id,provider_subscription_id,status,current_period_starts_at,current_period_ends_at,trial_ends_at,cancel_at_period_end,canceled_at,is_current,last_event_at,metadata) values(target_organization,selected_plan.id,target_provider,target_provider_customer_id,target_provider_subscription_id,target_status,period_starts_at,period_ends_at,computed_trial,cancel_at_end,case when target_status='canceled' then event_occurred_at end,true,event_occurred_at,coalesce(event_metadata,'{}')) returning id into subscription_uuid;
 end if;
 update public.billing_events set subscription_id=subscription_uuid,processed_at=now(),result='applied' where id=event_uuid;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,null,'subscription',subscription_uuid,'billing_subscription_changed',jsonb_build_object('previous_plan',old_plan,'new_plan',target_plan_code,'previous_status',current_row.status,'new_status',target_status,'source',target_provider,'event_type',target_event_type,'external_event_id',trim(target_event_id)));
 return query select true,subscription_uuid,'applied'::text;
end $$;

create or replace function public.team_member_limit(target_organization uuid) returns integer language sql stable security definer set search_path='' as $$ select coalesce(o.team_member_limit_override,public.entitlement_limit(target_organization,'team.members'),1)::integer from public.organizations o where o.id=target_organization $$;

create or replace function public.ensure_default_subscription() returns trigger language plpgsql security definer set search_path='' as $$ declare start_plan uuid; begin select id into start_plan from public.plans where code='start' and active; if start_plan is null then raise exception 'Plano START ativo obrigatorio'; end if; insert into public.subscriptions(organization_id,plan_id,provider,status,is_current,current_period_starts_at,metadata) values(new.id,start_plan,'internal','active',true,now(),jsonb_build_object('source','legacy_default')) on conflict do nothing; return new; end $$;
drop trigger if exists organizations_default_subscription on public.organizations;
create trigger organizations_default_subscription after insert on public.organizations for each row execute function public.ensure_default_subscription();
insert into public.subscriptions(organization_id,plan_id,provider,status,is_current,current_period_starts_at,metadata) select o.id,p.id,'internal','active',true,now(),jsonb_build_object('source','phase_e_migration') from public.organizations o cross join public.plans p where p.code='start' and not exists(select 1 from public.subscriptions s where s.organization_id=o.id and s.is_current);

do $$ declare signature text; begin foreach signature in array array['get_my_subscription(uuid)','get_my_entitlements(uuid)','list_available_plans(uuid)','can_use_entitlement(uuid,text)'] loop execute format('revoke all on function public.%s from public,anon',signature); execute format('grant execute on function public.%s to authenticated',signature); end loop; end $$;
revoke all on function public.subscription_is_entitled(public.subscriptions,timestamptz) from public,anon,authenticated;
revoke all on function public.entitlement_limit(uuid,text) from public,anon,authenticated;
revoke all on function public.billing_transition_allowed(text,text) from public,anon,authenticated;
revoke all on function public.ensure_default_subscription() from public,anon,authenticated;
revoke all on function public.apply_billing_event(text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_billing_event(text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean,text,text,jsonb) to service_role;
comment on function public.apply_billing_event(text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean,text,text,jsonb) is 'Entrada interna provider-agnostic e idempotente; nao realiza cobranca.';
commit;

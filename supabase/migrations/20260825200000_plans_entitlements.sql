-- Fase A: catálogo SaaS e capabilities. Não atribui assinatura a organizações existentes.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('start', 'pro', 'equipe')),
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  currency text not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  entitlement_key text not null,
  enabled boolean not null default false,
  limit_value integer check (limit_value is null or limit_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, entitlement_key)
);

alter table public.plans enable row level security;
alter table public.plan_entitlements enable row level security;
grant select on public.plans, public.plan_entitlements to authenticated;

insert into public.plans (code, name, monthly_price_cents, currency, active)
values ('start','START',3990,'BRL',true), ('pro','PRO',7990,'BRL',true), ('equipe','EQUIPE',14990,'BRL',true)
on conflict (code) do update set name=excluded.name, monthly_price_cents=excluded.monthly_price_cents, currency=excluded.currency, active=excluded.active;

insert into public.plan_entitlements (plan_id, entitlement_key, enabled, limit_value)
select p.id, e.key, e.enabled, e.lim
from public.plans p join (values
('start','crm.basic',true,null::integer),('start','crm.leads',true,null),('start','crm.pipeline',true,null),('start','crm.agenda',true,null),('start','crm.history',true,null),('start','crm.properties',true,null),('start','crm.whatsapp',true,null),('start','crm.site_capture',true,null),('start','crm.deduplication',true,null),('start','platform.web',true,null),('start','platform.mobile',true,null),('start','team.members',true,1),
('pro','crm.basic',true,null),('pro','crm.leads',true,null),('pro','crm.pipeline',true,null),('pro','crm.agenda',true,null),('pro','crm.history',true,null),('pro','crm.properties',true,null),('pro','crm.whatsapp',true,null),('pro','crm.site_capture',true,null),('pro','crm.deduplication',true,null),('pro','platform.web',true,null),('pro','platform.mobile',true,null),('pro','team.members',true,1),('pro','crm.custom_pipeline',true,null),('pro','crm.push',true,null),('pro','crm.matching',true,null),('pro','crm.automation',true,null),('pro','crm.advanced_reports',true,null),('pro','crm.multiple_interests',true,null),('pro','crm.goals',true,null),('pro','crm.documents',true,null),('pro','crm.exports',true,null),('pro','crm.integrations',true,null),('pro','crm.ai',true,null),('pro','crm.ai.monthly_requests',true,100),
('equipe','crm.basic',true,null),('equipe','crm.leads',true,null),('equipe','crm.pipeline',true,null),('equipe','crm.agenda',true,null),('equipe','crm.history',true,null),('equipe','crm.properties',true,null),('equipe','crm.whatsapp',true,null),('equipe','crm.site_capture',true,null),('equipe','crm.deduplication',true,null),('equipe','platform.web',true,null),('equipe','platform.mobile',true,null),('equipe','team.members',true,30),('equipe','crm.custom_pipeline',true,null),('equipe','crm.push',true,null),('equipe','crm.matching',true,null),('equipe','crm.automation',true,null),('equipe','crm.advanced_reports',true,null),('equipe','crm.multiple_interests',true,null),('equipe','crm.goals',true,null),('equipe','crm.documents',true,null),('equipe','crm.exports',true,null),('equipe','crm.integrations',true,null),('equipe','crm.ai',true,null),('equipe','crm.ai.monthly_requests',true,1000),('equipe','team.assignment',true,null),('equipe','team.round_robin',true,null),('equipe','team.manager_dashboard',true,null),('equipe','team.audit',true,null),('equipe','team.permissions',true,null),('equipe','team.team_reports',true,null),('equipe','team.goals',true,null)
) e(code,key,enabled,lim) on e.code=p.code
on conflict (plan_id, entitlement_key) do update set enabled=excluded.enabled, limit_value=excluded.limit_value;

comment on table public.plan_entitlements is 'As cotas crm.ai.monthly_requests de PRO (100) e EQUIPE (1000) são provisórias até a implementação de IA.';

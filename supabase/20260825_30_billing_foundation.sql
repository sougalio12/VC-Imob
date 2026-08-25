-- Fase A: apenas fundação de billing; nenhum pagamento, webhook ou assinatura é criado.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null check (provider in ('apple','google','web')),
  provider_subscription_id text,
  status text not null check (status in ('trialing','active','past_due','grace_period','canceled','expired')),
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create table if not exists public.billing_products (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  provider text not null check (provider in ('apple','google','web')),
  provider_product_id text not null,
  provider_price_id text,
  currency text not null,
  billing_interval text not null check (billing_interval in ('month','year')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_product_id, currency, billing_interval)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apple','google','web')),
  external_event_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

alter table public.subscriptions enable row level security;
alter table public.billing_products enable row level security;
alter table public.billing_events enable row level security;
create unique index if not exists subscriptions_one_current_per_organization_idx
  on public.subscriptions (organization_id)
  where status in ('trialing','active','past_due','grace_period');
create index if not exists subscriptions_organization_status_idx on public.subscriptions (organization_id, status);

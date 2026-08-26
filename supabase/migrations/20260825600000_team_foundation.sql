-- Fase A: estruturas de equipe e auditoria sem fluxos de convite ou mudanças de role.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager','agent')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;
create index if not exists invitations_organization_status_idx on public.invitations (organization_id, expires_at) where accepted_at is null and revoked_at is null;
create index if not exists audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc);

-- Não concede INSERT/UPDATE/DELETE a authenticated em audit_events: append-only por RPC/backend futuro.

-- Fase A: mapeamento futuro de sites; não altera site-lead atual.

create table if not exists public.organization_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hostname text not null check (hostname = lower(trim(hostname))),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.organization_sites enable row level security;

create or replace function public.normalize_organization_site_hostname()
returns trigger language plpgsql set search_path = public as $$
begin
  new.hostname := lower(trim(new.hostname));
  return new;
end;
$$;

drop trigger if exists organization_sites_normalize_hostname on public.organization_sites;
create trigger organization_sites_normalize_hostname
before insert or update of hostname on public.organization_sites
for each row execute function public.normalize_organization_site_hostname();

create unique index if not exists organization_sites_active_hostname_idx
  on public.organization_sites (hostname) where status = 'active';
create index if not exists organization_sites_organization_idx on public.organization_sites (organization_id);

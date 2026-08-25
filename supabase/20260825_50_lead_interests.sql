-- Fase A: interesses estruturados, preservando property_code/property_title legados em leads.

create table if not exists public.lead_interests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_code text,
  property_title text,
  source text not null default 'legacy',
  created_at timestamptz not null default now(),
  unique (lead_id, property_code)
);

alter table public.lead_interests enable row level security;
create index if not exists lead_interests_organization_lead_created_idx
  on public.lead_interests (organization_id, lead_id, created_at desc);

insert into public.lead_interests (organization_id, lead_id, property_code, property_title, source)
select organization_id, id, property_code, property_title, 'legacy'
from public.leads
where nullif(trim(coalesce(property_code, '')), '') is not null
on conflict (lead_id, property_code) do nothing;

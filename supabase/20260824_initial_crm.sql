-- VC Imob: schema inicial. Execute no SQL Editor do Supabase.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'broker' check (role in ('owner', 'broker', 'assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) > 0),
  phone text,
  whatsapp text,
  email text,
  origin text not null default 'manual',
  responsible_name text,
  property_code text,
  property_title text,
  budget text,
  desired_region text,
  notes text,
  stage text not null default 'novo' check (stage in ('novo','atendimento','visita','negociacao','fechado','perdido')),
  entered_at timestamptz not null default now(),
  next_follow_up timestamptz,
  visit_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or whatsapp is not null)
);

create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('retorno', 'visita')),
  scheduled_at timestamptz not null,
  status text not null default 'agendado' check (status in ('agendado', 'concluido', 'cancelado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_org_stage_idx on public.leads (organization_id, stage);
create index if not exists leads_org_follow_up_idx on public.leads (organization_id, next_follow_up);
create index if not exists appointments_org_scheduled_idx on public.appointments (organization_id, scheduled_at);
create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments for each row execute function public.set_updated_at();

-- Cada novo usuário recebe sua própria organização inicialmente.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_org_id uuid;
begin
  insert into public.organizations (name) values (coalesce(new.raw_user_meta_data->>'company_name', new.email, 'VC Imob')) returning id into new_org_id;
  insert into public.profiles (id, organization_id, full_name, role)
  values (new.id, new_org_id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'owner');
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
alter table public.appointments enable row level security;

create or replace function public.same_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and organization_id = target_organization);
$$;

create policy "organization members can read organization" on public.organizations for select using (public.same_organization(id));
create policy "users can read organization profiles" on public.profiles for select using (public.same_organization(organization_id));
create policy "users can update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and public.same_organization(organization_id));

create policy "organization members manage leads" on public.leads for all using (public.same_organization(organization_id)) with check (public.same_organization(organization_id));
create policy "organization members manage notes" on public.lead_notes for all using (public.same_organization(organization_id)) with check (public.same_organization(organization_id));
create policy "organization members manage appointments" on public.appointments for all using (public.same_organization(organization_id)) with check (public.same_organization(organization_id));

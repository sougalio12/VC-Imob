-- Fase A: foundation multi-tenant aditiva. Não altera RLS operacional existente.

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'agent')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.organization_members enable row level security;

create index if not exists organization_members_active_user_org_idx
  on public.organization_members (user_id, organization_id)
  where status = 'active';

create or replace function public.is_active_organization_member(
  target_organization uuid,
  target_user uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select target_user is not null and exists (
    select 1 from public.organization_members
    where organization_id = target_organization
      and user_id = target_user
      and status = 'active'
  );
$$;

create or replace function public.current_membership_role(target_organization uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.organization_members
  where organization_id = target_organization
    and user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

revoke all on function public.is_active_organization_member(uuid, uuid) from public;
revoke all on function public.current_membership_role(uuid) from public;
grant execute on function public.is_active_organization_member(uuid, uuid) to authenticated;
grant execute on function public.current_membership_role(uuid) to authenticated;

insert into public.organization_members (organization_id, user_id, role, status)
select p.organization_id, p.id,
  case when p.role = 'owner' then 'owner' else 'agent' end,
  'active'
from public.profiles p
where p.organization_id is not null
on conflict (organization_id, user_id) do nothing;

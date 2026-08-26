-- FASE C: preparação de dados EXCLUSIVAMENTE em projeto Supabase de staging.
-- Pré-requisito: criar e confirmar no Auth Dashboard as seis contas listadas
-- abaixo, todas com a senha temporária usada pelo runner.

begin;

do $$
declare
  owner_a uuid;
  manager_a uuid;
  agent_a1 uuid;
  agent_a2 uuid;
  disabled_a uuid;
  owner_b uuid;
  org_a uuid;
  org_b uuid;
  disposable_orgs uuid[];
begin
  if exists (
    select 1 from public.organizations
    where id = 'd3c8309e-a714-4de3-b0cf-1d035b3c25f6'::uuid
  ) or exists (
    select 1 from auth.users
    where id = '6bc58cfd-b75b-4f37-9fd8-6d8fd40c5a4a'::uuid
  ) then
    raise exception 'REFUSING TO RUN PHASE C TEST PREPARATION IN PRODUCTION';
  end if;

  select id into strict owner_a from auth.users where lower(email) = 'phase-c-owner-a@example.com';
  select id into strict manager_a from auth.users where lower(email) = 'phase-c-manager-a@example.com';
  select id into strict agent_a1 from auth.users where lower(email) = 'phase-c-agent-a1@example.com';
  select id into strict agent_a2 from auth.users where lower(email) = 'phase-c-agent-a2@example.com';
  select id into strict disabled_a from auth.users where lower(email) = 'phase-c-disabled-a@example.com';
  select id into strict owner_b from auth.users where lower(email) = 'phase-c-owner-b@example.com';

  select organization_id into strict org_a from public.profiles where id = owner_a;
  select organization_id into strict org_b from public.profiles where id = owner_b;

  if org_a = org_b then
    raise exception 'Test owners must start in different organizations';
  end if;

  select array_agg(distinct organization_id)
    into disposable_orgs
  from public.profiles
  where id in (manager_a, agent_a1, agent_a2, disabled_a)
    and organization_id not in (org_a, org_b);

  delete from public.organization_members
  where user_id in (owner_a, manager_a, agent_a1, agent_a2, disabled_a, owner_b);

  update public.profiles
  set
    organization_id = case when id = owner_b then org_b else org_a end,
    role = case
      when id in (owner_a, owner_b) then 'owner'
      when id = manager_a then 'assistant'
      else 'broker'
    end
  where id in (owner_a, manager_a, agent_a1, agent_a2, disabled_a, owner_b);

  insert into public.organization_members (organization_id, user_id, role, status)
  values
    (org_a, owner_a, 'owner', 'active'),
    (org_a, manager_a, 'manager', 'active'),
    (org_a, agent_a1, 'agent', 'active'),
    (org_a, agent_a2, 'agent', 'active'),
    (org_a, disabled_a, 'agent', 'disabled'),
    (org_b, owner_b, 'owner', 'active');

  update public.organizations set name = '[PHASE_C_TEST] Organization A' where id = org_a;
  update public.organizations set name = '[PHASE_C_TEST] Organization B' where id = org_b;

  delete from public.organizations
  where id = any(coalesce(disposable_orgs, array[]::uuid[]));
end;
$$;

create or replace function public.phase_c_test_set_membership_status(
  target_organization uuid,
  target_user uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_status not in ('active', 'disabled')
    or not exists (
      select 1
      from public.organizations as organization
      where organization.id = target_organization
        and organization.name in ('[PHASE_C_TEST] Organization A', '[PHASE_C_TEST] Organization B')
    )
    or not exists (
      select 1
      from auth.users as auth_user
      where auth_user.id = target_user
        and lower(auth_user.email) in (
          'phase-c-owner-a@example.com',
          'phase-c-manager-a@example.com',
          'phase-c-agent-a1@example.com',
          'phase-c-agent-a2@example.com',
          'phase-c-disabled-a@example.com',
          'phase-c-owner-b@example.com'
        )
    ) then
    raise exception 'Invalid Phase C test membership change';
  end if;

  update public.organization_members
  set status = target_status
  where organization_id = target_organization
    and user_id = target_user;

  if not found then
    raise exception 'Phase C test membership not found';
  end if;
end;
$$;

revoke all on function public.phase_c_test_set_membership_status(uuid, uuid, text) from public;
revoke all on function public.phase_c_test_set_membership_status(uuid, uuid, text) from anon;
revoke all on function public.phase_c_test_set_membership_status(uuid, uuid, text) from authenticated;
grant execute on function public.phase_c_test_set_membership_status(uuid, uuid, text) to service_role;

commit;

select
  organization.name as organization_name,
  member.organization_id,
  auth_user.email,
  member.user_id,
  member.role,
  member.status
from public.organization_members as member
join auth.users as auth_user on auth_user.id = member.user_id
join public.organizations as organization on organization.id = member.organization_id
where lower(auth_user.email) in (
  'phase-c-owner-a@example.com',
  'phase-c-manager-a@example.com',
  'phase-c-agent-a1@example.com',
  'phase-c-agent-a2@example.com',
  'phase-c-disabled-a@example.com',
  'phase-c-owner-b@example.com'
)
order by organization.name, member.role, auth_user.email;

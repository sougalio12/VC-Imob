begin;

create or replace function public.phase_d_test_configure(
  owner_user uuid,
  manager_user uuid,
  agent1_user uuid,
  agent2_user uuid,
  disabled_user uuid,
  outsider_user uuid
)
returns table (organization_a uuid, organization_b uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_a uuid;
  org_b uuid;
  supplied_users uuid[] := array[owner_user, manager_user, agent1_user, agent2_user, disabled_user, outsider_user];
begin
  if exists (select 1 from public.organizations where id = 'd3c8309e-a714-4de3-b0cf-1d035b3c25f6'::uuid)
    or exists (select 1 from auth.users where id = '6bc58cfd-b75b-4f37-9fd8-6d8fd40c5a4a'::uuid)
    or (select count(*) from auth.users where id = any(supplied_users) and lower(email) like 'phase-d-%@example.com') <> 6
  then
    raise exception 'REFUSING INVALID OR NON-LOCAL PHASE D TEST SETUP';
  end if;

  select organization_id into strict org_a from public.profiles where id = owner_user;
  select organization_id into strict org_b from public.profiles where id = outsider_user;
  if org_a = org_b then raise exception 'Phase D test organizations must differ'; end if;

  delete from public.organization_members where user_id in (manager_user, agent1_user, agent2_user, disabled_user);
  insert into public.organization_members (organization_id, user_id, role, status)
  values
    (org_a, manager_user, 'manager', 'active'),
    (org_a, agent1_user, 'agent', 'active'),
    (org_a, agent2_user, 'agent', 'active'),
    (org_a, disabled_user, 'agent', 'disabled');

  update public.organizations set team_member_limit_override = 30 where id = org_a;
  return query select org_a, org_b;
end;
$$;

create or replace function public.phase_d_test_set_limit(target_organization uuid, target_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit not between 1 and 30
    or not exists (select 1 from public.organizations where id = target_organization and name = '[PHASE_D_TEST] owner')
  then raise exception 'Invalid Phase D test limit change'; end if;
  update public.organizations set team_member_limit_override = target_limit where id = target_organization;
end;
$$;

create or replace function public.phase_d_test_expire_invitation(target_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invitations as invitation
  set expires_at = now() - interval '1 second'
  from public.organizations as organization
  where invitation.id = target_invitation
    and organization.id = invitation.organization_id
    and organization.name = '[PHASE_D_TEST] owner';
  if not found then raise exception 'Invalid Phase D test invitation'; end if;
end;
$$;

revoke all on function public.phase_d_test_configure(uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.phase_d_test_set_limit(uuid,integer) from public, anon, authenticated;
revoke all on function public.phase_d_test_expire_invitation(uuid) from public, anon, authenticated;
grant execute on function public.phase_d_test_configure(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.phase_d_test_set_limit(uuid,integer) to service_role;
grant execute on function public.phase_d_test_expire_invitation(uuid) to service_role;

commit;

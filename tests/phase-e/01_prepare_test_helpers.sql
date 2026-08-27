begin;
create or replace function public.phase_e_test_profile_organization(target_user uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare target_org uuid;
begin
 if not exists(select 1 from auth.users where id=target_user and email in ('phase-e-owner@example.com','phase-e-agent@example.com')) then raise exception 'REFUSING INVALID PHASE E PROFILE LOOKUP'; end if;
 select organization_id into strict target_org from public.profiles where id=target_user;
 return target_org;
end $$;
revoke all on function public.phase_e_test_profile_organization(uuid) from public,anon,authenticated;
grant execute on function public.phase_e_test_profile_organization(uuid) to service_role;

create or replace function public.phase_e_test_add_agent(owner_user uuid,agent_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target_org uuid;
begin
 select organization_id into strict target_org from public.profiles where id=owner_user;
 if not exists(select 1 from auth.users where id=owner_user and email='phase-e-owner@example.com') or not exists(select 1 from auth.users where id=agent_user and email='phase-e-agent@example.com') then raise exception 'REFUSING INVALID PHASE E FIXTURE'; end if;
 delete from public.organization_members where user_id=agent_user;
 insert into public.organization_members(organization_id,user_id,role,status) values(target_org,agent_user,'agent','active');
 update public.organizations set team_member_limit_override=null where id=target_org;
 return target_org;
end $$;
revoke all on function public.phase_e_test_add_agent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase_e_test_add_agent(uuid,uuid) to service_role;

create or replace function public.phase_e_test_billing_audit_count(target_organization uuid) returns integer
language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.audit_events
 where organization_id=target_organization and action='billing_subscription_changed'
$$;
revoke all on function public.phase_e_test_billing_audit_count(uuid) from public,anon,authenticated;
grant execute on function public.phase_e_test_billing_audit_count(uuid) to service_role;
commit;

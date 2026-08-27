begin;
drop function if exists public.phase_e_test_add_agent(uuid,uuid);
drop function if exists public.phase_e_test_profile_organization(uuid);
drop function if exists public.phase_e_test_billing_audit_count(uuid);
delete from public.organizations where name like '[PHASE\_E\_TEST] %' escape '\';
delete from auth.users where lower(email) in ('phase-e-owner@example.com','phase-e-agent@example.com');
commit;

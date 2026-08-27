begin;
drop function if exists public.phase_d_test_configure(uuid,uuid,uuid,uuid,uuid,uuid);
drop function if exists public.phase_d_test_set_limit(uuid,integer);
drop function if exists public.phase_d_test_expire_invitation(uuid);
delete from public.organizations where name like '[PHASE\_D\_TEST] %' escape '\';
delete from auth.users where lower(email) like 'phase-d-%@example.com';
commit;

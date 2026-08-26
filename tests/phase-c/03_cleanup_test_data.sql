-- FASE C: limpeza EXCLUSIVAMENTE no mesmo projeto de staging usado no teste.
-- Remove somente as seis contas e organizações com identificadores de teste.

begin;

do $$
begin
  if exists (
    select 1 from public.organizations
    where id = 'd3c8309e-a714-4de3-b0cf-1d035b3c25f6'::uuid
  ) or exists (
    select 1 from auth.users
    where id = '6bc58cfd-b75b-4f37-9fd8-6d8fd40c5a4a'::uuid
  ) then
    raise exception 'REFUSING TO RUN PHASE C TEST CLEANUP IN PRODUCTION';
  end if;
end;
$$;

drop function if exists public.phase_c_test_set_membership_status(uuid, uuid, text);

delete from auth.users
where lower(email) in (
  'phase-c-owner-a@example.com',
  'phase-c-manager-a@example.com',
  'phase-c-agent-a1@example.com',
  'phase-c-agent-a2@example.com',
  'phase-c-disabled-a@example.com',
  'phase-c-owner-b@example.com'
);

delete from public.organizations
where name in (
  '[PHASE_C_TEST] Organization A',
  '[PHASE_C_TEST] Organization B'
)
or name like '[PHASE\_C\_TEST] Bootstrap %' escape '\';

commit;

select
  count(*) as remaining_test_users
from auth.users
where lower(email) in (
  'phase-c-owner-a@example.com',
  'phase-c-manager-a@example.com',
  'phase-c-agent-a1@example.com',
  'phase-c-agent-a2@example.com',
  'phase-c-disabled-a@example.com',
  'phase-c-owner-b@example.com'
);

select
  count(*) as remaining_test_organizations
from public.organizations
where name in (
  '[PHASE_C_TEST] Organization A',
  '[PHASE_C_TEST] Organization B'
)
or name like '[PHASE\_C\_TEST] Bootstrap %' escape '\';

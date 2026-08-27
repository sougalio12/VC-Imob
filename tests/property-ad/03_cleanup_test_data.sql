begin;

drop function if exists public.property_ad_test_organization(uuid);
drop function if exists public.property_ad_test_snapshot(uuid);
drop function if exists public.property_ad_test_counts(uuid);

delete from auth.users
where email = 'property-ad-owner@example.com';

delete from public.organizations
where name = '[PROPERTY_AD_TEST]';

do $$
begin
  if exists (
    select 1 from auth.users
    where email = 'property-ad-owner@example.com'
  ) or exists (
    select 1 from public.organizations
    where name = '[PROPERTY_AD_TEST]'
  ) then
    raise exception 'PROPERTY AD TEST FIXTURES REMAIN AFTER CLEANUP';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;

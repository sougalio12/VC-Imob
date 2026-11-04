-- No existing accounts/data are rewritten. Consent rules apply to subsequent inserts only.
-- The exemption is controlled by Auth Admin API app_metadata or Auth's invitation timestamp.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  new_org_id uuid;
  -- raw_app_meta_data is server-controlled; raw_user_meta_data is not.
  -- Existing users are unaffected. Admin API provisioning must explicitly set this marker.
  is_public boolean := not (
    coalesce(new.raw_app_meta_data->>'vcimob_provisioning','') = 'administrative'
    or new.invited_at is not null
  );
  accepted boolean := coalesce((new.raw_user_meta_data->>'legal_accepted')::boolean,false);
  terms_version text := nullif(trim(new.raw_user_meta_data->>'terms_version'),'');
  privacy_version text := nullif(trim(new.raw_user_meta_data->>'privacy_version'),'');
  full_name text := nullif(trim(new.raw_user_meta_data->>'full_name'),'');
  phone_value text := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9+]','','g'),'');
  company_name text := nullif(trim(new.raw_user_meta_data->>'company_name'),'');
  trial_start timestamptz;
begin
  if is_public and (not accepted or terms_version is distinct from '2026-09-12' or privacy_version is distinct from '2026-09-12' or char_length(coalesce(full_name,'')) < 2 or char_length(coalesce(phone_value,'')) < 8) then
    raise exception using errcode='22023', message='Cadastro publico incompleto';
  end if;
  insert into public.organizations(name) values(coalesce(company_name,nullif(trim(new.email),''),'VC Imob')) returning id into new_org_id;
  insert into public.profiles(id,organization_id,full_name,role,phone,creci,signup_completed_at)
  values(new.id,new_org_id,coalesce(full_name,''),'owner',phone_value,nullif(trim(new.raw_user_meta_data->>'creci'),''),case when is_public then now() end);
  insert into public.organization_members(organization_id,user_id,role,status) values(new_org_id,new.id,'owner','active');
  if is_public then
    select s.trial_starts_at into trial_start from public.subscriptions s where s.organization_id=new_org_id and s.is_current;
    insert into public.trial_claims(user_id,organization_id,started_at,ends_at)
      values(new.id,new_org_id,trial_start,trial_start+interval '7 days');
    insert into public.account_consents(user_id,organization_id,terms_version,privacy_version)
      values(new.id,new_org_id,'2026-09-12','2026-09-12');
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

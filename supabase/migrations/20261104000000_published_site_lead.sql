-- Reviewed source only: apply to an isolated/staging database before coordinating an Edge Function release.
-- The publication predicate is shared by the public catalog and server-only capture.
create or replace function public.property_is_public(property public.properties)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(property.is_published and property.status in ('available','reserved'), false)
$$;
revoke all on function public.property_is_public(public.properties) from public,anon,authenticated;

create or replace function public.list_public_properties(target_hostname text default 'valdineycapistranoimoveis.com.br')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare target_org uuid;
begin
 select s.organization_id into target_org from public.organization_sites s where s.status='active' and s.hostname=lower(split_part(coalesce(target_hostname,''),':',1)) limit 1;
 if target_org is null and lower(split_part(coalesce(target_hostname,''),':',1)) in ('valdineycapistranoimoveis.com.br','www.valdineycapistranoimoveis.com.br','localhost','127.0.0.1') then
   select sub.organization_id into target_org from public.subscriptions sub where sub.is_current and sub.provider='internal' and coalesce((sub.metadata->>'billing_exempt')::boolean,false) order by sub.created_at limit 1;
 end if;
 return query select public.property_public_json(p) from public.properties p where p.organization_id=target_org and public.property_is_public(p) order by p.featured desc,p.publication_date desc nulls last,p.code;
end $$;

-- Never expose organization selection or arbitrary property titles to an anonymous caller.
create or replace function public.capture_published_site_lead(
  target_organization uuid, target_name text, target_phone text, target_email text,
  target_property_code text, target_source text default null, target_medium text default null,
  target_campaign text default null, target_content text default null, target_term text default null,
  target_landing_page text default null
)
returns table(lead_id uuid,created boolean)
language plpgsql volatile security definer set search_path='' as $$
declare published public.properties;
begin
  -- Lock publication state until capture completes; no static JSON or client-supplied title.
  select p.* into published from public.properties p
  where p.organization_id=target_organization and p.code=upper(trim(target_property_code))
    and public.property_is_public(p)
  for share;
  if not found then return; end if;
  return query select captured.lead_id,captured.created
  from public.capture_site_lead_attributed(
    target_organization,target_name,target_phone,target_email,published.code,published.title,
    target_source,target_medium,target_campaign,target_content,target_term,target_landing_page
  ) captured;
end $$;
revoke all on function public.capture_published_site_lead(uuid,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.capture_published_site_lead(uuid,text,text,text,text,text,text,text,text,text,text) to service_role;

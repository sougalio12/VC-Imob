-- Documentos 2.0: autopreenchimento estruturado e exclusao/arquivamento seguro.
-- Nao altera templates, clausulas, snapshots ou regras juridicas.
begin;

alter table public.real_estate_documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists real_estate_documents_active_org_idx
  on public.real_estate_documents(organization_id,updated_at desc)
  where archived_at is null;

create or replace function public.can_access_real_estate_document(target_document uuid,target_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.can_use_entitlement(target_organization,'crm.documents') and exists(
    select 1 from public.real_estate_documents d
    where d.id=target_document and d.organization_id=target_organization and d.archived_at is null
      and (public.current_membership_role(target_organization) in ('owner','manager')
        or (public.current_membership_role(target_organization)='agent'
          and (d.responsible_user_id=auth.uid() or (d.lead_id is not null and public.can_access_lead(d.lead_id,target_organization)))))
  )
$$;

create or replace function public.get_real_estate_document_prefill(
  target_organization uuid,target_type text,target_property uuid default null,target_owner uuid default null,target_lead uuid default null,target_proposal uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  p public.properties;o public.property_owners;l public.leads;deal public.proposals;pr public.profiles;org public.organizations;
  acquisition public.property_acquisitions;actor_role text:=public.current_membership_role(target_organization);
  resolved_property uuid:=target_property;resolved_owner uuid:=target_owner;resolved_lead uuid:=target_lead;
  result jsonb:='{}';property_text text;professional_name text;deal_price numeric;
begin
  if target_type not in ('sale_intermediation','property_sale_purchase') then raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE';end if;
  perform public.real_estate_document_assert_references(target_organization,target_property,target_owner,target_lead,target_proposal);

  if target_proposal is not null then
    select * into deal from public.proposals where id=target_proposal and organization_id=target_organization;
    resolved_property:=coalesce(resolved_property,deal.property_id);
    resolved_lead:=coalesce(resolved_lead,deal.lead_id);
  end if;

  if resolved_property is not null then
    select * into p from public.properties where id=resolved_property and organization_id=target_organization;
    if resolved_owner is null then
      select a.* into acquisition from public.property_acquisitions a join public.property_owners candidate on candidate.id=a.owner_id and candidate.organization_id=a.organization_id
      where a.organization_id=target_organization and a.property_id=resolved_property
        and (actor_role in ('owner','manager') or a.assigned_to=auth.uid() or candidate.assigned_to=auth.uid())
      order by case when a.stage='acquired' then 0 else 1 end,a.updated_at desc limit 1;
      resolved_owner:=acquisition.owner_id;
    end if;
  end if;

  perform public.real_estate_document_assert_references(target_organization,resolved_property,resolved_owner,resolved_lead,target_proposal);
  select * into o from public.property_owners where id=resolved_owner and organization_id=target_organization;
  select * into l from public.leads where id=resolved_lead and organization_id=target_organization;
  select * into pr from public.profiles where id=auth.uid();
  select * into org from public.organizations where id=target_organization;

  property_text:=case when p.id is null then null else nullif(concat_ws(', ',
    nullif(p.code,''),nullif(p.property_type,''),nullif(p.title,''),nullif(p.public_address,''),nullif(p.neighborhood,''),
    nullif(concat_ws('/',nullif(p.city,''),nullif(p.state,'')),''),
    case when p.total_area is null then null else trim(trailing '.' from trim(trailing '0' from p.total_area::text))||' '||p.total_area_unit end,
    nullif(p.description,'')
  ),'') end;
  professional_name:=nullif(concat_ws(' · ',nullif(pr.full_name,''),coalesce(nullif(org.trade_name,''),nullif(org.name,''))), '');
  deal_price:=coalesce(deal.final_price,deal.counter_price,deal.proposed_price,deal.asking_price,p.price);

  result:=jsonb_strip_nulls(jsonb_build_object(
    'seller_name',o.full_name,
    'seller_contact',nullif(concat_ws(' | ',nullif(o.phone,''),nullif(o.email,'')),''),
    'buyer_name',l.name,
    'buyer_contact',nullif(concat_ws(' | ',nullif(l.phone,''),nullif(l.whatsapp,''),nullif(l.email,'')),''),
    'broker_name',professional_name,
    'broker_qualification',nullif(org.commercial_signature,''),
    'broker_creci',coalesce(nullif(pr.creci,''),nullif(org.creci,''),nullif(p.broker_creci,'')),
    'broker_contact',nullif(concat_ws(' | ',nullif(pr.phone,''),nullif(org.public_phone,''),nullif(org.public_whatsapp,'')),''),
    'property_description',property_text,
    'offer_price',p.price,
    'price',case when target_type='property_sale_purchase' then deal_price else p.price end,
    'city',nullif(concat_ws('/',nullif(p.city,''),nullif(p.state,'')),''),
    'document_date',to_char(current_date,'YYYY-MM-DD'),
    '_references',jsonb_strip_nulls(jsonb_build_object('property_id',resolved_property,'owner_id',resolved_owner,'lead_id',resolved_lead,'proposal_id',target_proposal)),
    '_identity',jsonb_strip_nulls(jsonb_build_object('identity_id',org.current_document_identity_id,'organization_name',org.name,'trade_name',org.trade_name,'creci',org.creci))
  ));
  return result;
end $$;

create or replace function public.delete_real_estate_document(target_organization uuid,target_document uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare document public.real_estate_documents;has_finalized_version boolean;mode text;
begin
  select * into document from public.real_estate_documents
  where id=target_document and organization_id=target_organization and archived_at is null for update;
  if not found or not public.can_access_real_estate_document(target_document,target_organization) then
    raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED';
  end if;
  select exists(select 1 from public.real_estate_document_versions v where v.document_id=document.id and v.status='finalized') into has_finalized_version;
  if document.status='finalized' or has_finalized_version then
    update public.real_estate_documents set archived_at=now(),archived_by=auth.uid(),updated_at=now() where id=document.id;
    mode:='archived';
    insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
      values(target_organization,auth.uid(),'real_estate_document',document.id,'document_archived',jsonb_build_object('status',document.status,'current_version',document.current_version,'preserved_finalized_version',has_finalized_version));
  else
    insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
      values(target_organization,auth.uid(),'real_estate_document',document.id,'document_deleted',jsonb_build_object('status',document.status,'current_version',document.current_version));
    delete from public.real_estate_documents where id=document.id;
    mode:='deleted';
  end if;
  return jsonb_build_object('document_id',document.id,'mode',mode);
end $$;

revoke all on function public.delete_real_estate_document(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_real_estate_document(uuid,uuid) to authenticated;

commit;

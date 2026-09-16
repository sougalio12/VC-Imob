-- Auditoria global de UX/CRUD: campanhas usam arquivamento para preservar
-- atribuições, métricas e histórico comercial.

alter table public.marketing_campaigns
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists marketing_campaigns_active_idx
  on public.marketing_campaigns(organization_id,created_at desc)
  where archived_at is null;

create or replace function public.validate_lead_campaign_tenant_reference()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.marketing_campaign_id is not null and not exists(
    select 1 from public.marketing_campaigns c
    where c.id=new.marketing_campaign_id and c.organization_id=new.organization_id
  ) then
    raise exception using errcode='23514',message='Cross-tenant campaign attribution denied';
  end if;
  if new.marketing_campaign_id is not null
     and (tg_op='INSERT' or new.marketing_campaign_id is distinct from old.marketing_campaign_id)
     and exists(select 1 from public.marketing_campaigns c where c.id=new.marketing_campaign_id and c.archived_at is not null) then
    raise exception using errcode='23514',message='Archived campaign attribution denied';
  end if;
  return new;
end $$;

create or replace function public.save_marketing_campaign(target_organization uuid,target_campaign uuid,target_payload jsonb)
returns public.marketing_campaigns language plpgsql volatile security definer set search_path='' as $$
declare saved public.marketing_campaigns; unexpected text;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  select key into unexpected from jsonb_object_keys(coalesce(target_payload,'{}')) key where key<>all(array['name','source','medium','campaign','content','term','landing_page','property_id','cost','starts_on','ends_on','status','notes']) limit 1;
  if unexpected is not null or nullif(trim(target_payload->>'name'),'') is null or nullif(public.normalize_attribution_value(target_payload->>'source'),'') is null or coalesce(target_payload->>'status','active') not in ('draft','active','paused','finished') then raise exception using errcode='22023',message='MARKETING_INVALID_CAMPAIGN'; end if;
  if nullif(target_payload->>'property_id','') is not null and not exists(
    select 1 from public.properties p where p.id=(target_payload->>'property_id')::uuid and p.organization_id=target_organization
  ) then raise exception using errcode='42501',message='MARKETING_REFERENCE_DENIED'; end if;
  if target_campaign is null then
    insert into public.marketing_campaigns(organization_id,name,source,medium,campaign,content,term,landing_page,property_id,cost,starts_on,ends_on,status,notes,created_by)
    values(target_organization,trim(target_payload->>'name'),public.normalize_attribution_value(target_payload->>'source'),public.normalize_attribution_value(target_payload->>'medium'),public.normalize_attribution_value(target_payload->>'campaign'),public.normalize_attribution_value(target_payload->>'content'),public.normalize_attribution_value(target_payload->>'term'),public.normalize_landing_page(target_payload->>'landing_page'),nullif(target_payload->>'property_id','')::uuid,nullif(target_payload->>'cost','')::numeric,nullif(target_payload->>'starts_on','')::date,nullif(target_payload->>'ends_on','')::date,coalesce(target_payload->>'status','active'),nullif(trim(target_payload->>'notes'),''),auth.uid()) returning * into saved;
  else
    update public.marketing_campaigns set name=trim(target_payload->>'name'),source=public.normalize_attribution_value(target_payload->>'source'),medium=public.normalize_attribution_value(target_payload->>'medium'),campaign=public.normalize_attribution_value(target_payload->>'campaign'),content=public.normalize_attribution_value(target_payload->>'content'),term=public.normalize_attribution_value(target_payload->>'term'),landing_page=public.normalize_landing_page(target_payload->>'landing_page'),property_id=nullif(target_payload->>'property_id','')::uuid,cost=nullif(target_payload->>'cost','')::numeric,starts_on=nullif(target_payload->>'starts_on','')::date,ends_on=nullif(target_payload->>'ends_on','')::date,status=coalesce(target_payload->>'status','active'),notes=nullif(trim(target_payload->>'notes'),'') where id=target_campaign and organization_id=target_organization and archived_at is null returning * into saved;
    if saved.id is null then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'marketing_campaign',saved.id,case when target_campaign is null then 'campaign_created' else 'campaign_updated' end,jsonb_build_object('status',saved.status));
  return saved;
end $$;

create or replace function public.archive_marketing_campaign(target_organization uuid,target_campaign uuid)
returns public.marketing_campaigns language plpgsql volatile security definer set search_path='' as $$
declare saved public.marketing_campaigns;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then
    raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED';
  end if;
  select * into saved from public.marketing_campaigns
    where id=target_campaign and organization_id=target_organization for update;
  if saved.id is null then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  if saved.archived_at is null then
    update public.marketing_campaigns
      set status='finished',archived_at=now(),archived_by=auth.uid(),updated_at=now()
      where id=saved.id returning * into saved;
    insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
      values(target_organization,auth.uid(),'marketing_campaign',saved.id,'campaign_archived',jsonb_build_object('preserved_attributions',true));
  end if;
  return saved;
end $$;

create or replace function public.get_marketing_roi(target_organization uuid)
returns table(campaign_id uuid,name text,source text,cost numeric,leads bigint,opportunities bigint,visits bigint,proposals bigint,sales bigint,revenue numeric,cpl numeric,cac numeric,roi numeric)
language sql stable security definer set search_path='' as $$
  with lead_stats as (
    select l.marketing_campaign_id campaign_id,count(*) leads,count(*) filter(where l.stage<>'perdido') opportunities
    from public.leads l where l.organization_id=target_organization and l.marketing_campaign_id is not null group by l.marketing_campaign_id
  ), visit_stats as (
    select l.marketing_campaign_id campaign_id,count(distinct a.id) visits
    from public.leads l join public.appointments a on a.organization_id=l.organization_id and a.lead_id=l.id
    where l.organization_id=target_organization and l.marketing_campaign_id is not null and a.kind='visita' and a.status<>'cancelado'
    group by l.marketing_campaign_id
  ), proposal_stats as (
    select l.marketing_campaign_id campaign_id,count(distinct p.id) proposals,
      count(distinct p.id) filter(where p.status='accepted') sales,
      sum(case when p.status='accepted' then coalesce(p.final_price,p.proposed_price) end) revenue
    from public.leads l join public.proposals p on p.organization_id=l.organization_id and p.lead_id=l.id
    where l.organization_id=target_organization and l.marketing_campaign_id is not null group by l.marketing_campaign_id
  )
  select c.id,c.name,c.source,c.cost,coalesce(ls.leads,0),coalesce(ls.opportunities,0),coalesce(vs.visits,0),coalesce(ps.proposals,0),coalesce(ps.sales,0),ps.revenue,
    case when c.cost>0 and ls.leads>0 then c.cost/ls.leads end,
    case when c.cost>0 and ps.sales>0 then c.cost/ps.sales end,
    case when c.cost>0 and ps.revenue is not null then (ps.revenue-c.cost)*100/c.cost end
  from public.marketing_campaigns c
  left join lead_stats ls on ls.campaign_id=c.id left join visit_stats vs on vs.campaign_id=c.id left join proposal_stats ps on ps.campaign_id=c.id
  where c.organization_id=target_organization and c.archived_at is null
    and public.current_membership_role(target_organization) in ('owner','manager')
  order by c.created_at desc
$$;

revoke all on function public.archive_marketing_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.archive_marketing_campaign(uuid,uuid) to authenticated;
revoke all on function public.validate_lead_campaign_tenant_reference() from public,anon,authenticated;

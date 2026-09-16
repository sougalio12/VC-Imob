-- Bloco 3: captação, proprietário 360, atribuição e ROI com mutações RPC tenant-safe.
begin;

alter table public.property_owners
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists status text not null default 'active'
    check (status in ('active','inactive'));

alter table public.marketing_campaigns
  add column if not exists notes text check (notes is null or char_length(notes)<=3000);

create table public.property_acquisition_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  acquisition_id uuid not null references public.property_acquisitions(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','updated','stage_changed','assigned','property_linked')),
  from_value text,
  to_value text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create table public.property_acquisition_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  acquisition_id uuid not null references public.property_acquisitions(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('contact','technical_visit','document','follow_up','note')),
  title text not null check (char_length(trim(title)) between 2 and 180),
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','completed','canceled')),
  notes text check (notes is null or char_length(notes)<=3000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index property_owners_assignee_idx on public.property_owners(organization_id,assigned_to,status);
create index acquisition_history_timeline_idx on public.property_acquisition_history(acquisition_id,created_at desc);
create index acquisition_activities_timeline_idx on public.property_acquisition_activities(acquisition_id,scheduled_at,created_at desc);
create index acquisition_next_action_idx on public.property_acquisitions(organization_id,next_action_at) where stage not in ('acquired','lost');
create index campaigns_utm_lookup_idx on public.marketing_campaigns(organization_id,source,campaign) where status in ('active','paused');

alter table public.property_acquisition_history enable row level security;
alter table public.property_acquisition_history force row level security;
alter table public.property_acquisition_activities enable row level security;
alter table public.property_acquisition_activities force row level security;

create policy acquisition_history_read on public.property_acquisition_history for select to authenticated
  using (exists(select 1 from public.property_acquisitions a where a.id=acquisition_id and a.organization_id=organization_id
    and (public.current_membership_role(a.organization_id) in ('owner','manager') or a.assigned_to=auth.uid())));
create policy acquisition_activities_read on public.property_acquisition_activities for select to authenticated
  using (exists(select 1 from public.property_acquisitions a where a.id=acquisition_id and a.organization_id=organization_id
    and (public.current_membership_role(a.organization_id) in ('owner','manager') or a.assigned_to=auth.uid())));
create policy owners_assigned_read on public.property_owners for select to authenticated
  using (assigned_to=auth.uid() or exists(select 1 from public.property_acquisitions a where a.owner_id=id and a.organization_id=organization_id and a.assigned_to=auth.uid()));

revoke all on public.property_acquisition_history,public.property_acquisition_activities from public,anon,authenticated;
grant select on public.property_acquisition_history,public.property_acquisition_activities to authenticated;
revoke insert,update,delete on public.property_owners,public.property_acquisitions,public.marketing_campaigns from authenticated;
revoke insert(utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,marketing_campaign_id),
  update(utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,marketing_campaign_id) on public.leads from authenticated;

create trigger property_acquisition_activities_updated before update on public.property_acquisition_activities
  for each row execute function public.set_updated_at();

create or replace function public.validate_capture_owner()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.assigned_to is not null and not exists(
    select 1 from public.organization_members m where m.organization_id=new.organization_id and m.user_id=new.assigned_to and m.status='active'
  ) then raise exception using errcode='23514',message='CAPTURE_INVALID_ASSIGNEE'; end if;
  return new;
end $$;
create trigger property_owners_validate before insert or update on public.property_owners
  for each row execute function public.validate_capture_owner();

create or replace function public.capture_can_access(target_acquisition uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.property_acquisitions a where a.id=target_acquisition
    and (public.current_membership_role(a.organization_id) in ('owner','manager') or a.assigned_to=auth.uid()))
$$;
revoke all on function public.capture_can_access(uuid) from public,anon,authenticated;
grant execute on function public.capture_can_access(uuid) to authenticated;

create or replace function public.save_property_owner(target_organization uuid,target_owner uuid,target_payload jsonb)
returns public.property_owners language plpgsql volatile security definer set search_path='' as $$
declare actor_role text:=public.current_membership_role(target_organization); existing public.property_owners; saved public.property_owners; unexpected text; assignee uuid;
begin
  if actor_role not in ('owner','manager','agent') then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object' then raise exception using errcode='22023',message='CAPTURE_INVALID_OWNER'; end if;
  select key into unexpected from jsonb_object_keys(target_payload) key where key<>all(array['full_name','phone','email','notes','assigned_to','status']) limit 1;
  if unexpected is not null then raise exception using errcode='22023',message='CAPTURE_INVALID_OWNER_FIELD'; end if;
  assignee:=nullif(target_payload->>'assigned_to','')::uuid;
  if actor_role='agent' then assignee:=auth.uid(); end if;
  if assignee is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=assignee and m.status='active') then raise exception using errcode='22023',message='CAPTURE_INVALID_ASSIGNEE'; end if;
  if nullif(trim(target_payload->>'full_name'),'') is null or char_length(trim(target_payload->>'full_name'))>160
    or char_length(coalesce(target_payload->>'notes',''))>3000
    or (coalesce(target_payload->>'email','')<>'' and lower(trim(target_payload->>'email')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or coalesce(target_payload->>'status','active') not in ('active','inactive') then raise exception using errcode='22023',message='CAPTURE_INVALID_OWNER'; end if;
  if target_owner is null then
    insert into public.property_owners(organization_id,full_name,phone,email,notes,assigned_to,status,created_by)
    values(target_organization,trim(target_payload->>'full_name'),public.normalize_crm_phone(target_payload->>'phone'),nullif(lower(trim(target_payload->>'email')),''),nullif(trim(target_payload->>'notes'),''),assignee,coalesce(target_payload->>'status','active'),auth.uid()) returning * into saved;
  else
    select * into existing from public.property_owners o where o.id=target_owner and o.organization_id=target_organization for update;
    if not found or (actor_role='agent' and existing.assigned_to is distinct from auth.uid() and not exists(select 1 from public.property_acquisitions a where a.owner_id=existing.id and a.assigned_to=auth.uid())) then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
    update public.property_owners set full_name=trim(target_payload->>'full_name'),phone=public.normalize_crm_phone(target_payload->>'phone'),email=nullif(lower(trim(target_payload->>'email')),''),notes=nullif(trim(target_payload->>'notes'),''),assigned_to=assignee,status=coalesce(target_payload->>'status',status) where id=existing.id returning * into saved;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'property_owner',saved.id,case when target_owner is null then 'owner_created' else 'owner_updated' end,'{}');
  return saved;
end $$;

create or replace function public.save_property_acquisition(target_organization uuid,target_acquisition uuid,target_payload jsonb)
returns public.property_acquisitions language plpgsql volatile security definer set search_path='' as $$
declare actor_role text:=public.current_membership_role(target_organization); existing public.property_acquisitions; saved public.property_acquisitions; unexpected text; assignee uuid; stage_value text; owner_value uuid;
begin
  if actor_role not in ('owner','manager','agent') then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object' then raise exception using errcode='22023',message='CAPTURE_INVALID_ACQUISITION'; end if;
  select key into unexpected from jsonb_object_keys(target_payload) key where key<>all(array['owner_id','assigned_to','title','property_type','neighborhood','estimated_value','stage','loss_reason','next_action_at','notes']) limit 1;
  if unexpected is not null then raise exception using errcode='22023',message='CAPTURE_INVALID_ACQUISITION_FIELD'; end if;
  owner_value:=nullif(target_payload->>'owner_id','')::uuid; assignee:=nullif(target_payload->>'assigned_to','')::uuid; stage_value:=coalesce(target_payload->>'stage','new_contact');
  if actor_role='agent' then assignee:=auth.uid(); end if;
  if not exists(select 1 from public.property_owners o where o.id=owner_value and o.organization_id=target_organization)
    or (assignee is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=assignee and m.status='active')) then raise exception using errcode='42501',message='CAPTURE_REFERENCE_DENIED'; end if;
  if nullif(trim(target_payload->>'title'),'') is null or char_length(trim(target_payload->>'title'))>180
    or stage_value not in ('new_contact','qualification','technical_visit','documentation','negotiation','authorization','acquired','lost')
    or (stage_value='lost')<>(nullif(target_payload->>'loss_reason','') is not null)
    or char_length(coalesce(target_payload->>'notes',''))>5000 then raise exception using errcode='22023',message='CAPTURE_INVALID_ACQUISITION'; end if;
  if target_acquisition is null then
    insert into public.property_acquisitions(organization_id,owner_id,assigned_to,title,property_type,neighborhood,estimated_value,stage,loss_reason,next_action_at,notes,created_by)
    values(target_organization,owner_value,assignee,trim(target_payload->>'title'),nullif(trim(target_payload->>'property_type'),''),nullif(trim(target_payload->>'neighborhood'),''),nullif(target_payload->>'estimated_value','')::numeric,stage_value,nullif(target_payload->>'loss_reason',''),nullif(target_payload->>'next_action_at','')::timestamptz,nullif(trim(target_payload->>'notes'),''),auth.uid()) returning * into saved;
    insert into public.property_acquisition_history(organization_id,acquisition_id,actor_id,action,to_value) values(target_organization,saved.id,auth.uid(),'created',saved.stage);
  else
    select * into existing from public.property_acquisitions a where a.id=target_acquisition and a.organization_id=target_organization for update;
    if not found or (actor_role='agent' and existing.assigned_to is distinct from auth.uid()) then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
    if existing.property_id is not null and owner_value is distinct from existing.owner_id then raise exception using errcode='22023',message='CAPTURE_LINKED_OWNER_IMMUTABLE'; end if;
    update public.property_acquisitions set owner_id=owner_value,assigned_to=assignee,title=trim(target_payload->>'title'),property_type=nullif(trim(target_payload->>'property_type'),''),neighborhood=nullif(trim(target_payload->>'neighborhood'),''),estimated_value=nullif(target_payload->>'estimated_value','')::numeric,stage=stage_value,loss_reason=nullif(target_payload->>'loss_reason',''),next_action_at=nullif(target_payload->>'next_action_at','')::timestamptz,notes=nullif(trim(target_payload->>'notes'),'') where id=existing.id returning * into saved;
    insert into public.property_acquisition_history(organization_id,acquisition_id,actor_id,action,from_value,to_value,metadata)
      values(target_organization,saved.id,auth.uid(),case when existing.stage is distinct from saved.stage then 'stage_changed' when existing.assigned_to is distinct from saved.assigned_to then 'assigned' else 'updated' end,case when existing.stage is distinct from saved.stage then existing.stage when existing.assigned_to is distinct from saved.assigned_to then existing.assigned_to::text end,case when existing.stage is distinct from saved.stage then saved.stage when existing.assigned_to is distinct from saved.assigned_to then saved.assigned_to::text end,'{}');
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'property_acquisition',saved.id,case when target_acquisition is null then 'acquisition_created' else 'acquisition_updated' end,jsonb_build_object('stage',saved.stage));
  return saved;
end $$;

create or replace function public.save_acquisition_activity(target_acquisition uuid,target_activity uuid,target_payload jsonb)
returns public.property_acquisition_activities language plpgsql volatile security definer set search_path='' as $$
declare acquisition public.property_acquisitions; existing public.property_acquisition_activities; saved public.property_acquisition_activities; actor_role text; assignee uuid; unexpected text;
begin
  select * into acquisition from public.property_acquisitions where id=target_acquisition for update;
  actor_role:=public.current_membership_role(acquisition.organization_id);
  if acquisition.id is null or actor_role not in ('owner','manager','agent') or (actor_role='agent' and acquisition.assigned_to is distinct from auth.uid()) then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
  select key into unexpected from jsonb_object_keys(coalesce(target_payload,'{}')) key where key<>all(array['assigned_to','kind','title','scheduled_at','status','notes']) limit 1;
  if unexpected is not null then raise exception using errcode='22023',message='CAPTURE_INVALID_ACTIVITY_FIELD'; end if;
  assignee:=coalesce(nullif(target_payload->>'assigned_to','')::uuid,acquisition.assigned_to,auth.uid()); if actor_role='agent' then assignee:=auth.uid(); end if;
  if not exists(select 1 from public.organization_members m where m.organization_id=acquisition.organization_id and m.user_id=assignee and m.status='active')
    or coalesce(target_payload->>'kind','') not in ('contact','technical_visit','document','follow_up','note')
    or nullif(trim(target_payload->>'title'),'') is null or char_length(trim(target_payload->>'title'))>180
    or coalesce(target_payload->>'status','scheduled') not in ('scheduled','completed','canceled') then raise exception using errcode='22023',message='CAPTURE_INVALID_ACTIVITY'; end if;
  if target_activity is null then
    insert into public.property_acquisition_activities(organization_id,acquisition_id,assigned_to,kind,title,scheduled_at,status,notes,created_by)
    values(acquisition.organization_id,acquisition.id,assignee,target_payload->>'kind',trim(target_payload->>'title'),nullif(target_payload->>'scheduled_at','')::timestamptz,coalesce(target_payload->>'status','scheduled'),nullif(trim(target_payload->>'notes'),''),auth.uid()) returning * into saved;
  else
    select * into existing from public.property_acquisition_activities where id=target_activity and acquisition_id=acquisition.id for update;
    if not found then raise exception using errcode='42501',message='CAPTURE_ACCESS_DENIED'; end if;
    update public.property_acquisition_activities set assigned_to=assignee,kind=target_payload->>'kind',title=trim(target_payload->>'title'),scheduled_at=nullif(target_payload->>'scheduled_at','')::timestamptz,status=coalesce(target_payload->>'status',status),notes=nullif(trim(target_payload->>'notes'),'') where id=existing.id returning * into saved;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(acquisition.organization_id,auth.uid(),'property_acquisition',acquisition.id,'acquisition_activity_saved',jsonb_build_object('activity_id',saved.id,'kind',saved.kind,'status',saved.status));
  return saved;
end $$;

create or replace function public.convert_acquisition_to_property(target_acquisition uuid,target_payload jsonb)
returns public.properties language plpgsql volatile security definer set search_path='' as $$
declare acquisition public.property_acquisitions; owner_row public.property_owners; saved public.properties; payload jsonb;
begin
  select * into acquisition from public.property_acquisitions where id=target_acquisition for update;
  if acquisition.id is null or public.current_membership_role(acquisition.organization_id) not in ('owner','manager') then raise exception using errcode='42501',message='CAPTURE_CONVERSION_DENIED'; end if;
  if acquisition.stage in ('lost') then raise exception using errcode='22023',message='CAPTURE_CONVERSION_INVALID_STAGE'; end if;
  if acquisition.property_id is not null then select * into saved from public.properties where id=acquisition.property_id; return saved; end if;
  select * into owner_row from public.property_owners where id=acquisition.owner_id and organization_id=acquisition.organization_id;
  payload:=jsonb_build_object('code',upper(trim(target_payload->>'code')),'title',trim(coalesce(nullif(target_payload->>'title',''),acquisition.title)),'slug',trim(target_payload->>'slug'),'purpose',coalesce(nullif(target_payload->>'purpose',''),'venda'),'property_type',coalesce(nullif(target_payload->>'property_type',''),acquisition.property_type),'price',coalesce(nullif(target_payload->>'price','')::numeric,acquisition.estimated_value),'neighborhood',coalesce(nullif(target_payload->>'neighborhood',''),acquisition.neighborhood),'city',nullif(target_payload->>'city',''),'state',nullif(target_payload->>'state',''),'status','draft','is_published',false,'featured',false,'description',nullif(target_payload->>'description',''),'broker_name',nullif(target_payload->>'broker_name',''));
  select * into saved from public.save_crm_property(acquisition.organization_id,null,null,payload);
  update public.property_acquisitions set property_id=saved.id,stage='acquired',loss_reason=null,next_action_at=null where id=acquisition.id;
  insert into public.property_acquisition_history(organization_id,acquisition_id,actor_id,action,to_value,metadata) values(acquisition.organization_id,acquisition.id,auth.uid(),'property_linked',saved.id::text,jsonb_build_object('property_code',saved.code));
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(acquisition.organization_id,auth.uid(),'property_acquisition',acquisition.id,'acquisition_converted',jsonb_build_object('property_id',saved.id,'property_code',saved.code));
  return saved;
end $$;

create or replace function public.normalize_attribution_value(value text) returns text language sql immutable set search_path='' as $$
  select nullif(left(regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9._~-]+','-','g'),100),'')
$$;
create or replace function public.normalize_landing_page(value text) returns text language plpgsql immutable set search_path='' as $$
declare clean text:=left(trim(coalesce(value,'')),500);
begin
  if clean='' then return null; end if;
  if clean !~ '^https://valdineycapistranoimoveis\.com\.br(?:/|$)' then raise exception using errcode='22023',message='MARKETING_INVALID_LANDING_PAGE'; end if;
  return clean;
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
    update public.marketing_campaigns set name=trim(target_payload->>'name'),source=public.normalize_attribution_value(target_payload->>'source'),medium=public.normalize_attribution_value(target_payload->>'medium'),campaign=public.normalize_attribution_value(target_payload->>'campaign'),content=public.normalize_attribution_value(target_payload->>'content'),term=public.normalize_attribution_value(target_payload->>'term'),landing_page=public.normalize_landing_page(target_payload->>'landing_page'),property_id=nullif(target_payload->>'property_id','')::uuid,cost=nullif(target_payload->>'cost','')::numeric,starts_on=nullif(target_payload->>'starts_on','')::date,ends_on=nullif(target_payload->>'ends_on','')::date,status=coalesce(target_payload->>'status','active'),notes=nullif(trim(target_payload->>'notes'),'') where id=target_campaign and organization_id=target_organization returning * into saved;
    if saved.id is null then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'marketing_campaign',saved.id,case when target_campaign is null then 'campaign_created' else 'campaign_updated' end,jsonb_build_object('status',saved.status));
  return saved;
end $$;

create or replace function public.attribute_lead_marketing(target_lead uuid,target_payload jsonb)
returns public.leads language plpgsql volatile security definer set search_path='' as $$
declare existing public.leads; saved public.leads; campaign_id uuid; unexpected text;
begin
  select * into existing from public.leads where id=target_lead for update;
  if existing.id is null or not public.can_access_lead(existing.id,existing.organization_id) then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  select key into unexpected from jsonb_object_keys(coalesce(target_payload,'{}')) key where key<>all(array['source','medium','campaign','content','term','landing_page','marketing_campaign_id']) limit 1;
  if unexpected is not null then raise exception using errcode='22023',message='MARKETING_INVALID_ATTRIBUTION_FIELD'; end if;
  campaign_id:=nullif(target_payload->>'marketing_campaign_id','')::uuid;
  if campaign_id is not null and not exists(select 1 from public.marketing_campaigns c where c.id=campaign_id and c.organization_id=existing.organization_id) then raise exception using errcode='42501',message='MARKETING_ACCESS_DENIED'; end if;
  update public.leads set utm_source=public.normalize_attribution_value(target_payload->>'source'),utm_medium=public.normalize_attribution_value(target_payload->>'medium'),utm_campaign=public.normalize_attribution_value(target_payload->>'campaign'),utm_content=public.normalize_attribution_value(target_payload->>'content'),utm_term=public.normalize_attribution_value(target_payload->>'term'),landing_page=public.normalize_landing_page(target_payload->>'landing_page'),marketing_campaign_id=campaign_id where id=existing.id returning * into saved;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(existing.organization_id,auth.uid(),'lead',existing.id,'marketing_attribution_updated',jsonb_build_object('source',saved.utm_source,'campaign_id',campaign_id));
  return saved;
end $$;

create or replace function public.capture_site_lead_attributed(
  target_organization uuid,target_name text,target_phone text,target_email text,
  target_property_code text,target_property_title text,target_source text,target_medium text,
  target_campaign text,target_content text,target_term text,target_landing_page text
)
returns table(lead_id uuid,created boolean) language plpgsql volatile security definer set search_path='' as $$
declare captured record; campaign_id uuid; normalized_source text:=public.normalize_attribution_value(target_source); normalized_campaign text:=public.normalize_attribution_value(target_campaign);
begin
  select * into captured from public.capture_site_lead(target_organization,target_name,target_phone,target_email,target_property_code,target_property_title);
  if captured.lead_id is null then return; end if;
  select c.id into campaign_id from public.marketing_campaigns c
    where c.organization_id=target_organization and c.status='active'
      and c.source is not distinct from normalized_source
      and (normalized_campaign is null or c.campaign is not distinct from normalized_campaign)
    order by c.created_at desc limit 1;
  update public.leads set
    utm_source=coalesce(normalized_source,utm_source),
    utm_medium=coalesce(public.normalize_attribution_value(target_medium),utm_medium),
    utm_campaign=coalesce(normalized_campaign,utm_campaign),
    utm_content=coalesce(public.normalize_attribution_value(target_content),utm_content),
    utm_term=coalesce(public.normalize_attribution_value(target_term),utm_term),
    landing_page=coalesce(public.normalize_landing_page(target_landing_page),landing_page),
    marketing_campaign_id=coalesce(campaign_id,marketing_campaign_id)
  where id=captured.lead_id and organization_id=target_organization;
  return query select captured.lead_id,captured.created;
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
  where c.organization_id=target_organization and public.current_membership_role(target_organization) in ('owner','manager') order by c.created_at desc
$$;

revoke all on function public.save_property_owner(uuid,uuid,jsonb),public.save_property_acquisition(uuid,uuid,jsonb),public.save_acquisition_activity(uuid,uuid,jsonb),public.convert_acquisition_to_property(uuid,jsonb),public.save_marketing_campaign(uuid,uuid,jsonb),public.attribute_lead_marketing(uuid,jsonb),public.get_marketing_roi(uuid),public.normalize_attribution_value(text),public.normalize_landing_page(text) from public,anon,authenticated;
grant execute on function public.save_property_owner(uuid,uuid,jsonb),public.save_property_acquisition(uuid,uuid,jsonb),public.save_acquisition_activity(uuid,uuid,jsonb),public.convert_acquisition_to_property(uuid,jsonb),public.save_marketing_campaign(uuid,uuid,jsonb),public.attribute_lead_marketing(uuid,jsonb),public.get_marketing_roi(uuid) to authenticated;
revoke all on function public.capture_site_lead_attributed(uuid,text,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.capture_site_lead_attributed(uuid,text,text,text,text,text,text,text,text,text,text,text) to service_role;
revoke all on function public.validate_capture_owner() from public,anon,authenticated;

commit;

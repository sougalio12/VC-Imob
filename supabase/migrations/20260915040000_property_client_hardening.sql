begin;

alter table public.client_feedback
  add column if not exists is_favorite boolean not null default false;

-- Favoritar e reagir são sinais independentes. Um favorito não deve criar uma
-- reação "talvez" artificial apenas para satisfazer o modelo anterior.
alter table public.client_feedback alter column reaction drop not null;

alter table public.client_selections
  add constraint client_selections_expiry_window_check
  check (expires_at > created_at and expires_at <= created_at + interval '90 days');

alter table public.post_visit_feedback
  add constraint post_visit_feedback_lengths_check check (
    cardinality(objections) <= 20
    and (positive_points is null or char_length(positive_points) <= 2000)
    and (decision_timeframe is null or char_length(decision_timeframe) <= 200)
    and (next_step is null or char_length(next_step) <= 1000)
  );

create or replace function public.create_client_selection(
  target_organization uuid,target_lead uuid,target_title text,target_note text,
  target_property_ids uuid[],target_expires_at timestamptz default null
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  selection_id uuid;
  raw_token text:=encode(extensions.gen_random_bytes(32),'hex');
  item_id uuid;
  position smallint:=0;
  effective_expiry timestamptz:=coalesce(target_expires_at,now()+interval '30 days');
begin
  if not public.can_access_lead(target_lead,target_organization) then
    raise exception using errcode='42501',message='Lead access denied';
  end if;
  if nullif(trim(target_title),'') is null or char_length(trim(target_title))>120 then
    raise exception using errcode='22023',message='Invalid selection title';
  end if;
  if char_length(coalesce(target_note,''))>2000
    or effective_expiry<=now() or effective_expiry>now()+interval '90 days' then
    raise exception using errcode='22023',message='Invalid selection details';
  end if;
  if coalesce(array_length(target_property_ids,1),0) not between 1 and 20
    or cardinality(target_property_ids)<>cardinality(array(select distinct value from unnest(target_property_ids) value)) then
    raise exception using errcode='22023',message='Select between 1 and 20 unique properties';
  end if;
  if exists(select 1 from unnest(target_property_ids) p(id)
    left join public.properties x on x.id=p.id and x.organization_id=target_organization and x.is_published
    where x.id is null) then
    raise exception using errcode='42501',message='Invalid property selection';
  end if;
  insert into public.client_selections(organization_id,lead_id,title,note,token_hash,created_by,expires_at)
  values(target_organization,target_lead,trim(target_title),nullif(trim(target_note),''),
    encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),effective_expiry)
  returning id into selection_id;
  foreach item_id in array target_property_ids loop
    insert into public.client_selection_items(selection_id,property_id,sort_order)
    values(selection_id,item_id,position);
    position:=position+1;
  end loop;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
  values(target_organization,auth.uid(),'client_selection',selection_id,'selection_created',
    jsonb_build_object('lead_id',target_lead,'property_count',position));
  return jsonb_build_object('id',selection_id,'token',raw_token,'expires_at',effective_expiry);
end $$;

create or replace function public.save_crm_property_with_media(
  target_organization uuid,
  target_property uuid,
  target_expected_updated_at timestamptz,
  target_payload jsonb,
  target_media jsonb
)
returns public.properties
language plpgsql volatile security definer set search_path=''
as $$
declare saved public.properties; publish_requested boolean;
begin
  if jsonb_typeof(coalesce(target_media,'null'::jsonb)) <> 'array' then
    raise exception using errcode='22023',message='CRM_INVALID_PROPERTY_MEDIA';
  end if;
  publish_requested := coalesce((target_payload->>'is_published')::boolean,false);
  if publish_requested and (
    nullif(trim(target_payload->>'title'),'') is null
    or coalesce(target_payload->>'code','') !~ '^VCI[0-9]{6}$'
    or coalesce(nullif(target_payload->>'price','')::numeric,0) <= 0
    or nullif(trim(target_payload->>'city'),'') is null
    or coalesce(target_payload->>'status','') not in ('available','reserved')
    or jsonb_array_length(target_media) = 0
  ) then raise exception using errcode='22023',message='CRM_PROPERTY_PUBLICATION_INCOMPLETE'; end if;
  select * into saved from public.save_crm_property(target_organization,target_property,target_expected_updated_at,target_payload);
  perform public.replace_property_media(saved.id,target_media);
  return saved;
end $$;

create function public.set_client_favorite(selection_token text,target_property uuid,target_favorite boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare selection_row public.client_selections;
begin
  select * into selection_row from public.client_selections
  where token_hash=encode(extensions.digest(selection_token,'sha256'),'hex')
    and revoked_at is null and expires_at>now();
  if selection_row.id is null or not exists(
    select 1 from public.client_selection_items
    where selection_id=selection_row.id and property_id=target_property
  ) then raise exception using errcode='22023',message='Invalid selection favorite'; end if;
  insert into public.client_feedback(organization_id,selection_id,property_id,reaction,is_favorite)
  values(selection_row.organization_id,selection_row.id,target_property,null,coalesce(target_favorite,false))
  on conflict(selection_id,property_id) do update
    set is_favorite=excluded.is_favorite,updated_at=now();
end $$;

revoke all on function public.set_client_favorite(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_client_favorite(text,uuid,boolean) to anon,authenticated;
revoke all on function public.create_client_selection(uuid,uuid,text,text,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.create_client_selection(uuid,uuid,text,text,uuid[],timestamptz) to authenticated;
revoke all on function public.save_crm_property_with_media(uuid,uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_crm_property_with_media(uuid,uuid,timestamptz,jsonb,jsonb) to authenticated;

commit;

-- Rodada master pos-beta: mutacoes atomicas e tenant-safe para os dois CRUDs
-- criticos observados no beta. Esta migration e somente aditiva: os grants por
-- coluna e as policies existentes continuam sendo a segunda linha de defesa.
begin;

create or replace function public.normalize_crm_phone(target_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare normalized text := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
begin
  if normalized = '' then return null; end if;
  if char_length(normalized) in (12, 13) and left(normalized, 2) = '55' then
    normalized := substr(normalized, 3);
  end if;
  if char_length(normalized) not in (10, 11) then
    raise exception using errcode = '22023', message = 'CRM_INVALID_PHONE';
  end if;
  return normalized;
end
$$;

create or replace function public.save_crm_property(
  target_organization uuid,
  target_property uuid,
  target_expected_updated_at timestamptz,
  target_payload jsonb
)
returns public.properties
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  role_name text;
  existing public.properties;
  candidate public.properties;
  saved public.properties;
  unexpected_key text;
begin
  role_name := public.current_membership_role(target_organization);
  if role_name not in ('owner', 'manager') then
    raise exception using errcode = '42501', message = 'CRM_PROPERTY_ACCESS_DENIED';
  end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'CRM_INVALID_PROPERTY';
  end if;

  select key into unexpected_key
  from jsonb_object_keys(target_payload) as payload_key(key)
  where not (key = any (array[
    'code','title','slug','purpose','property_type','description','price','city','state',
    'neighborhood','public_address','total_area','total_area_unit','built_area','bedrooms',
    'suites','bathrooms','parking_spaces','features','status','is_published','featured',
    'video_url','publication_date','broker_name','broker_creci','disclosure'
  ]::text[]))
  limit 1;
  if unexpected_key is not null then
    raise exception using errcode = '22023', message = 'CRM_INVALID_PROPERTY_FIELD';
  end if;

  if target_property is null then
    candidate := jsonb_populate_record(null::public.properties, target_payload);
    candidate.code := upper(trim(candidate.code));
    candidate.title := trim(candidate.title);
    candidate.slug := trim(candidate.slug);
    candidate.purpose := coalesce(candidate.purpose, 'venda');
    candidate.total_area_unit := coalesce(nullif(trim(candidate.total_area_unit), ''), 'm²');
    candidate.features := coalesce(candidate.features, '{}'::text[]);
    candidate.status := coalesce(candidate.status, 'draft');
    candidate.is_published := coalesce(candidate.is_published, false);
    candidate.featured := coalesce(candidate.featured, false);

    if candidate.code is null or candidate.code !~ '^VCI[0-9]{6}$'
      or nullif(candidate.title, '') is null or nullif(candidate.slug, '') is null then
      raise exception using errcode = '22023', message = 'CRM_INVALID_PROPERTY';
    end if;

    insert into public.properties(
      organization_id, code, title, slug, purpose, property_type, description, price,
      city, state, neighborhood, public_address, total_area, total_area_unit, built_area,
      bedrooms, suites, bathrooms, parking_spaces, features, status, is_published,
      featured, video_url, publication_date, broker_name, broker_creci, disclosure,
      created_by, updated_by
    ) values (
      target_organization, candidate.code, candidate.title, candidate.slug, candidate.purpose,
      candidate.property_type, candidate.description, candidate.price, candidate.city,
      candidate.state, candidate.neighborhood, candidate.public_address, candidate.total_area,
      candidate.total_area_unit, candidate.built_area, candidate.bedrooms, candidate.suites,
      candidate.bathrooms, candidate.parking_spaces, candidate.features, candidate.status,
      candidate.is_published, candidate.featured, candidate.video_url,
      candidate.publication_date, candidate.broker_name, candidate.broker_creci,
      coalesce(candidate.disclosure, '{}'::jsonb), auth.uid(), auth.uid()
    ) returning * into saved;
    return saved;
  end if;

  select p.* into existing
  from public.properties as p
  where p.id = target_property and p.organization_id = target_organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CRM_PROPERTY_ACCESS_DENIED';
  end if;
  if target_expected_updated_at is not null
    and date_trunc('milliseconds', existing.updated_at)
      is distinct from date_trunc('milliseconds', target_expected_updated_at) then
    raise exception using errcode = '40001', message = 'CRM_PROPERTY_CONFLICT';
  end if;

  candidate := jsonb_populate_record(existing, target_payload);
  candidate.code := upper(trim(candidate.code));
  candidate.title := trim(candidate.title);
  candidate.slug := trim(candidate.slug);
  candidate.total_area_unit := coalesce(nullif(trim(candidate.total_area_unit), ''), 'm²');
  candidate.features := coalesce(candidate.features, '{}'::text[]);
  if candidate.code is null or candidate.code !~ '^VCI[0-9]{6}$'
    or nullif(candidate.title, '') is null or nullif(candidate.slug, '') is null then
    raise exception using errcode = '22023', message = 'CRM_INVALID_PROPERTY';
  end if;

  update public.properties set
    code = candidate.code,
    title = candidate.title,
    slug = candidate.slug,
    purpose = candidate.purpose,
    property_type = candidate.property_type,
    description = candidate.description,
    price = candidate.price,
    city = candidate.city,
    state = candidate.state,
    neighborhood = candidate.neighborhood,
    public_address = candidate.public_address,
    total_area = candidate.total_area,
    total_area_unit = candidate.total_area_unit,
    built_area = candidate.built_area,
    bedrooms = candidate.bedrooms,
    suites = candidate.suites,
    bathrooms = candidate.bathrooms,
    parking_spaces = candidate.parking_spaces,
    features = candidate.features,
    status = candidate.status,
    is_published = candidate.is_published,
    featured = candidate.featured,
    video_url = candidate.video_url,
    publication_date = candidate.publication_date,
    broker_name = candidate.broker_name,
    broker_creci = candidate.broker_creci,
    disclosure = coalesce(candidate.disclosure, '{}'::jsonb),
    updated_by = auth.uid()
  where id = existing.id
  returning * into saved;
  return saved;
end
$$;

create or replace function public.save_crm_lead(
  target_organization uuid,
  target_lead uuid,
  target_expected_updated_at timestamptz,
  target_payload jsonb
)
returns public.leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  role_name text;
  existing public.leads;
  candidate public.leads;
  saved public.leads;
  unexpected_key text;
begin
  role_name := public.current_membership_role(target_organization);
  if role_name not in ('owner', 'manager', 'agent') then
    raise exception using errcode = '42501', message = 'CRM_LEAD_ACCESS_DENIED';
  end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'CRM_INVALID_LEAD';
  end if;

  select key into unexpected_key
  from jsonb_object_keys(target_payload) as payload_key(key)
  where not (key = any (array[
    'name','phone','whatsapp','email','origin','responsible_name','property_code',
    'property_title','budget','desired_region','notes','stage','entered_at',
    'next_follow_up','visit_date','preference_purpose','preference_property_type',
    'preference_city','preference_min_price','preference_max_price',
    'preference_min_bedrooms','preference_min_area','preference_max_area',
    'preference_min_suites','preference_min_bathrooms','preference_min_parking',
    'preference_features','preference_notes'
  ]::text[]))
  limit 1;
  if unexpected_key is not null then
    raise exception using errcode = '22023', message = 'CRM_INVALID_LEAD_FIELD';
  end if;

  if target_lead is null then
    candidate := jsonb_populate_record(null::public.leads, target_payload);
    candidate.name := trim(candidate.name);
    candidate.phone := public.normalize_crm_phone(candidate.phone);
    candidate.whatsapp := public.normalize_crm_phone(candidate.whatsapp);
    candidate.origin := coalesce(nullif(trim(candidate.origin), ''), 'manual');
    candidate.stage := coalesce(candidate.stage, 'novo');
    candidate.entered_at := coalesce(candidate.entered_at, now());
    candidate.preference_features := coalesce(candidate.preference_features, '{}'::text[]);
    if nullif(candidate.name, '') is null or (candidate.phone is null and candidate.whatsapp is null)
      or (candidate.email is not null and candidate.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception using errcode = '22023', message = 'CRM_INVALID_LEAD';
    end if;

    insert into public.leads(
      organization_id, assigned_to, name, phone, whatsapp, email, origin, responsible_name,
      property_code, property_title, budget, desired_region, notes, stage, entered_at,
      next_follow_up, visit_date, preference_purpose, preference_property_type,
      preference_city, preference_min_price, preference_max_price, preference_min_bedrooms,
      preference_min_area, preference_max_area, preference_min_suites,
      preference_min_bathrooms, preference_min_parking, preference_features, preference_notes
    ) values (
      target_organization, auth.uid(), candidate.name, candidate.phone, candidate.whatsapp,
      nullif(trim(candidate.email), ''), candidate.origin, nullif(trim(candidate.responsible_name), ''),
      nullif(trim(candidate.property_code), ''), nullif(trim(candidate.property_title), ''),
      nullif(trim(candidate.budget), ''), nullif(trim(candidate.desired_region), ''),
      nullif(trim(candidate.notes), ''), candidate.stage, candidate.entered_at,
      candidate.next_follow_up, candidate.visit_date, nullif(trim(candidate.preference_purpose), ''),
      nullif(trim(candidate.preference_property_type), ''), nullif(trim(candidate.preference_city), ''),
      candidate.preference_min_price, candidate.preference_max_price,
      candidate.preference_min_bedrooms, candidate.preference_min_area,
      candidate.preference_max_area, candidate.preference_min_suites,
      candidate.preference_min_bathrooms, candidate.preference_min_parking,
      candidate.preference_features, nullif(trim(candidate.preference_notes), '')
    ) returning * into saved;
    return saved;
  end if;

  select l.* into existing
  from public.leads as l
  where l.id = target_lead and l.organization_id = target_organization
  for update;
  if not found or not coalesce(public.can_access_lead(existing.id, target_organization), false) then
    raise exception using errcode = '42501', message = 'CRM_LEAD_ACCESS_DENIED';
  end if;
  if target_expected_updated_at is not null
    and date_trunc('milliseconds', existing.updated_at)
      is distinct from date_trunc('milliseconds', target_expected_updated_at) then
    raise exception using errcode = '40001', message = 'CRM_LEAD_CONFLICT';
  end if;

  -- entered_at is deliberately immutable after creation even if a stale client sends it.
  candidate := jsonb_populate_record(existing, target_payload - 'entered_at');
  candidate.name := trim(candidate.name);
  candidate.phone := public.normalize_crm_phone(candidate.phone);
  candidate.whatsapp := public.normalize_crm_phone(candidate.whatsapp);
  candidate.origin := coalesce(nullif(trim(candidate.origin), ''), 'manual');
  candidate.preference_features := coalesce(candidate.preference_features, '{}'::text[]);
  if nullif(candidate.name, '') is null or (candidate.phone is null and candidate.whatsapp is null)
    or (candidate.email is not null and candidate.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception using errcode = '22023', message = 'CRM_INVALID_LEAD';
  end if;

  update public.leads set
    name = candidate.name,
    phone = candidate.phone,
    whatsapp = candidate.whatsapp,
    email = nullif(trim(candidate.email), ''),
    origin = candidate.origin,
    responsible_name = nullif(trim(candidate.responsible_name), ''),
    property_code = nullif(trim(candidate.property_code), ''),
    property_title = nullif(trim(candidate.property_title), ''),
    budget = nullif(trim(candidate.budget), ''),
    desired_region = nullif(trim(candidate.desired_region), ''),
    notes = nullif(trim(candidate.notes), ''),
    stage = candidate.stage,
    next_follow_up = candidate.next_follow_up,
    visit_date = candidate.visit_date,
    preference_purpose = nullif(trim(candidate.preference_purpose), ''),
    preference_property_type = nullif(trim(candidate.preference_property_type), ''),
    preference_city = nullif(trim(candidate.preference_city), ''),
    preference_min_price = candidate.preference_min_price,
    preference_max_price = candidate.preference_max_price,
    preference_min_bedrooms = candidate.preference_min_bedrooms,
    preference_min_area = candidate.preference_min_area,
    preference_max_area = candidate.preference_max_area,
    preference_min_suites = candidate.preference_min_suites,
    preference_min_bathrooms = candidate.preference_min_bathrooms,
    preference_min_parking = candidate.preference_min_parking,
    preference_features = candidate.preference_features,
    preference_notes = nullif(trim(candidate.preference_notes), '')
  where id = existing.id
  returning * into saved;
  return saved;
end
$$;

revoke all on function public.normalize_crm_phone(text) from public, anon, authenticated;
revoke all on function public.save_crm_property(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.save_crm_lead(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_crm_property(uuid, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.save_crm_lead(uuid, uuid, timestamptz, jsonb) to authenticated;

comment on function public.save_crm_property(uuid, uuid, timestamptz, jsonb) is
  'Mutacao atomica de imovel: organization_id e identidade do ator sao derivados e nunca alteraveis pelo payload.';
comment on function public.save_crm_lead(uuid, uuid, timestamptz, jsonb) is
  'Mutacao atomica de lead/preferencias com whitelist, normalizacao de telefone, concorrencia e autorizacao tenant-safe.';
commit;

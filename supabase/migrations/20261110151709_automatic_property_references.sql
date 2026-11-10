-- Referencias automaticas, atomicas e independentes por organizacao/categoria.
-- A tabela de contadores e o gatilho sao aditivos. Codigos VCI existentes nao
-- sao reescritos e continuam validos; o codigo de um imovel salvo e imutavel.
begin;

create table public.property_reference_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('CA','TE','AP','CO','CH','OT')),
  last_number bigint not null default 0 check (last_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, category)
);

alter table public.property_reference_counters enable row level security;
alter table public.property_reference_counters force row level security;
revoke all on public.property_reference_counters from public, anon, authenticated;

create or replace function public.property_reference_category(target_property_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(trim(coalesce(target_property_type,''))) = 'casa' then 'CA'
    when lower(trim(coalesce(target_property_type,''))) = 'terreno' then 'TE'
    when lower(trim(coalesce(target_property_type,''))) = 'apartamento' then 'AP'
    when lower(trim(coalesce(target_property_type,''))) in ('comercial','imóvel comercial','imovel comercial','sala comercial') then 'CO'
    when lower(trim(coalesce(target_property_type,''))) in ('chácara','chacara') then 'CH'
    else 'OT'
  end
$$;

-- Inicializa os contadores caso ja existam referencias da nova familia. Os VCI
-- deliberadamente nao participam desta numeracao e permanecem intocados.
insert into public.property_reference_counters(organization_id, category, last_number)
select
  p.organization_id,
  left(p.code, 2),
  max(substring(p.code from 3)::bigint)
from public.properties p
where p.code ~ '^(CA|TE|AP|CO|CH|OT)[0-9]{4,}$'
group by p.organization_id, left(p.code, 2)
on conflict (organization_id, category) do update
set last_number = greatest(public.property_reference_counters.last_number, excluded.last_number),
    updated_at = now();

alter table public.properties drop constraint if exists properties_code_check;
alter table public.properties add constraint properties_code_check
  check (code ~ '^(VCI[0-9]{6}|(CA|TE|AP|CO|CH|OT)[0-9]{4,})$') not valid;
alter table public.properties validate constraint properties_code_check;

create or replace function public.assign_property_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prefix text;
  issued_number bigint;
begin
  if nullif(trim(new.code), '') is not null then
    new.code := upper(trim(new.code));
    if new.code ~ '^(CA|TE|AP|CO|CH|OT)[0-9]{4,}$' then
      raise exception using errcode='22023', message='CRM_MANUAL_PROPERTY_REFERENCE_DENIED';
    end if;
    -- Outros formatos seguem para a constraint historica da coluna, mantendo
    -- o SQLSTATE 23514 esperado pelas integracoes legadas.
    return new;
  end if;

  if nullif(trim(new.property_type), '') is null then
    raise exception using errcode='22023', message='CRM_PROPERTY_TYPE_REQUIRED';
  end if;

  prefix := public.property_reference_category(new.property_type);
  insert into public.property_reference_counters(organization_id, category, last_number)
  values(new.organization_id, prefix, 1)
  on conflict (organization_id, category) do update
    set last_number = public.property_reference_counters.last_number + 1,
        updated_at = now()
  returning last_number into issued_number;

  new.code := prefix || lpad(issued_number::text, 4, '0');
  return new;
end
$$;

create trigger properties_assign_reference
before insert on public.properties
for each row execute function public.assign_property_reference();

create or replace function public.keep_property_reference_stable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception using errcode='22023', message='CRM_PROPERTY_REFERENCE_IMMUTABLE';
  end if;
  return new;
end
$$;

create trigger properties_keep_reference_stable
before update of code on public.properties
for each row execute function public.keep_property_reference_stable();

create or replace function public.preview_next_property_reference(
  target_organization uuid,
  target_property_type text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  role_name text;
  prefix text;
  next_number bigint;
begin
  role_name := public.current_membership_role(target_organization);
  if role_name not in ('owner','manager') then
    raise exception using errcode='42501', message='CRM_PROPERTY_ACCESS_DENIED';
  end if;
  if nullif(trim(target_property_type), '') is null then return null; end if;
  prefix := public.property_reference_category(target_property_type);
  select coalesce(c.last_number, 0) + 1 into next_number
  from (select 1) seed
  left join public.property_reference_counters c
    on c.organization_id = target_organization and c.category = prefix;
  return prefix || lpad(next_number::text, 4, '0');
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
    candidate.code := nullif(upper(trim(candidate.code)), '');
    candidate.title := trim(candidate.title);
    candidate.slug := trim(candidate.slug);
    candidate.property_type := nullif(trim(candidate.property_type), '');
    candidate.purpose := coalesce(candidate.purpose, 'venda');
    candidate.total_area_unit := coalesce(nullif(trim(candidate.total_area_unit), ''), 'm²');
    candidate.features := coalesce(candidate.features, '{}'::text[]);
    candidate.status := coalesce(candidate.status, 'draft');
    candidate.is_published := coalesce(candidate.is_published, false);
    candidate.featured := coalesce(candidate.featured, false);

    if (candidate.code is not null and candidate.code !~ '^VCI[0-9]{6}$')
      or nullif(candidate.title, '') is null or nullif(candidate.slug, '') is null
      or (candidate.code is null and candidate.property_type is null) then
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

  select p.* into existing from public.properties p
  where p.id = target_property and p.organization_id = target_organization
  for update;
  if not found then raise exception using errcode='42501', message='CRM_PROPERTY_ACCESS_DENIED'; end if;
  if target_expected_updated_at is not null
    and date_trunc('milliseconds', existing.updated_at) is distinct from date_trunc('milliseconds', target_expected_updated_at) then
    raise exception using errcode='40001', message='CRM_PROPERTY_CONFLICT';
  end if;

  candidate := jsonb_populate_record(existing, target_payload);
  candidate.code := existing.code;
  candidate.title := trim(candidate.title);
  candidate.slug := trim(candidate.slug);
  candidate.property_type := nullif(trim(candidate.property_type), '');
  candidate.total_area_unit := coalesce(nullif(trim(candidate.total_area_unit), ''), 'm²');
  candidate.features := coalesce(candidate.features, '{}'::text[]);
  if nullif(candidate.title, '') is null or nullif(candidate.slug, '') is null then
    raise exception using errcode='22023', message='CRM_INVALID_PROPERTY';
  end if;

  update public.properties set
    title=candidate.title, slug=candidate.slug, purpose=candidate.purpose,
    property_type=candidate.property_type, description=candidate.description, price=candidate.price,
    city=candidate.city, state=candidate.state, neighborhood=candidate.neighborhood,
    public_address=candidate.public_address, total_area=candidate.total_area,
    total_area_unit=candidate.total_area_unit, built_area=candidate.built_area,
    bedrooms=candidate.bedrooms, suites=candidate.suites, bathrooms=candidate.bathrooms,
    parking_spaces=candidate.parking_spaces, features=candidate.features, status=candidate.status,
    is_published=candidate.is_published, featured=candidate.featured, video_url=candidate.video_url,
    publication_date=candidate.publication_date, broker_name=candidate.broker_name,
    broker_creci=candidate.broker_creci, disclosure=coalesce(candidate.disclosure,'{}'::jsonb),
    updated_by=auth.uid()
  where id=existing.id
  returning * into saved;
  return saved;
end
$$;

-- A validacao de publicacao aceita tanto o legado VCI quanto as novas familias.
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
    or (target_property is not null and coalesce(target_payload->>'code','') !~ '^(VCI[0-9]{6}|(CA|TE|AP|CO|CH|OT)[0-9]{4,})$')
    or (target_property is null and nullif(trim(target_payload->>'property_type'),'') is null)
    or coalesce(nullif(target_payload->>'price','')::numeric,0) <= 0
    or nullif(trim(target_payload->>'city'),'') is null
    or coalesce(target_payload->>'status','') not in ('available','reserved')
    or jsonb_array_length(target_media) = 0
  ) then raise exception using errcode='22023',message='CRM_PROPERTY_PUBLICATION_INCOMPLETE'; end if;
  select * into saved from public.save_crm_property(target_organization,target_property,target_expected_updated_at,target_payload);
  perform public.replace_property_media(saved.id,target_media);
  return saved;
end
$$;

revoke all on function public.property_reference_category(text), public.assign_property_reference(),
  public.keep_property_reference_stable(), public.preview_next_property_reference(uuid,text),
  public.save_crm_property(uuid,uuid,timestamptz,jsonb),
  public.save_crm_property_with_media(uuid,uuid,timestamptz,jsonb,jsonb)
from public, anon, authenticated;
grant execute on function public.preview_next_property_reference(uuid,text),
  public.save_crm_property(uuid,uuid,timestamptz,jsonb),
  public.save_crm_property_with_media(uuid,uuid,timestamptz,jsonb,jsonb)
to authenticated;

commit;

-- Execute manualmente no SQL Editor do Supabase antes de publicar a nova versão da Edge Function site-lead.
-- Centraliza a deduplicação no banco para evitar duplicatas em requisições simultâneas.
-- A função é privada: somente service_role, dentro da Edge Function, pode executá-la.

create or replace function public.capture_site_lead(
  target_organization uuid,
  target_name text,
  target_phone text,
  target_email text,
  target_property_code text,
  target_property_title text
)
returns table (lead_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_lead public.leads%rowtype;
  new_lead_id uuid;
  normalized_phone text := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  if target_organization is null
    or char_length(trim(coalesce(target_name, ''))) < 2
    or char_length(normalized_phone) < 8
    or char_length(trim(coalesce(target_property_code, ''))) = 0
    or char_length(trim(coalesce(target_property_title, ''))) = 0 then
    raise exception 'Invalid site lead payload';
  end if;

  -- Serializa capturas por cada identificador para evitar duplicatas concorrentes.
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization::text || ':phone:' || normalized_phone,
    0
  ));
  if normalized_email <> '' then
    perform pg_advisory_xact_lock(hashtextextended(
      target_organization::text || ':email:' || normalized_email,
      0
    ));
  end if;

  select leads.*
  into matched_lead
  from public.leads
  where leads.organization_id = target_organization
    and leads.stage in ('novo', 'atendimento', 'visita', 'negociacao')
    and (
      regexp_replace(coalesce(nullif(trim(leads.phone), ''), leads.whatsapp, ''), '\D', '', 'g') = normalized_phone
      or (
        normalized_email <> ''
        and lower(trim(coalesce(leads.email, ''))) = normalized_email
      )
    )
  order by
    case
      when regexp_replace(coalesce(nullif(trim(leads.phone), ''), leads.whatsapp, ''), '\D', '', 'g') = normalized_phone then 0
      else 1
    end,
    leads.updated_at desc
  limit 1
  for update;

  if found then
    insert into public.lead_notes (organization_id, lead_id, content)
    values (
      target_organization,
      matched_lead.id,
      case
        when coalesce(nullif(trim(matched_lead.property_code), ''), '') <> target_property_code then
          format(
          'Novo interesse recebido pelo site: %s — %s. Interesse anterior: %s — %s.',
          target_property_code,
          target_property_title,
          coalesce(nullif(trim(matched_lead.property_code), ''), 'não informado'),
          coalesce(nullif(trim(matched_lead.property_title), ''), 'não informado')
          )
        else
          format(
            'Novo interesse recebido pelo site no imóvel: %s — %s.',
            target_property_code,
            target_property_title
          )
      end || format(
        ' Origem: site. Data/hora: %s.',
        to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY HH24:MI')
      )
    );

    update public.leads
    set
      email = coalesce(nullif(trim(email), ''), nullif(normalized_email, '')),
      phone = coalesce(nullif(trim(phone), ''), normalized_phone),
      whatsapp = coalesce(nullif(trim(whatsapp), ''), normalized_phone),
      property_code = target_property_code,
      property_title = target_property_title
    where id = matched_lead.id;

    return query select matched_lead.id, false;
    return;
  end if;

  insert into public.leads (
    organization_id,
    name,
    phone,
    whatsapp,
    email,
    origin,
    property_code,
    property_title,
    notes,
    stage,
    entered_at
  )
  values (
    target_organization,
    trim(target_name),
    normalized_phone,
    normalized_phone,
    nullif(normalized_email, ''),
    'site',
    target_property_code,
    target_property_title,
    'Lead recebido pelo site público.',
    'novo',
    now()
  )
  returning id into new_lead_id;

  return query select new_lead_id, true;
end;
$$;

revoke all on function public.capture_site_lead(uuid, text, text, text, text, text) from public;
grant execute on function public.capture_site_lead(uuid, text, text, text, text, text) to service_role;

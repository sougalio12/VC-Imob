-- Salva dados do imovel e ordenacao/capa da midia na mesma transacao.
-- Migration aditiva separada porque 20260913120000 ja foi aplicada em producao.
begin;

create or replace function public.save_crm_property_with_media(
  target_organization uuid,
  target_property uuid,
  target_expected_updated_at timestamptz,
  target_payload jsonb,
  target_media jsonb
)
returns public.properties
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare saved public.properties;
begin
  select * into saved
  from public.save_crm_property(
    target_organization,
    target_property,
    target_expected_updated_at,
    target_payload
  );
  perform public.replace_property_media(saved.id, coalesce(target_media, '[]'::jsonb));
  return saved;
end
$$;

revoke all on function public.save_crm_property_with_media(uuid, uuid, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_crm_property_with_media(uuid, uuid, timestamptz, jsonb, jsonb)
  to authenticated;

comment on function public.save_crm_property_with_media(uuid, uuid, timestamptz, jsonb, jsonb) is
  'Salva imovel e ordenacao de midia na mesma transacao, evitando estado parcial.';

commit;

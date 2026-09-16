-- VC Imob - gerador controlado de documentos imobiliarios.
-- Templates e versoes sao imutaveis para o cliente; conteudo privado nunca e publico.
begin;

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  document_type text not null check (document_type in ('sale_intermediation','property_sale_purchase')),
  version integer not null check (version > 0),
  name text not null,
  status text not null default 'active' check (status in ('active','retired','legal_review_required')),
  effective_at date not null,
  legal_reviewed_at date not null,
  legal_sources jsonb not null check (jsonb_typeof(legal_sources) = 'array'),
  field_schema jsonb not null check (jsonb_typeof(field_schema) = 'array'),
  clause_schema jsonb not null check (jsonb_typeof(clause_schema) = 'array'),
  created_at timestamptz not null default now(),
  unique (template_code, version)
);

create table public.real_estate_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check (document_type in ('sale_intermediation','property_sale_purchase')),
  property_id uuid references public.properties(id) on delete set null,
  owner_id uuid references public.property_owners(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  responsible_user_id uuid not null references public.profiles(id) on delete restrict,
  current_version integer not null default 0 check (current_version >= 0),
  status text not null default 'draft' check (status in ('draft','review','finalized','canceled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  canceled_at timestamptz,
  check ((status = 'finalized') = (finalized_at is not null)),
  check ((status = 'canceled') = (canceled_at is not null))
);

create table public.real_estate_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.real_estate_documents(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  template_id uuid not null references public.document_templates(id) on delete restrict,
  template_code text not null,
  template_version integer not null check (template_version > 0),
  data_snapshot jsonb not null check (jsonb_typeof(data_snapshot) = 'object'),
  rendered_content text not null,
  missing_fields text[] not null default '{}',
  optional_fields text[] not null default '{}',
  changes_summary text,
  status text not null default 'draft' check (status in ('draft','review','finalized','canceled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (document_id, version_no),
  check (changes_summary is null or char_length(changes_summary) <= 500),
  check ((status = 'finalized') = (finalized_at is not null))
);

create table public.real_estate_document_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete restrict,
  document_id uuid references public.real_estate_documents(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  missing_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index document_templates_active_idx on public.document_templates(template_code, version desc) where status='active';
create index real_estate_documents_org_idx on public.real_estate_documents(organization_id, updated_at desc);
create index real_estate_documents_property_idx on public.real_estate_documents(organization_id, property_id, updated_at desc);
create index real_estate_documents_owner_idx on public.real_estate_documents(organization_id, owner_id, updated_at desc);
create index real_estate_documents_lead_idx on public.real_estate_documents(organization_id, lead_id, updated_at desc);
create index real_estate_document_versions_history_idx on public.real_estate_document_versions(document_id, version_no desc);
create index real_estate_document_previews_expiry_idx on public.real_estate_document_previews(actor_id, expires_at) where consumed_at is null;

alter table public.document_templates enable row level security;
alter table public.document_templates force row level security;
alter table public.real_estate_documents enable row level security;
alter table public.real_estate_documents force row level security;
alter table public.real_estate_document_versions enable row level security;
alter table public.real_estate_document_versions force row level security;
alter table public.real_estate_document_previews enable row level security;
alter table public.real_estate_document_previews force row level security;

insert into public.document_templates(template_code,document_type,version,name,status,effective_at,legal_reviewed_at,legal_sources,field_schema,clause_schema)
values
('sale_intermediation','sale_intermediation',1,'Autorizacao / Contrato de Intermediacao para Venda','active','2026-09-17','2026-09-16',
 jsonb_build_array(
  jsonb_build_object('title','Lei 6.530/1978','url','https://www.planalto.gov.br/ccivil_03/leis/l6530.htm'),
  jsonb_build_object('title','Decreto 81.871/1978','url','https://www.planalto.gov.br/ccivil_03/decreto/antigos/d81871.htm'),
  jsonb_build_object('title','Codigo Civil - arts. 722 a 729','url','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm'),
  jsonb_build_object('title','Resolucao COFECI 1.504/2023 e Contrato-Padrao','url','https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_1504_2023.pdf'),
  jsonb_build_object('title','LGPD - Lei 13.709/2018','url','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm')
 ),
 jsonb_build_array(
  jsonb_build_object('key','seller_name','label','Proprietario / contratante','required',true),
  jsonb_build_object('key','broker_name','label','Corretor / contratado','required',true),
  jsonb_build_object('key','broker_creci','label','CRECI','required',true),
  jsonb_build_object('key','property_description','label','Identificacao do imovel','required',true),
  jsonb_build_object('key','registry_information','label','Matricula / registro','required',false),
  jsonb_build_object('key','offer_price','label','Preco pretendido','required',true),
  jsonb_build_object('key','commercial_conditions','label','Condicoes comerciais','required',true),
  jsonb_build_object('key','remuneration_terms','label','Remuneracao / corretagem','required',true),
  jsonb_build_object('key','term_text','label','Prazo','required',true),
  jsonb_build_object('key','exclusivity','label','Regime de exclusividade','required',true,'options',jsonb_build_array('exclusive','non_exclusive')),
  jsonb_build_object('key','publicity_authorization','label','Autorizacao de divulgacao','required',true),
  jsonb_build_object('key','closing_terms','label','Condicoes de encerramento','required',true),
  jsonb_build_object('key','city','label','Local','required',true),
  jsonb_build_object('key','document_date','label','Data','required',true)
 ),
 jsonb_build_array('parties','object','commercial_terms','exclusivity','publicity','duties','remuneration','term_and_termination','data_protection','signatures')),
('property_sale_purchase','property_sale_purchase',1,'Contrato Particular de Compra e Venda de Imovel','legal_review_required','2026-09-17','2026-09-16',
 jsonb_build_array(
  jsonb_build_object('title','Codigo Civil - compra e venda, escritura, registro e corretagem','url','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm'),
  jsonb_build_object('title','LGPD - Lei 13.709/2018','url','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm')
 ),
 jsonb_build_array(
  jsonb_build_object('key','seller_name','label','Vendedor(es)','required',true),
  jsonb_build_object('key','buyer_name','label','Comprador(es)','required',true),
  jsonb_build_object('key','property_description','label','Identificacao do imovel','required',true),
  jsonb_build_object('key','registry_information','label','Matricula / registro','required',false),
  jsonb_build_object('key','price','label','Preco','required',true),
  jsonb_build_object('key','payment_terms','label','Forma de pagamento e parcelas','required',true),
  jsonb_build_object('key','arras_option','label','Sinal / arras','required',true,'options',jsonb_build_array('none','applicable')),
  jsonb_build_object('key','arras_terms','label','Condicoes do sinal / arras','required',false),
  jsonb_build_object('key','financing_option','label','Financiamento','required',true,'options',jsonb_build_array('none','applicable')),
  jsonb_build_object('key','financing_terms','label','Condicoes do financiamento','required',false),
  jsonb_build_object('key','possession_terms','label','Posse','required',true),
  jsonb_build_object('key','deed_transfer_terms','label','Escritura e transferencia','required',true),
  jsonb_build_object('key','taxes_expenses_terms','label','Tributos e despesas','required',true),
  jsonb_build_object('key','debts_terms','label','Debitos existentes','required',true),
  jsonb_build_object('key','brokerage_terms','label','Corretagem','required',true),
  jsonb_build_object('key','default_terms','label','Inadimplemento','required',true),
  jsonb_build_object('key','termination_terms','label','Rescisao','required',true),
  jsonb_build_object('key','city','label','Local','required',true),
  jsonb_build_object('key','document_date','label','Data','required',true),
  jsonb_build_object('key','witnesses','label','Testemunhas','required',false)
 ),
 jsonb_build_array('notice','parties','object','price_and_payment','arras','financing','possession','deed_and_transfer','taxes_and_expenses','debts','brokerage','default','termination','data_protection','signatures'));

create or replace function public.real_estate_document_payload_hash(target_payload jsonb)
returns text language sql immutable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(coalesce(target_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function public.real_estate_document_text(target_payload jsonb, target_key text)
returns text language sql immutable security definer set search_path='' as $$
  select coalesce(nullif(trim(target_payload->>target_key),''),'Preenchimento necessário')
$$;

create or replace function public.real_estate_document_date_text(target_payload jsonb, target_key text)
returns text language sql immutable security definer set search_path='' as $$
  select case when coalesce(target_payload->>target_key,'') ~ '^\d{4}-\d{2}-\d{2}$'
    then to_char((target_payload->>target_key)::date,'DD/MM/YYYY') else 'Preenchimento necessário' end
$$;

create or replace function public.real_estate_document_missing_fields(target_type text, target_payload jsonb)
returns text[] language plpgsql immutable security definer set search_path='' as $$
declare required_keys text[]; result text[]:='{}'; item text;
begin
  if jsonb_typeof(coalesce(target_payload,'{}'::jsonb)) <> 'object' then raise exception using errcode='22023',message='DOCUMENT_INVALID_PAYLOAD'; end if;
  if target_type='sale_intermediation' then
    required_keys:=array['seller_name','broker_name','broker_creci','property_description','offer_price','commercial_conditions','remuneration_terms','term_text','exclusivity','publicity_authorization','closing_terms','city','document_date'];
    if target_payload->>'exclusivity' not in ('exclusive','non_exclusive') then result:=array_append(result,'exclusivity'); end if;
  elsif target_type='property_sale_purchase' then
    required_keys:=array['seller_name','buyer_name','property_description','price','payment_terms','arras_option','financing_option','possession_terms','deed_transfer_terms','taxes_expenses_terms','debts_terms','brokerage_terms','default_terms','termination_terms','city','document_date'];
    if target_payload->>'arras_option' not in ('none','applicable') then result:=array_append(result,'arras_option'); end if;
    if target_payload->>'financing_option' not in ('none','applicable') then result:=array_append(result,'financing_option'); end if;
    if target_payload->>'arras_option'='applicable' and nullif(trim(target_payload->>'arras_terms'),'') is null then result:=array_append(result,'arras_terms'); end if;
    if target_payload->>'financing_option'='applicable' and nullif(trim(target_payload->>'financing_terms'),'') is null then result:=array_append(result,'financing_terms'); end if;
  else raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE'; end if;
  foreach item in array required_keys loop
    if nullif(trim(target_payload->>item),'') is null and not item=any(result) then result:=array_append(result,item); end if;
  end loop;
  return result;
end $$;

create or replace function public.validate_real_estate_document_payload(target_type text,target_payload jsonb)
returns void language plpgsql immutable security definer set search_path='' as $$
declare allowed text[]; key text; value jsonb;
begin
  if jsonb_typeof(coalesce(target_payload,'{}'::jsonb)) <> 'object' then raise exception using errcode='22023',message='DOCUMENT_INVALID_PAYLOAD'; end if;
  if target_type='sale_intermediation' then
    allowed:=array['seller_name','seller_contact','broker_name','broker_creci','broker_contact','property_description','registry_information','offer_price','commercial_conditions','remuneration_terms','term_text','exclusivity','publicity_authorization','closing_terms','city','document_date'];
  elsif target_type='property_sale_purchase' then
    allowed:=array['seller_name','seller_contact','buyer_name','buyer_contact','property_description','registry_information','price','payment_terms','arras_option','arras_terms','financing_option','financing_terms','possession_terms','deed_transfer_terms','taxes_expenses_terms','debts_terms','brokerage_terms','default_terms','termination_terms','city','document_date','witnesses'];
  else raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE'; end if;
  for key,value in select * from jsonb_each(target_payload) loop
    if not key=any(allowed) or jsonb_typeof(value) not in ('string','number','boolean','null') or char_length(coalesce(value#>>'{}',''))>5000 then
      raise exception using errcode='22023',message='DOCUMENT_INVALID_FIELD';
    end if;
  end loop;
  if coalesce(target_payload->>'document_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='DOCUMENT_INVALID_DATE'; end if;
  perform (target_payload->>'document_date')::date;
end $$;

create or replace function public.render_real_estate_document(target_type text,target_payload jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare exclusivity_text text; arras_text text; financing_text text;
begin
  perform public.validate_real_estate_document_payload(target_type,target_payload);
  if target_type='sale_intermediation' then
    exclusivity_text:=case target_payload->>'exclusivity'
      when 'exclusive' then 'A modalidade escolhida expressamente é EXCLUSIVA. Durante o prazo indicado, os efeitos da exclusividade e a remuneração observarão o que foi ajustado neste documento e a legislação aplicável, inclusive o art. 726 do Código Civil.'
      when 'non_exclusive' then 'A modalidade escolhida expressamente é NÃO EXCLUSIVA. O contratante poderá atuar por outros meios, e a remuneração observará o resultado da mediação e as demais condições expressamente ajustadas.'
      else 'Preenchimento necessário: escolher EXCLUSIVA ou NÃO EXCLUSIVA.' end;
    return concat_ws(E'\n\n',
      'AUTORIZAÇÃO / CONTRATO DE INTERMEDIAÇÃO PARA VENDA DE IMÓVEL',
      '1. PARTES', 'CONTRATANTE: '||public.real_estate_document_text(target_payload,'seller_name')||'. Contato: '||public.real_estate_document_text(target_payload,'seller_contact')||'.',
      'CONTRATADO: '||public.real_estate_document_text(target_payload,'broker_name')||', CRECI '||public.real_estate_document_text(target_payload,'broker_creci')||'. Contato: '||public.real_estate_document_text(target_payload,'broker_contact')||'.',
      '2. OBJETO', 'O contratante autoriza a intermediação da venda do seguinte imóvel: '||public.real_estate_document_text(target_payload,'property_description')||'. Matrícula/registro, se cadastrado: '||public.real_estate_document_text(target_payload,'registry_information')||'.',
      '3. PREÇO E CONDIÇÕES COMERCIAIS', 'Preço pretendido: '||public.real_estate_document_text(target_payload,'offer_price')||'. Condições: '||public.real_estate_document_text(target_payload,'commercial_conditions')||'.',
      '4. MODALIDADE DA INTERMEDIAÇÃO', exclusivity_text,
      '5. DIVULGAÇÃO', public.real_estate_document_text(target_payload,'publicity_authorization'),
      '6. DEVERES DAS PARTES', 'O contratado atuará com diligência e prudência, prestando as informações relevantes de que disponha. O contratante prestará informações verdadeiras e disponibilizará os elementos necessários à intermediação.',
      '7. REMUNERAÇÃO', public.real_estate_document_text(target_payload,'remuneration_terms'),
      '8. PRAZO E ENCERRAMENTO', 'Prazo: '||public.real_estate_document_text(target_payload,'term_text')||'. Condições de encerramento: '||public.real_estate_document_text(target_payload,'closing_terms')||'.',
      '9. DADOS PESSOAIS', 'Os dados pessoais serão tratados na medida necessária à execução desta intermediação e ao cumprimento de obrigações legais, com acesso restrito e medidas de segurança compatíveis.',
      '10. LOCAL, DATA E ASSINATURAS', public.real_estate_document_text(target_payload,'city')||', '||public.real_estate_document_date_text(target_payload,'document_date')||'.',
      E'\n________________________________________\nCONTRATANTE', E'\n________________________________________\nCONTRATADO / CORRETOR DE IMÓVEIS'
    );
  elsif target_type='property_sale_purchase' then
    arras_text:=case target_payload->>'arras_option' when 'none' then 'As partes declararam que não há sinal/arras nesta configuração.' when 'applicable' then public.real_estate_document_text(target_payload,'arras_terms') else 'Preenchimento necessário: declarar se há sinal/arras.' end;
    financing_text:=case target_payload->>'financing_option' when 'none' then 'As partes declararam que não há financiamento nesta configuração.' when 'applicable' then public.real_estate_document_text(target_payload,'financing_terms') else 'Preenchimento necessário: declarar se há financiamento.' end;
    return concat_ws(E'\n\n',
      'CONTRATO PARTICULAR DE COMPRA E VENDA DE IMÓVEL',
      'AVISO DE REVISÃO', 'Minuta controlada para revisão das partes. As condições juridicamente sensíveis abaixo dependem de preenchimento expresso e de revisão jurídica profissional antes da assinatura.',
      '1. PARTES', 'VENDEDOR(ES): '||public.real_estate_document_text(target_payload,'seller_name')||'. Contato: '||public.real_estate_document_text(target_payload,'seller_contact')||'.', 'COMPRADOR(ES): '||public.real_estate_document_text(target_payload,'buyer_name')||'. Contato: '||public.real_estate_document_text(target_payload,'buyer_contact')||'.',
      '2. IMÓVEL', public.real_estate_document_text(target_payload,'property_description')||'. Matrícula/registro, se cadastrado: '||public.real_estate_document_text(target_payload,'registry_information')||'.',
      '3. PREÇO E PAGAMENTO', 'Preço: '||public.real_estate_document_text(target_payload,'price')||'. Forma de pagamento e parcelas: '||public.real_estate_document_text(target_payload,'payment_terms')||'.',
      '4. SINAL / ARRAS', arras_text,
      '5. FINANCIAMENTO', financing_text,
      '6. POSSE', public.real_estate_document_text(target_payload,'possession_terms'),
      '7. ESCRITURA E TRANSFERÊNCIA', public.real_estate_document_text(target_payload,'deed_transfer_terms'),
      '8. TRIBUTOS E DESPESAS', public.real_estate_document_text(target_payload,'taxes_expenses_terms'),
      '9. DÉBITOS INFORMADOS', public.real_estate_document_text(target_payload,'debts_terms'),
      '10. CORRETAGEM', public.real_estate_document_text(target_payload,'brokerage_terms'),
      '11. INADIMPLEMENTO', public.real_estate_document_text(target_payload,'default_terms'),
      '12. RESCISÃO', public.real_estate_document_text(target_payload,'termination_terms'),
      '13. DADOS PESSOAIS', 'Os dados pessoais serão tratados apenas na medida necessária à preparação e execução desta relação e ao cumprimento de obrigações legais, com acesso restrito e medidas de segurança compatíveis.',
      '14. LOCAL, DATA E ASSINATURAS', public.real_estate_document_text(target_payload,'city')||', '||public.real_estate_document_date_text(target_payload,'document_date')||'.',
      E'\n________________________________________\nVENDEDOR(ES)', E'\n________________________________________\nCOMPRADOR(ES)',
      case when nullif(trim(target_payload->>'witnesses'),'') is null then 'TESTEMUNHAS (opcional nesta configuração): Preenchimento necessário' else 'TESTEMUNHAS: '||(target_payload->>'witnesses') end
    );
  end if;
  raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE';
end $$;

create or replace function public.can_access_real_estate_document(target_document uuid,target_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.can_use_entitlement(target_organization,'crm.documents') and exists(
    select 1 from public.real_estate_documents d
    where d.id=target_document and d.organization_id=target_organization
      and (public.current_membership_role(target_organization) in ('owner','manager')
        or (public.current_membership_role(target_organization)='agent'
          and (d.responsible_user_id=auth.uid() or (d.lead_id is not null and public.can_access_lead(d.lead_id,target_organization)))))
  )
$$;

create policy document_templates_read on public.document_templates for select to authenticated using (status in ('active','legal_review_required'));
create policy real_estate_documents_read on public.real_estate_documents for select to authenticated using (public.can_access_real_estate_document(id,organization_id));
create policy real_estate_document_versions_read on public.real_estate_document_versions for select to authenticated using (public.can_access_real_estate_document(document_id,organization_id));

revoke all on public.document_templates,public.real_estate_documents,public.real_estate_document_versions,public.real_estate_document_previews from anon,authenticated;
grant select on public.document_templates,public.real_estate_documents,public.real_estate_document_versions to authenticated;

create or replace function public.real_estate_document_assert_references(
  target_organization uuid,target_property uuid,target_owner uuid,target_lead uuid,target_proposal uuid
) returns void language plpgsql stable security definer set search_path='' as $$
declare actor_role text:=public.current_membership_role(target_organization);
begin
  if actor_role not in ('owner','manager','agent') or not public.can_use_entitlement(target_organization,'crm.documents') then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  if target_property is not null and not exists(select 1 from public.properties p where p.id=target_property and p.organization_id=target_organization) then raise exception using errcode='42501',message='DOCUMENT_REFERENCE_DENIED'; end if;
  if target_owner is not null and not exists(select 1 from public.property_owners o where o.id=target_owner and o.organization_id=target_organization and (actor_role in ('owner','manager') or o.assigned_to=auth.uid() or exists(select 1 from public.property_acquisitions a where a.organization_id=target_organization and a.owner_id=o.id and a.assigned_to=auth.uid()))) then raise exception using errcode='42501',message='DOCUMENT_REFERENCE_DENIED'; end if;
  if target_lead is not null and not public.can_access_lead(target_lead,target_organization) then raise exception using errcode='42501',message='DOCUMENT_REFERENCE_DENIED'; end if;
  if target_proposal is not null and not exists(select 1 from public.proposals p where p.id=target_proposal and p.organization_id=target_organization and public.can_access_lead(p.lead_id,target_organization)) then raise exception using errcode='42501',message='DOCUMENT_REFERENCE_DENIED'; end if;
end $$;

create or replace function public.get_real_estate_document_prefill(
  target_organization uuid,target_type text,target_property uuid default null,target_owner uuid default null,target_lead uuid default null,target_proposal uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.properties; o public.property_owners; l public.leads; pr public.profiles; org public.organizations; result jsonb:='{}';
begin
  perform public.real_estate_document_assert_references(target_organization,target_property,target_owner,target_lead,target_proposal);
  select * into p from public.properties where id=target_property and organization_id=target_organization;
  select * into o from public.property_owners where id=target_owner and organization_id=target_organization;
  select * into l from public.leads where id=target_lead and organization_id=target_organization;
  select * into pr from public.profiles where id=auth.uid();
  select * into org from public.organizations where id=target_organization;
  result:=jsonb_strip_nulls(jsonb_build_object(
    'seller_name',o.full_name,'seller_contact',concat_ws(' | ',nullif(o.phone,''),nullif(o.email,'')),
    'buyer_name',l.name,'buyer_contact',concat_ws(' | ',nullif(l.phone,''),nullif(l.whatsapp,''),nullif(l.email,'')),
    'broker_name',pr.full_name,'broker_creci',coalesce(nullif(pr.creci,''),nullif(org.creci,'')),
    'broker_contact',concat_ws(' | ',nullif(pr.phone,''),nullif(org.public_phone,''),nullif(org.public_whatsapp,'')),
    'property_description',case when p.id is null then null else concat_ws(', ',p.code,p.title,p.public_address,p.neighborhood,concat_ws('/',p.city,p.state),case when p.total_area is null then null else p.total_area::text||' '||p.total_area_unit end) end,
    'offer_price',p.price,'price',p.price,'city',coalesce(p.city,''),'document_date',to_char(current_date,'YYYY-MM-DD')
  ));
  return result;
end $$;

create or replace function public.preview_real_estate_document(
  target_organization uuid,target_template uuid,target_payload jsonb,target_document uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare template public.document_templates; missing text[]; preview_id uuid; content text;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager','agent') or not public.can_use_entitlement(target_organization,'crm.documents') then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  if target_document is not null and not public.can_access_real_estate_document(target_document,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  select * into template from public.document_templates where id=target_template and status in ('active','legal_review_required');
  if not found then raise exception using errcode='22023',message='DOCUMENT_TEMPLATE_UNAVAILABLE'; end if;
  perform public.validate_real_estate_document_payload(template.document_type,target_payload);
  missing:=public.real_estate_document_missing_fields(template.document_type,target_payload);
  content:=public.render_real_estate_document(template.document_type,target_payload);
  insert into public.real_estate_document_previews(organization_id,template_id,document_id,actor_id,payload_hash,missing_fields)
    values(target_organization,target_template,target_document,auth.uid(),public.real_estate_document_payload_hash(target_payload),missing) returning id into preview_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'real_estate_document',target_document,'document_previewed',jsonb_build_object('template_code',template.template_code,'template_version',template.version,'missing_count',cardinality(missing)));
  return jsonb_build_object('preview_id',preview_id,'content',content,'missing_fields',missing,'expires_at',now()+interval '30 minutes','template_code',template.template_code,'template_version',template.version);
end $$;

create or replace function public.save_real_estate_document_version(
  target_organization uuid,target_preview uuid,target_payload jsonb,target_document uuid default null,target_property uuid default null,target_owner uuid default null,target_lead uuid default null,target_proposal uuid default null,target_changes_summary text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare preview public.real_estate_document_previews; template public.document_templates; document public.real_estate_documents; version_row public.real_estate_document_versions; actor_role text:=public.current_membership_role(target_organization); next_version integer;
begin
  select * into preview from public.real_estate_document_previews where id=target_preview and organization_id=target_organization and actor_id=auth.uid() and consumed_at is null and expires_at>now() for update;
  if not found or preview.document_id is distinct from target_document or public.real_estate_document_payload_hash(target_payload)<>preview.payload_hash then raise exception using errcode='22023',message='DOCUMENT_PREVIEW_MISMATCH'; end if;
  select * into template from public.document_templates where id=preview.template_id;
  perform public.validate_real_estate_document_payload(template.document_type,target_payload);
  perform public.real_estate_document_assert_references(target_organization,target_property,target_owner,target_lead,target_proposal);
  if target_document is null then
    insert into public.real_estate_documents(organization_id,document_type,property_id,owner_id,lead_id,proposal_id,responsible_user_id,created_by,current_version)
      values(target_organization,template.document_type,target_property,target_owner,target_lead,target_proposal,auth.uid(),auth.uid(),1) returning * into document; next_version:=1;
  else
    select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;
    if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
    if document.document_type<>template.document_type then raise exception using errcode='22023',message='DOCUMENT_TYPE_MISMATCH'; end if;
    next_version:=document.current_version+1;
    update public.real_estate_documents set property_id=target_property,owner_id=target_owner,lead_id=target_lead,proposal_id=target_proposal,current_version=next_version,status='draft',updated_at=now(),finalized_at=null,canceled_at=null where id=document.id returning * into document;
  end if;
  insert into public.real_estate_document_versions(organization_id,document_id,version_no,template_id,template_code,template_version,data_snapshot,rendered_content,missing_fields,optional_fields,changes_summary,created_by)
    values(target_organization,document.id,next_version,template.id,template.template_code,template.version,target_payload,public.render_real_estate_document(template.document_type,target_payload),preview.missing_fields,array(select f->>'key' from jsonb_array_elements(template.field_schema) f where coalesce((f->>'required')::boolean,false)=false),nullif(trim(target_changes_summary),''),auth.uid()) returning * into version_row;
  update public.real_estate_document_previews set consumed_at=now(),document_id=document.id where id=preview.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,case when next_version=1 then 'document_created' else 'document_version_created' end,jsonb_build_object('version',next_version,'template_code',template.template_code,'template_version',template.version));
  return jsonb_build_object('document_id',document.id,'version_id',version_row.id,'version_no',next_version,'status','draft','missing_fields',preview.missing_fields);
end $$;

create or replace function public.finalize_real_estate_document(target_organization uuid,target_document uuid,target_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare document public.real_estate_documents; version_row public.real_estate_document_versions;
begin
  select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;
  if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  if document.current_version<>target_version or document.status='canceled' then raise exception using errcode='22023',message='DOCUMENT_VERSION_NOT_CURRENT'; end if;
  select * into version_row from public.real_estate_document_versions where document_id=document.id and version_no=target_version for update;
  if not found or cardinality(version_row.missing_fields)>0 then raise exception using errcode='22023',message='DOCUMENT_REQUIRED_FIELDS_MISSING'; end if;
  if version_row.status='finalized' then return jsonb_build_object('document_id',document.id,'version_no',target_version,'status','finalized'); end if;
  update public.real_estate_document_versions set status='finalized',finalized_at=now() where id=version_row.id;
  update public.real_estate_documents set status='finalized',finalized_at=now(),canceled_at=null,updated_at=now() where id=document.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,'document_finalized',jsonb_build_object('version',target_version,'template_code',version_row.template_code,'template_version',version_row.template_version));
  return jsonb_build_object('document_id',document.id,'version_no',target_version,'status','finalized');
end $$;

create or replace function public.submit_real_estate_document_review(target_organization uuid,target_document uuid,target_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare document public.real_estate_documents; version_row public.real_estate_document_versions;
begin
  select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;
  if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  if document.current_version<>target_version or document.status not in ('draft','review') then raise exception using errcode='22023',message='DOCUMENT_VERSION_NOT_CURRENT'; end if;
  select * into version_row from public.real_estate_document_versions where document_id=document.id and version_no=target_version for update;
  if not found then raise exception using errcode='22023',message='DOCUMENT_VERSION_NOT_CURRENT'; end if;
  update public.real_estate_document_versions set status='review' where id=version_row.id and status='draft';
  update public.real_estate_documents set status='review',updated_at=now() where id=document.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,'document_submitted_for_review',jsonb_build_object('version',target_version));
  return jsonb_build_object('document_id',document.id,'version_no',target_version,'status','review');
end $$;

create or replace function public.cancel_real_estate_document(target_organization uuid,target_document uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare document public.real_estate_documents;
begin
  select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;
  if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  update public.real_estate_documents set status='canceled',canceled_at=now(),finalized_at=null,updated_at=now() where id=document.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,'document_canceled',jsonb_build_object('version',document.current_version));
  return jsonb_build_object('document_id',document.id,'status','canceled');
end $$;

create or replace function public.record_real_estate_document_pdf(target_organization uuid,target_document uuid,target_version integer)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare version_row public.real_estate_document_versions;
begin
  if not public.can_access_real_estate_document(target_document,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED'; end if;
  select * into version_row from public.real_estate_document_versions where document_id=target_document and organization_id=target_organization and version_no=target_version and status='finalized';
  if not found then raise exception using errcode='22023',message='DOCUMENT_NOT_FINALIZED'; end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',target_document,'document_pdf_generated',jsonb_build_object('version',target_version,'template_code',version_row.template_code,'template_version',version_row.template_version));
  return true;
end $$;

revoke all on function public.real_estate_document_payload_hash(jsonb),public.real_estate_document_text(jsonb,text),public.real_estate_document_date_text(jsonb,text),public.real_estate_document_missing_fields(text,jsonb),public.validate_real_estate_document_payload(text,jsonb),public.render_real_estate_document(text,jsonb),public.can_access_real_estate_document(uuid,uuid),public.real_estate_document_assert_references(uuid,uuid,uuid,uuid,uuid),public.get_real_estate_document_prefill(uuid,text,uuid,uuid,uuid,uuid),public.preview_real_estate_document(uuid,uuid,jsonb,uuid),public.save_real_estate_document_version(uuid,uuid,jsonb,uuid,uuid,uuid,uuid,uuid,text),public.finalize_real_estate_document(uuid,uuid,integer),public.submit_real_estate_document_review(uuid,uuid,integer),public.cancel_real_estate_document(uuid,uuid),public.record_real_estate_document_pdf(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_real_estate_document_prefill(uuid,text,uuid,uuid,uuid,uuid),public.preview_real_estate_document(uuid,uuid,jsonb,uuid),public.save_real_estate_document_version(uuid,uuid,jsonb,uuid,uuid,uuid,uuid,uuid,text),public.finalize_real_estate_document(uuid,uuid,integer),public.submit_real_estate_document_review(uuid,uuid,integer),public.cancel_real_estate_document(uuid,uuid),public.record_real_estate_document_pdf(uuid,uuid,integer) to authenticated;
grant execute on function public.can_access_real_estate_document(uuid,uuid) to authenticated;

commit;

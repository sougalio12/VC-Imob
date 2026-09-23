-- VC Imob - Documentos 2.0.
-- Nova versao controlada dos dois modelos existentes, com checklist juridico,
-- bloqueios de cenarios especiais e snapshot imutavel da base juridica.
begin;

alter table public.document_templates
  add column if not exists legal_basis_version text not null default 'legacy-1';

alter table public.real_estate_document_previews
  add column if not exists legal_checklist jsonb not null default '[]'::jsonb,
  add column if not exists blocking_reasons text[] not null default '{}';

alter table public.real_estate_document_versions
  add column if not exists legal_basis_version text not null default 'legacy-1',
  add column if not exists legal_sources_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists legal_checklist jsonb not null default '[]'::jsonb,
  add column if not exists blocking_reasons text[] not null default '{}';

create or replace function public.real_estate_document_missing_fields(target_type text,target_payload jsonb)
returns text[] language plpgsql immutable security definer set search_path='' as $$
declare required_keys text[];result text[]:='{}';item text;
begin
  if jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='DOCUMENT_INVALID_PAYLOAD';end if;
  if target_type='sale_intermediation' then
    required_keys:=array['seller_name','seller_qualification','broker_name','broker_qualification','broker_creci','property_description','registry_information','offer_price','commercial_conditions','remuneration_terms','term_text','exclusivity','documents_presented','publicity_authorization','substitution_authorization','sgr_consultation','signature_method','closing_terms','city','document_date'];
    if target_payload->>'exclusivity' not in ('exclusive','non_exclusive') then result:=array_append(result,'exclusivity');end if;
    if target_payload->>'substitution_authorization' not in ('allowed','not_allowed') then result:=array_append(result,'substitution_authorization');end if;
    if target_payload->>'sgr_consultation' not in ('confirmed','pending') then result:=array_append(result,'sgr_consultation');end if;
    if target_payload->>'signature_method' not in ('physical','electronic_advanced') then result:=array_append(result,'signature_method');end if;
  elsif target_type='property_sale_purchase' then
    required_keys:=array['instrument_nature','seller_name','seller_type','seller_qualification','buyer_name','buyer_type','buyer_qualification','property_description','property_regime','property_stage','special_regime','registry_status','price','payment_terms','arras_option','financing_option','fiduciary_lien','consumer_relationship','coowners_option','possession_terms','deed_transfer_terms','taxes_expenses_terms','debts_terms','brokerage_terms','default_terms','termination_terms','city','document_date'];
    if target_payload->>'instrument_nature' not in ('preliminary_commitment','purchase_sale_contract') then result:=array_append(result,'instrument_nature');end if;
    if target_payload->>'seller_type' not in ('individual','company') then result:=array_append(result,'seller_type');end if;
    if target_payload->>'buyer_type' not in ('individual','company') then result:=array_append(result,'buyer_type');end if;
    if target_payload->>'property_regime' not in ('urban','rural') then result:=array_append(result,'property_regime');end if;
    if target_payload->>'property_stage' not in ('ready','development') then result:=array_append(result,'property_stage');end if;
    if target_payload->>'special_regime' not in ('none','incorporation','subdivision') then result:=array_append(result,'special_regime');end if;
    if target_payload->>'registry_status' not in ('available','unavailable') then result:=array_append(result,'registry_status');end if;
    if target_payload->>'registry_status'='available' and nullif(trim(target_payload->>'registry_information'),'') is null then result:=array_append(result,'registry_information');end if;
    if target_payload->>'arras_option' not in ('none','applicable') then result:=array_append(result,'arras_option');end if;
    if target_payload->>'arras_option'='applicable' and nullif(trim(target_payload->>'arras_terms'),'') is null then result:=array_append(result,'arras_terms');end if;
    if target_payload->>'financing_option' not in ('none','applicable') then result:=array_append(result,'financing_option');end if;
    if target_payload->>'financing_option'='applicable' and nullif(trim(target_payload->>'financing_terms'),'') is null then result:=array_append(result,'financing_terms');end if;
    if target_payload->>'fiduciary_lien' not in ('none','applicable') then result:=array_append(result,'fiduciary_lien');end if;
    if target_payload->>'consumer_relationship' not in ('no','possible') then result:=array_append(result,'consumer_relationship');end if;
    if target_payload->>'coowners_option' not in ('none','applicable') then result:=array_append(result,'coowners_option');end if;
    if target_payload->>'coowners_option'='applicable' and nullif(trim(target_payload->>'coowners_details'),'') is null then result:=array_append(result,'coowners_details');end if;
  else raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE';end if;
  foreach item in array required_keys loop if nullif(trim(target_payload->>item),'') is null and not item=any(result) then result:=array_append(result,item);end if;end loop;
  return result;
end $$;

create or replace function public.validate_real_estate_document_payload(target_type text,target_payload jsonb)
returns void language plpgsql immutable security definer set search_path='' as $$
declare allowed text[];key text;value jsonb;
begin
  if jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='DOCUMENT_INVALID_PAYLOAD';end if;
  if target_type='sale_intermediation' then
    allowed:=array['seller_name','seller_contact','seller_qualification','broker_name','broker_creci','broker_contact','broker_qualification','property_description','registry_information','offer_price','commercial_conditions','remuneration_terms','term_text','exclusivity','documents_presented','publicity_authorization','substitution_authorization','sgr_consultation','signature_method','closing_terms','city','document_date'];
  elsif target_type='property_sale_purchase' then
    allowed:=array['instrument_nature','seller_name','seller_contact','seller_type','seller_qualification','buyer_name','buyer_contact','buyer_type','buyer_qualification','property_description','property_regime','property_stage','special_regime','registry_status','registry_information','price','payment_terms','arras_option','arras_terms','financing_option','financing_terms','fiduciary_lien','consumer_relationship','coowners_option','coowners_details','possession_terms','deed_transfer_terms','taxes_expenses_terms','debts_terms','brokerage_terms','default_terms','termination_terms','city','document_date','witnesses'];
  else raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE';end if;
  for key,value in select * from jsonb_each(target_payload) loop
    if not key=any(allowed) or jsonb_typeof(value) not in ('string','number','boolean','null') or char_length(coalesce(value#>>'{}',''))>5000 then raise exception using errcode='22023',message='DOCUMENT_INVALID_FIELD';end if;
  end loop;
  if coalesce(target_payload->>'document_date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='DOCUMENT_INVALID_DATE';end if;
  perform (target_payload->>'document_date')::date;
end $$;

create or replace function public.real_estate_document_blocking_reasons(target_type text,target_payload jsonb)
returns text[] language plpgsql immutable security definer set search_path='' as $$
declare result text[]:='{}';
begin
  if target_type='sale_intermediation' then
    if target_payload->>'sgr_consultation'<>'confirmed' then result:=array_append(result,'Confirme a consulta prévia do objeto no SGR antes de finalizar.');end if;
  elsif target_type='property_sale_purchase' then
    if target_payload->>'property_regime'='rural' then result:=array_append(result,'Imóvel rural requer análise jurídica específica.');end if;
    if target_payload->>'property_stage'='development' then result:=array_append(result,'Imóvel em empreendimento requer análise jurídica específica.');end if;
    if target_payload->>'special_regime'='incorporation' then result:=array_append(result,'Incorporação imobiliária requer instrumento e revisão específicos.');end if;
    if target_payload->>'special_regime'='subdivision' then result:=array_append(result,'Loteamento requer instrumento e revisão específicos.');end if;
    if target_payload->>'financing_option'='applicable' then result:=array_append(result,'Financiamento requer compatibilização com o instrumento da instituição financeira.');end if;
    if target_payload->>'fiduciary_lien'='applicable' then result:=array_append(result,'Alienação fiduciária existente requer análise do gravame e do credor fiduciário.');end if;
    if target_payload->>'consumer_relationship'='possible' then result:=array_append(result,'Possível relação de consumo requer revisão específica das cláusulas.');end if;
    if target_payload->>'registry_status'='unavailable' then result:=array_append(result,'Matrícula/registro não conferido: a finalização exige análise documental específica.');end if;
  end if;
  return result;
end $$;

create or replace function public.real_estate_document_checklist(target_type text,target_payload jsonb)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare missing text[]:=public.real_estate_document_missing_fields(target_type,target_payload);blockers text[]:=public.real_estate_document_blocking_reasons(target_type,target_payload);
begin
  if target_type='sale_intermediation' then
    return jsonb_build_array(
      jsonb_build_object('key','parties','label','Qualificação do contratante e do corretor','level','required','resolved',not(missing&&array['seller_name','seller_qualification','broker_name','broker_qualification','broker_creci'])),
      jsonb_build_object('key','property','label','Imóvel, registro e documentos apresentados','level','required','resolved',not(missing&&array['property_description','registry_information','documents_presented'])),
      jsonb_build_object('key','commercial','label','Oferta, remuneração, prazo e exclusividade','level','required','resolved',not(missing&&array['offer_price','commercial_conditions','remuneration_terms','term_text','exclusivity'])),
      jsonb_build_object('key','sgr','label','Consulta prévia do objeto no SGR confirmada pelo usuário','level',case when target_payload->>'sgr_consultation'='confirmed' then 'information' else 'required' end,'resolved',target_payload->>'sgr_consultation'='confirmed'),
      jsonb_build_object('key','signature','label','Meio de assinatura e próximos passos conferidos','level','information','resolved',not(missing&&array['signature_method']))
    );
  end if;
  return jsonb_build_array(
    jsonb_build_object('key','parties','label','Identificação e qualificação das partes','level','required','resolved',not(missing&&array['seller_name','seller_qualification','buyer_name','buyer_qualification'])),
    jsonb_build_object('key','property','label','Identificação do imóvel e situação registral','level','required','resolved',not(missing&&array['property_description','registry_status','registry_information'])),
    jsonb_build_object('key','price','label','Preço, pagamento e sinal/arras','level','required','resolved',not(missing&&array['price','payment_terms','arras_option','arras_terms'])),
    jsonb_build_object('key','possession','label','Posse, formalização, registro e despesas','level','required','resolved',not(missing&&array['possession_terms','deed_transfer_terms','taxes_expenses_terms'])),
    jsonb_build_object('key','risk','label','Cenários especiais e gravames','level',case when cardinality(blockers)>0 then 'attention' else 'information' end,'resolved',cardinality(blockers)=0),
    jsonb_build_object('key','signatures','label','Local, data, assinaturas e testemunhas quando aplicáveis','level','information','resolved',not(missing&&array['city','document_date']))
  );
end $$;

create or replace function public.render_real_estate_document(target_type text,target_payload jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare exclusivity_text text;arras_text text;financing_text text;nature_text text;signature_text text;
begin
  perform public.validate_real_estate_document_payload(target_type,target_payload);
  if target_type='sale_intermediation' then
    exclusivity_text:=case target_payload->>'exclusivity' when 'exclusive' then 'COM EXCLUSIVIDADE, observados os efeitos ajustados e o art. 726 do Código Civil.' when 'non_exclusive' then 'SEM EXCLUSIVIDADE, observada a efetiva mediação e as condições ajustadas.' else 'Preenchimento necessário.' end;
    signature_text:=case target_payload->>'signature_method' when 'physical' then 'As partes escolheram assinatura física.' when 'electronic_advanced' then 'As partes escolheram assinatura eletrônica avançada ou superior, a ser realizada em serviço externo juridicamente adequado. O VC Imob não assina nem registra este documento no SGR.' else 'Preenchimento necessário.' end;
    return concat_ws(E'\n\n',
      'CONTRATO DE CORRETAGEM IMOBILIÁRIA PARA VENDA',
      'QUADRO RESUMO',
      'ITEM 1 - PARTES','CONTRATANTE: '||public.real_estate_document_sentence(target_payload,'seller_name')||' Qualificação: '||public.real_estate_document_sentence(target_payload,'seller_qualification')||' Contato: '||public.real_estate_document_sentence(target_payload,'seller_contact'),'CORRETOR(A) / IMOBILIÁRIA: '||public.real_estate_document_sentence(target_payload,'broker_name')||' Qualificação: '||public.real_estate_document_sentence(target_payload,'broker_qualification')||' CRECI: '||public.real_estate_document_sentence(target_payload,'broker_creci')||' Contato: '||public.real_estate_document_sentence(target_payload,'broker_contact'),
      'ITEM 2 - IMÓVEL OBJETO DA CORRETAGEM',public.real_estate_document_sentence(target_payload,'property_description')||' Registro imobiliário: '||public.real_estate_document_sentence(target_payload,'registry_information'),
      'ITEM 3 - TIPO DE CONTRATAÇÃO',exclusivity_text,
      'ITEM 4 - HONORÁRIOS DE CORRETAGEM',public.real_estate_document_sentence(target_payload,'remuneration_terms'),
      'ITEM 5 - OFERTA E CONDIÇÕES','Preço de oferta: '||public.real_estate_document_sentence(target_payload,'offer_price')||' Condições: '||public.real_estate_document_sentence(target_payload,'commercial_conditions'),
      'ITEM 6 - PRAZO',public.real_estate_document_sentence(target_payload,'term_text'),
      'ITEM 7 - DOCUMENTOS APRESENTADOS',public.real_estate_document_sentence(target_payload,'documents_presented'),
      'ITEM 8 - PUBLICIDADE AUTORIZADA',public.real_estate_document_sentence(target_payload,'publicity_authorization'),
      '1. OBJETO','O contratante autoriza a prestação de serviços profissionais de intermediação para a venda do imóvel descrito no quadro resumo, conforme os arts. 722 a 729 do Código Civil e a legislação profissional aplicável.',
      '2. PRESTAÇÃO DO SERVIÇO','O contratado atuará com diligência, prudência, boa-fé e sigilo, prestando espontaneamente as informações relevantes de que disponha. O contratante fornecerá informações verdadeiras e os documentos necessários.',
      '3. SUBSTITUIÇÃO',case target_payload->>'substitution_authorization' when 'allowed' then 'O contratado poderá atuar com outros profissionais habilitados, permanecendo responsável perante o contratante.' when 'not_allowed' then 'Não foi autorizada substituição do contratado sem anuência expressa do contratante.' else 'Preenchimento necessário.' end,
      '4. HONORÁRIOS',public.real_estate_document_sentence(target_payload,'remuneration_terms')||' A exigibilidade observará a conclusão da mediação, a exclusividade escolhida e os arts. 725 a 727 do Código Civil.',
      '5. CONTRAOFERTAS','O contratado poderá receber propostas e contraofertas, que somente vincularão o contratante mediante aceitação expressa.',
      '6. VIGÊNCIA E ENCERRAMENTO','Prazo: '||public.real_estate_document_sentence(target_payload,'term_text')||' Encerramento: '||public.real_estate_document_sentence(target_payload,'closing_terms'),
      '7. DADOS PESSOAIS','Os dados pessoais serão tratados na medida necessária à execução da intermediação e ao cumprimento de obrigações legais, com acesso restrito. Documentos confiados deverão ser devolvidos ou preservados conforme a finalidade e a legislação aplicável.',
      '8. SGR E ASSINATURA','Consulta ao SGR declarada pelo usuário: '||case target_payload->>'sgr_consultation' when 'confirmed' then 'confirmada.' else 'pendente.' end||' '||signature_text,
      '9. LOCAL, DATA E ASSINATURAS',public.real_estate_document_location_text(target_payload,'city')||', '||public.real_estate_document_date_text(target_payload,'document_date')||'.',E'\n________________________________________\nCONTRATANTE',E'\n________________________________________\nCORRETOR(A) / IMOBILIÁRIA'
    );
  elsif target_type='property_sale_purchase' then
    nature_text:=case target_payload->>'instrument_nature' when 'preliminary_commitment' then 'As partes escolheram estruturar esta minuta como compromisso preliminar, sujeito às condições expressas e à revisão profissional.' when 'purchase_sale_contract' then 'As partes escolheram estruturar esta minuta como contrato obrigacional de compra e venda. Este instrumento, por si só, não transfere a propriedade imobiliária.' else 'Preenchimento necessário.' end;
    arras_text:=case target_payload->>'arras_option' when 'none' then 'As partes declararam que não há sinal/arras nesta configuração.' when 'applicable' then public.real_estate_document_sentence(target_payload,'arras_terms')||' A qualificação e os efeitos das arras devem ser conferidos à luz dos arts. 417 a 420 do Código Civil.' else 'Preenchimento necessário.' end;
    financing_text:=case target_payload->>'financing_option' when 'none' then 'As partes declararam que não há financiamento nesta configuração.' when 'applicable' then public.real_estate_document_sentence(target_payload,'financing_terms')||' A finalização desta minuta permanece bloqueada até revisão e compatibilização com o instrumento da instituição financeira.' else 'Preenchimento necessário.' end;
    return concat_ws(E'\n\n',
      'INSTRUMENTO PARTICULAR DE COMPRA E VENDA DE IMÓVEL - MINUTA PARA REVISÃO',
      'AVISO DE NATUREZA JURÍDICA','Esta minuta organiza obrigações negociais e não é escritura pública, não certifica assinatura e não transfere a propriedade por si só. A aquisição da propriedade depende do título adequado e, em regra, de seu registro no Registro de Imóveis, conforme os arts. 1.227 e 1.245 do Código Civil.',
      '1. NATUREZA DO INSTRUMENTO',nature_text,
      '2. PARTES','VENDEDOR(ES): '||public.real_estate_document_sentence(target_payload,'seller_name')||' Tipo: '||public.real_estate_document_sentence(target_payload,'seller_type')||' Qualificação: '||public.real_estate_document_sentence(target_payload,'seller_qualification')||' Contato: '||public.real_estate_document_sentence(target_payload,'seller_contact'),'COMPRADOR(ES): '||public.real_estate_document_sentence(target_payload,'buyer_name')||' Tipo: '||public.real_estate_document_sentence(target_payload,'buyer_type')||' Qualificação: '||public.real_estate_document_sentence(target_payload,'buyer_qualification')||' Contato: '||public.real_estate_document_sentence(target_payload,'buyer_contact'),
      '3. IMÓVEL',public.real_estate_document_sentence(target_payload,'property_description')||' Regime: '||public.real_estate_document_sentence(target_payload,'property_regime')||'. Estágio: '||public.real_estate_document_sentence(target_payload,'property_stage')||'. Situação registral declarada: '||public.real_estate_document_sentence(target_payload,'registry_status')||'. Matrícula/registro: '||public.real_estate_document_sentence(target_payload,'registry_information'),
      '4. PREÇO E PAGAMENTO','Preço: '||public.real_estate_document_sentence(target_payload,'price')||' Forma de pagamento: '||public.real_estate_document_sentence(target_payload,'payment_terms'),
      '5. SINAL / ARRAS',arras_text,
      '6. FINANCIAMENTO E GRAVAMES',financing_text||' Alienação fiduciária declarada: '||public.real_estate_document_sentence(target_payload,'fiduciary_lien')||'.',
      '7. POSSE',public.real_estate_document_sentence(target_payload,'possession_terms'),
      '8. FORMALIZAÇÃO E REGISTRO',public.real_estate_document_sentence(target_payload,'deed_transfer_terms')||' As formalidades dependem da natureza do negócio e do título levado a registro; reconhecimento de firma e testemunhas não são tratados aqui como exigências universais.',
      '9. TRIBUTOS E DESPESAS',public.real_estate_document_sentence(target_payload,'taxes_expenses_terms')||' Na ausência de ajuste diverso, aplica-se a regra do art. 490 do Código Civil.',
      '10. DÉBITOS E DECLARAÇÕES',public.real_estate_document_sentence(target_payload,'debts_terms')||' Coproprietários: '||case target_payload->>'coowners_option' when 'none' then 'não informados.' when 'applicable' then public.real_estate_document_sentence(target_payload,'coowners_details') else 'Preenchimento necessário.' end,
      '11. CORRETAGEM',public.real_estate_document_sentence(target_payload,'brokerage_terms'),
      '12. INADIMPLEMENTO',public.real_estate_document_sentence(target_payload,'default_terms')||' Juros e atualização devem observar a convenção válida e a legislação vigente, inclusive a Lei 14.905/2024 quando aplicável.',
      '13. RESCISÃO',public.real_estate_document_sentence(target_payload,'termination_terms'),
      '14. DADOS PESSOAIS','Os dados pessoais serão tratados somente na medida necessária à preparação, revisão e execução da relação, com acesso restrito e sem exposição em logs ou cache público.',
      '15. LOCAL, DATA E ASSINATURAS',public.real_estate_document_location_text(target_payload,'city')||', '||public.real_estate_document_date_text(target_payload,'document_date')||'.',E'\n________________________________________\nVENDEDOR(ES)',E'\n________________________________________\nCOMPRADOR(ES)',case when nullif(trim(target_payload->>'witnesses'),'') is null then 'TESTEMUNHAS: não preenchidas nesta minuta; a necessidade deve ser avaliada conforme a finalidade do instrumento.' else 'TESTEMUNHAS: '||public.real_estate_document_sentence(target_payload,'witnesses') end
    );
  end if;
  raise exception using errcode='22023',message='DOCUMENT_INVALID_TYPE';
end $$;

update public.document_templates set status='retired' where version=1 and template_code in ('sale_intermediation','property_sale_purchase');

insert into public.document_templates(template_code,document_type,version,name,status,effective_at,legal_reviewed_at,legal_basis_version,legal_sources,field_schema,clause_schema)
values
('sale_intermediation','sale_intermediation',2,'Contrato de Corretagem Imobiliária para Venda','legal_review_required','2026-09-22','2026-09-22','cofeci-1504-2023-v1',
 jsonb_build_array(
  jsonb_build_object('title','Resolução COFECI 1.504/2023 e Anexo I','url','https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_1504_2023.pdf','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 6.530/1978','url','https://www.planalto.gov.br/ccivil_03/leis/l6530.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Decreto 81.871/1978','url','https://www.planalto.gov.br/ccivil_03/decreto/antigos/d81871.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Código Civil - arts. 722 a 729','url','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Código de Ética - Resolução COFECI 326/1992','url','https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_326_1992.pdf','verified_at','2026-09-22'),
  jsonb_build_object('title','LGPD - Lei 13.709/2018','url','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 14.063/2020','url','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm','verified_at','2026-09-22')
 ),
 jsonb_build_array(
  jsonb_build_object('key','seller_name','required',true),jsonb_build_object('key','seller_qualification','required',true),jsonb_build_object('key','broker_name','required',true),jsonb_build_object('key','broker_qualification','required',true),jsonb_build_object('key','broker_creci','required',true),jsonb_build_object('key','property_description','required',true),jsonb_build_object('key','registry_information','required',true),jsonb_build_object('key','offer_price','required',true),jsonb_build_object('key','commercial_conditions','required',true),jsonb_build_object('key','remuneration_terms','required',true),jsonb_build_object('key','term_text','required',true),jsonb_build_object('key','exclusivity','required',true),jsonb_build_object('key','documents_presented','required',true),jsonb_build_object('key','publicity_authorization','required',true),jsonb_build_object('key','substitution_authorization','required',true),jsonb_build_object('key','sgr_consultation','required',true),jsonb_build_object('key','signature_method','required',true),jsonb_build_object('key','closing_terms','required',true),jsonb_build_object('key','city','required',true),jsonb_build_object('key','document_date','required',true)
 ),jsonb_build_array('summary','parties','property','commercial','service','fees','term','privacy','sgr','signatures')),
('property_sale_purchase','property_sale_purchase',2,'Instrumento Particular de Compra e Venda - Minuta para Revisão','legal_review_required','2026-09-22','2026-09-22','civil-registry-2026-09-v1',
 jsonb_build_array(
  jsonb_build_object('title','Código Civil - arts. 107, 108, 417 a 420, 481 e seguintes, 490, 1.227 e 1.245','url','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei de Registros Públicos - Lei 6.015/1973','url','https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 14.905/2024','url','https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14905.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Código de Defesa do Consumidor - Lei 8.078/1990','url','https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 4.591/1964','url','https://www.planalto.gov.br/ccivil_03/leis/l4591compilado.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 6.766/1979','url','https://www.planalto.gov.br/ccivil_03/leis/l6766compilado.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Lei 9.514/1997','url','https://www.planalto.gov.br/ccivil_03/leis/l9514.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','Estatuto da Terra - Lei 4.504/1964','url','https://www.planalto.gov.br/ccivil_03/leis/l4504compilada.htm','verified_at','2026-09-22'),
  jsonb_build_object('title','LGPD - Lei 13.709/2018','url','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm','verified_at','2026-09-22')
 ),
 jsonb_build_array(
  jsonb_build_object('key','instrument_nature','required',true),jsonb_build_object('key','seller_name','required',true),jsonb_build_object('key','seller_qualification','required',true),jsonb_build_object('key','buyer_name','required',true),jsonb_build_object('key','buyer_qualification','required',true),jsonb_build_object('key','property_description','required',true),jsonb_build_object('key','property_regime','required',true),jsonb_build_object('key','property_stage','required',true),jsonb_build_object('key','special_regime','required',true),jsonb_build_object('key','registry_status','required',true),jsonb_build_object('key','registry_information','required',false),jsonb_build_object('key','price','required',true),jsonb_build_object('key','payment_terms','required',true),jsonb_build_object('key','arras_option','required',true),jsonb_build_object('key','financing_option','required',true),jsonb_build_object('key','fiduciary_lien','required',true),jsonb_build_object('key','consumer_relationship','required',true),jsonb_build_object('key','coowners_option','required',true),jsonb_build_object('key','possession_terms','required',true),jsonb_build_object('key','deed_transfer_terms','required',true),jsonb_build_object('key','taxes_expenses_terms','required',true),jsonb_build_object('key','debts_terms','required',true),jsonb_build_object('key','brokerage_terms','required',true),jsonb_build_object('key','default_terms','required',true),jsonb_build_object('key','termination_terms','required',true),jsonb_build_object('key','city','required',true),jsonb_build_object('key','document_date','required',true)
 ),jsonb_build_array('notice','scenario','parties','property','price','arras','financing','possession','formalization','expenses','debts','brokerage','default','termination','privacy','signatures'))
on conflict (template_code,version) do nothing;

create or replace function public.preview_real_estate_document(target_organization uuid,target_template uuid,target_payload jsonb,target_document uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare template public.document_templates;missing text[];blockers text[];checklist jsonb;preview_id uuid;content text;identity_id uuid;identity jsonb;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager','agent') or not public.can_use_entitlement(target_organization,'crm.documents') then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED';end if;
  if target_document is not null and not public.can_access_real_estate_document(target_document,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED';end if;
  select * into template from public.document_templates where id=target_template and status in ('active','legal_review_required');if not found then raise exception using errcode='22023',message='DOCUMENT_TEMPLATE_UNAVAILABLE';end if;
  perform public.validate_real_estate_document_payload(template.document_type,target_payload);missing:=public.real_estate_document_missing_fields(template.document_type,target_payload);blockers:=public.real_estate_document_blocking_reasons(template.document_type,target_payload);checklist:=public.real_estate_document_checklist(template.document_type,target_payload);content:=public.render_real_estate_document(template.document_type,target_payload);
  select current_document_identity_id into identity_id from public.organizations where id=target_organization;identity:=public.real_estate_document_identity_snapshot(target_organization,identity_id);
  insert into public.real_estate_document_previews(organization_id,template_id,document_id,actor_id,payload_hash,missing_fields,legal_checklist,blocking_reasons,document_identity_id,identity_snapshot) values(target_organization,target_template,target_document,auth.uid(),public.real_estate_document_payload_hash(target_payload),missing,checklist,blockers,identity_id,coalesce(identity,'{}')) returning id into preview_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',target_document,'document_previewed',jsonb_build_object('template_code',template.template_code,'template_version',template.version,'legal_basis_version',template.legal_basis_version,'missing_count',cardinality(missing),'blocking_count',cardinality(blockers),'identity_version',identity->>'identity_version'));
  return jsonb_build_object('preview_id',preview_id,'content',content,'missing_fields',missing,'blocking_reasons',blockers,'legal_checklist',checklist,'expires_at',now()+interval '30 minutes','template_code',template.template_code,'template_version',template.version,'legal_basis_version',template.legal_basis_version,'legal_reviewed_at',template.legal_reviewed_at,'document_identity_id',identity_id,'identity_snapshot',identity);
end $$;

create or replace function public.save_real_estate_document_version(target_organization uuid,target_preview uuid,target_payload jsonb,target_document uuid default null,target_property uuid default null,target_owner uuid default null,target_lead uuid default null,target_proposal uuid default null,target_changes_summary text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare preview public.real_estate_document_previews;template public.document_templates;document public.real_estate_documents;version_row public.real_estate_document_versions;next_version integer;
begin
  select * into preview from public.real_estate_document_previews where id=target_preview and organization_id=target_organization and actor_id=auth.uid() and consumed_at is null and expires_at>now() for update;
  if not found or preview.document_id is distinct from target_document or public.real_estate_document_payload_hash(target_payload)<>preview.payload_hash then raise exception using errcode='22023',message='DOCUMENT_PREVIEW_MISMATCH';end if;
  select * into template from public.document_templates where id=preview.template_id;perform public.validate_real_estate_document_payload(template.document_type,target_payload);perform public.real_estate_document_assert_references(target_organization,target_property,target_owner,target_lead,target_proposal);
  if target_document is null then insert into public.real_estate_documents(organization_id,document_type,property_id,owner_id,lead_id,proposal_id,responsible_user_id,created_by,current_version) values(target_organization,template.document_type,target_property,target_owner,target_lead,target_proposal,auth.uid(),auth.uid(),1) returning * into document;next_version:=1;
  else select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED';end if;if document.document_type<>template.document_type then raise exception using errcode='22023',message='DOCUMENT_TYPE_MISMATCH';end if;next_version:=document.current_version+1;update public.real_estate_documents set property_id=target_property,owner_id=target_owner,lead_id=target_lead,proposal_id=target_proposal,current_version=next_version,status='draft',updated_at=now(),finalized_at=null,canceled_at=null where id=document.id returning * into document;end if;
  insert into public.real_estate_document_versions(organization_id,document_id,version_no,template_id,template_code,template_version,legal_basis_version,legal_sources_snapshot,data_snapshot,rendered_content,missing_fields,optional_fields,legal_checklist,blocking_reasons,changes_summary,created_by,document_identity_id,identity_snapshot) values(target_organization,document.id,next_version,template.id,template.template_code,template.version,template.legal_basis_version,template.legal_sources,target_payload,public.render_real_estate_document(template.document_type,target_payload),preview.missing_fields,array(select f->>'key' from jsonb_array_elements(template.field_schema) f where coalesce((f->>'required')::boolean,false)=false),preview.legal_checklist,preview.blocking_reasons,nullif(trim(target_changes_summary),''),auth.uid(),preview.document_identity_id,preview.identity_snapshot) returning * into version_row;
  update public.real_estate_document_previews set consumed_at=now(),document_id=document.id where id=preview.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,case when next_version=1 then 'document_created' else 'document_version_created' end,jsonb_build_object('version',next_version,'template_code',template.template_code,'template_version',template.version,'legal_basis_version',template.legal_basis_version,'blocking_count',cardinality(preview.blocking_reasons),'identity_version',preview.identity_snapshot->>'identity_version'));
  return jsonb_build_object('document_id',document.id,'version_id',version_row.id,'version_no',next_version,'status','draft','missing_fields',preview.missing_fields,'blocking_reasons',preview.blocking_reasons);
end $$;

create or replace function public.finalize_real_estate_document(target_organization uuid,target_document uuid,target_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare document public.real_estate_documents;version_row public.real_estate_document_versions;
begin
  select * into document from public.real_estate_documents where id=target_document and organization_id=target_organization for update;if not found or not public.can_access_real_estate_document(document.id,target_organization) then raise exception using errcode='42501',message='DOCUMENT_ACCESS_DENIED';end if;
  if document.current_version<>target_version or document.status='canceled' then raise exception using errcode='22023',message='DOCUMENT_VERSION_NOT_CURRENT';end if;
  select * into version_row from public.real_estate_document_versions where document_id=document.id and version_no=target_version for update;
  if cardinality(version_row.missing_fields)>0 then raise exception using errcode='22023',message='DOCUMENT_REQUIRED_FIELDS_MISSING';end if;
  if cardinality(version_row.blocking_reasons)>0 then raise exception using errcode='22023',message='DOCUMENT_LEGAL_REVIEW_REQUIRED';end if;
  if version_row.status='finalized' then return jsonb_build_object('document_id',document.id,'version_no',target_version,'status','finalized');end if;
  update public.real_estate_document_versions set status='finalized',finalized_at=now() where id=version_row.id;
  update public.real_estate_documents set status='finalized',finalized_at=now(),canceled_at=null,updated_at=now() where id=document.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'real_estate_document',document.id,'document_finalized',jsonb_build_object('version',target_version,'template_code',version_row.template_code,'template_version',version_row.template_version,'legal_basis_version',version_row.legal_basis_version));
  return jsonb_build_object('document_id',document.id,'version_no',target_version,'status','finalized');
end $$;

revoke all on function public.real_estate_document_blocking_reasons(text,jsonb),public.real_estate_document_checklist(text,jsonb) from public,anon,authenticated;

commit;

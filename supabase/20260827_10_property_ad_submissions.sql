-- Fluxo publico "Anunciar seu imovel": captura transacional + outbox de e-mail.
begin;
create table public.property_ad_requests (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 name text not null, phone text not null, property_type text not null, location text not null,
 approximate_value text, description text, preferred_time text not null check(preferred_time in ('Manhã','Tarde','Noite')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed')),
 email_attempts integer not null default 0 check(email_attempts>=0), email_lease_until timestamptz,
 email_sent_at timestamptz, email_last_error text, pdf_size_bytes integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id)
);
create index property_ad_requests_outbox_idx on public.property_ad_requests(email_status,created_at) where email_status<>'sent';
alter table public.property_ad_requests enable row level security; alter table public.property_ad_requests force row level security;
revoke all on table public.property_ad_requests from public,anon,authenticated;

create or replace function public.capture_property_ad_request(target_organization uuid,target_request_id uuid,target_name text,target_phone text,target_property_type text,target_location text,target_approximate_value text,target_description text,target_preferred_time text)
returns table(request_id uuid,lead_id uuid,created boolean,email_status text) language plpgsql volatile security definer set search_path='' as $$
declare existing public.property_ad_requests%rowtype; new_lead uuid; normalized_phone text:=regexp_replace(coalesce(target_phone,''),'\D','','g');
begin
 if target_organization is null or target_request_id is null or char_length(trim(coalesce(target_name,''))) not between 2 and 120 or char_length(normalized_phone) not between 8 and 15 or char_length(trim(coalesce(target_property_type,''))) not between 2 and 60 or char_length(trim(coalesce(target_location,''))) not between 2 and 160 or target_preferred_time not in ('Manhã','Tarde','Noite') or char_length(coalesce(target_approximate_value,''))>80 or char_length(coalesce(target_description,''))>800 then raise exception using errcode='22023',message='Solicitacao de anuncio invalida'; end if;
 if not exists(select 1 from public.organizations where id=target_organization) then raise exception using errcode='22023',message='Organizacao de destino invalida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_organization::text||':'||target_request_id::text,41));
 select * into existing from public.property_ad_requests where organization_id=target_organization and id=target_request_id;
 if found then return query select existing.id,existing.lead_id,false,existing.email_status; return; end if;
 insert into public.leads(organization_id,name,phone,whatsapp,origin,budget,desired_region,notes,stage,entered_at)
 values(target_organization,trim(target_name),normalized_phone,normalized_phone,'anunciar_imovel',nullif(trim(target_approximate_value),''),trim(target_location),'Solicitação recebida pelo formulário público Anunciar seu imóvel.','novo',now()) returning id into new_lead;
 insert into public.lead_notes(organization_id,lead_id,content) values(target_organization,new_lead,format('Tipo: %s. Localização: %s. Valor aproximado: %s. Horário preferido: %s. Descrição: %s.',trim(target_property_type),trim(target_location),coalesce(nullif(trim(target_approximate_value),''),'Não informado'),target_preferred_time,coalesce(nullif(trim(target_description),''),'Não informada')));
 insert into public.property_ad_requests(id,organization_id,lead_id,name,phone,property_type,location,approximate_value,description,preferred_time)
 values(target_request_id,target_organization,new_lead,trim(target_name),normalized_phone,trim(target_property_type),trim(target_location),nullif(trim(target_approximate_value),''),nullif(trim(target_description),''),target_preferred_time);
 return query select target_request_id,new_lead,true,'pending'::text;
end $$;

create or replace function public.claim_property_ad_email(target_request_id uuid,target_organization uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$ begin
 update public.property_ad_requests set email_status='sending',email_attempts=email_attempts+1,email_lease_until=now()+interval '5 minutes',updated_at=now()
 where id=target_request_id and organization_id=target_organization and (email_status in ('pending','failed') or (email_status='sending' and email_lease_until<now())); return found; end $$;
create or replace function public.complete_property_ad_email(target_request_id uuid,target_organization uuid,succeeded boolean,error_message text default null,target_pdf_size integer default null)
returns void language plpgsql volatile security definer set search_path='' as $$ begin
 update public.property_ad_requests set email_status=case when succeeded then 'sent' else 'failed' end,email_sent_at=case when succeeded then now() end,email_last_error=case when succeeded then null else left(coalesce(error_message,'Falha no transporte'),240) end,pdf_size_bytes=coalesce(target_pdf_size,pdf_size_bytes),email_lease_until=null,updated_at=now() where id=target_request_id and organization_id=target_organization and email_status='sending'; if not found then raise exception 'Outbox nao esta em processamento'; end if; end $$;

do $$ declare signature text; begin foreach signature in array array['capture_property_ad_request(uuid,uuid,text,text,text,text,text,text,text)','claim_property_ad_email(uuid,uuid)','complete_property_ad_email(uuid,uuid,boolean,text,integer)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',signature); execute format('grant execute on function public.%s to service_role',signature); end loop; end $$;
commit;

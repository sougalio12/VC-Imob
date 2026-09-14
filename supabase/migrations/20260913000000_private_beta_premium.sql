-- Evolucao pos-beta: operacao imobiliaria integrada, aditiva e multi-tenant.
begin;

alter table public.leads
  add column if not exists preference_purpose text,
  add column if not exists preference_max_area numeric(12,2),
  add column if not exists preference_min_suites smallint,
  add column if not exists preference_min_bathrooms smallint,
  add column if not exists preference_min_parking smallint,
  add column if not exists preference_features text[] not null default '{}',
  add column if not exists preference_notes text;

alter table public.leads add constraint leads_preference_max_area_check
  check(preference_max_area is null or preference_max_area>=0);
alter table public.leads add constraint leads_preference_area_range_check
  check(preference_min_area is null or preference_max_area is null or preference_min_area<=preference_max_area);
alter table public.leads add constraint leads_preference_rooms_check
  check((preference_min_suites is null or preference_min_suites between 0 and 30)
    and (preference_min_bathrooms is null or preference_min_bathrooms between 0 and 30)
    and (preference_min_parking is null or preference_min_parking between 0 and 30));

create table public.properties(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  title text not null,
  slug text not null,
  purpose text not null default 'venda' check(purpose in ('venda','locacao','venda_locacao')),
  property_type text,
  description text,
  price numeric(14,2) check(price is null or price>=0),
  city text,
  state text,
  neighborhood text,
  public_address text,
  total_area numeric(14,2) check(total_area is null or total_area>=0),
  total_area_unit text not null default 'm²',
  built_area numeric(14,2) check(built_area is null or built_area>=0),
  bedrooms smallint check(bedrooms is null or bedrooms between 0 and 100),
  suites smallint check(suites is null or suites between 0 and 100),
  bathrooms smallint check(bathrooms is null or bathrooms between 0 and 100),
  parking_spaces smallint check(parking_spaces is null or parking_spaces between 0 and 100),
  features text[] not null default '{}',
  status text not null default 'draft' check(status in ('draft','available','reserved','sold','inactive')),
  is_published boolean not null default false,
  featured boolean not null default false,
  video_url text,
  publication_date date,
  broker_name text,
  broker_creci text,
  disclosure jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,code), unique(organization_id,slug),
  check(code ~ '^VCI[0-9]{6}$'),
  check(not is_published or status in ('available','reserved'))
);
create table public.property_media(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null check(sort_order between 0 and 999),
  is_cover boolean not null default false,
  alt_text text,
  caption text,
  media_kind text not null default 'photo' check(media_kind in ('photo','project')),
  created_at timestamptz not null default now(),
  unique(property_id,sort_order), unique(property_id,storage_path)
);
create unique index property_media_one_cover_idx on public.property_media(property_id) where is_cover;
create index properties_org_status_idx on public.properties(organization_id,status,updated_at desc);
create index properties_public_idx on public.properties(organization_id,is_published,publication_date desc) where is_published;
create index property_media_property_idx on public.property_media(property_id,sort_order);

create table public.proposals(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  asking_price numeric(14,2) check(asking_price is null or asking_price>=0),
  proposed_price numeric(14,2) check(proposed_price is null or proposed_price>=0),
  counter_price numeric(14,2) check(counter_price is null or counter_price>=0),
  final_price numeric(14,2) check(final_price is null or final_price>=0),
  commission_expected numeric(14,2) check(commission_expected is null or commission_expected>=0),
  commission_received numeric(14,2) check(commission_received is null or commission_received>=0),
  proposal_date date not null default current_date,
  closed_at timestamptz,
  status text not null default 'draft' check(status in ('draft','sent','negotiating','accepted','rejected','canceled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proposals_org_status_idx on public.proposals(organization_id,status,proposal_date desc);
create index proposals_lead_idx on public.proposals(lead_id,created_at desc);
create index proposals_assignee_idx on public.proposals(organization_id,assigned_to,status);

create table public.crm_notifications(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  kind text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  severity text not null default 'info' check(severity in ('info','attention','urgent')),
  action_view text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(user_id,dedupe_key)
);
create index crm_notifications_user_unread_idx on public.crm_notifications(user_id,created_at desc) where read_at is null;

alter table public.crm_automation_settings
  add column if not exists alert_upcoming_visits boolean not null default true,
  add column if not exists alert_stale_proposals boolean not null default true,
  add column if not exists proposal_stale_days smallint not null default 5 check(proposal_stale_days between 1 and 90);

alter table public.properties enable row level security; alter table public.properties force row level security;
alter table public.property_media enable row level security; alter table public.property_media force row level security;
alter table public.proposals enable row level security; alter table public.proposals force row level security;
alter table public.crm_notifications enable row level security; alter table public.crm_notifications force row level security;

create policy premium_properties_select on public.properties for select to authenticated
  using(public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy premium_properties_write on public.properties for all to authenticated
  using(public.current_membership_role(organization_id) in ('owner','manager'))
  with check(public.current_membership_role(organization_id) in ('owner','manager'));
create policy premium_property_media_select on public.property_media for select to authenticated
  using(public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy premium_property_media_write on public.property_media for all to authenticated
  using(public.current_membership_role(organization_id) in ('owner','manager'))
  with check(public.current_membership_role(organization_id) in ('owner','manager'));
create policy premium_proposals_select on public.proposals for select to authenticated
  using(public.can_access_lead(lead_id,organization_id));
create policy premium_proposals_write on public.proposals for all to authenticated
  using(public.can_access_lead(lead_id,organization_id))
  with check(public.can_access_lead(lead_id,organization_id) and (assigned_to is null or assigned_to=auth.uid() or public.current_membership_role(organization_id) in ('owner','manager')));
create policy premium_notifications_select on public.crm_notifications for select to authenticated
  using(user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy premium_notifications_update on public.crm_notifications for update to authenticated
  using(user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'))
  with check(user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'));

revoke all on public.properties,public.property_media,public.proposals,public.crm_notifications from public,anon,authenticated;
grant select on public.properties,public.property_media,public.proposals,public.crm_notifications to authenticated;
grant delete on public.properties,public.property_media,public.proposals to authenticated;
grant insert(organization_id,code,title,slug,purpose,property_type,description,price,city,state,neighborhood,public_address,total_area,total_area_unit,built_area,bedrooms,suites,bathrooms,parking_spaces,features,status,is_published,featured,video_url,publication_date,broker_name,broker_creci,disclosure,created_by,updated_by),
 update(code,title,slug,purpose,property_type,description,price,city,state,neighborhood,public_address,total_area,total_area_unit,built_area,bedrooms,suites,bathrooms,parking_spaces,features,status,is_published,featured,video_url,publication_date,broker_name,broker_creci,disclosure,updated_by) on public.properties to authenticated;
grant insert(organization_id,property_id,storage_path,sort_order,is_cover,alt_text,caption,media_kind),
 update(storage_path,sort_order,is_cover,alt_text,caption,media_kind) on public.property_media to authenticated;
grant insert(organization_id,lead_id,property_id,assigned_to,asking_price,proposed_price,counter_price,final_price,commission_expected,commission_received,proposal_date,closed_at,status,notes,created_by),
 update(lead_id,property_id,assigned_to,asking_price,proposed_price,counter_price,final_price,commission_expected,commission_received,proposal_date,closed_at,status,notes) on public.proposals to authenticated;
grant update(read_at) on public.crm_notifications to authenticated;
grant insert(preference_purpose,preference_max_area,preference_min_suites,preference_min_bathrooms,preference_min_parking,preference_features,preference_notes),
 update(preference_purpose,preference_max_area,preference_min_suites,preference_min_bathrooms,preference_min_parking,preference_features,preference_notes) on public.leads to authenticated;
grant update(alert_upcoming_visits,alert_stale_proposals,proposal_stale_days) on public.crm_automation_settings to authenticated;
grant update(full_name,phone,creci) on public.profiles to authenticated;

create trigger properties_updated before update on public.properties for each row execute function public.set_updated_at();
create trigger proposals_updated before update on public.proposals for each row execute function public.set_updated_at();

create or replace function public.audit_property_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.properties; action_name text;
begin r:=case when tg_op='DELETE' then old else new end; action_name:=case when tg_op='INSERT' then 'property_created' when tg_op='DELETE' then 'property_deleted' when old.is_published is distinct from new.is_published then case when new.is_published then 'property_published' else 'property_unpublished' end else 'property_updated' end;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(r.organization_id,auth.uid(),'property',r.id,action_name,jsonb_build_object('code',r.code,'status',r.status,'published',r.is_published)); return case when tg_op='DELETE' then old else new end; end $$;
create or replace function public.audit_proposal_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.proposals; action_name text;
begin r:=case when tg_op='DELETE' then old else new end; action_name:=case when tg_op='INSERT' then 'proposal_created' when tg_op='DELETE' then 'proposal_deleted' when old.status is distinct from new.status then 'proposal_status_changed' else 'proposal_updated' end;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(r.organization_id,auth.uid(),'proposal',r.id,action_name,jsonb_build_object('lead_id',r.lead_id,'status',r.status,'property_id',r.property_id)); return case when tg_op='DELETE' then old else new end; end $$;
create trigger properties_audit after insert or update or delete on public.properties for each row execute function public.audit_property_change();
create trigger proposals_audit after insert or update or delete on public.proposals for each row execute function public.audit_proposal_change();

create or replace function public.property_public_json(p public.properties)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.code,'codigo',p.code,'ativo',p.is_published,'destaque',p.featured,'titulo',p.title,'slug',p.slug,
  'finalidade',p.purpose,'tipo',p.property_type,'descricao',p.description,'preco',p.price,'cidade',p.city,'estado',p.state,
  'bairro',p.neighborhood,'enderecoExibir',p.public_address,'areaTotal',p.total_area,'unidadeAreaTotal',p.total_area_unit,
  'areaConstruida',p.built_area,'quartos',p.bedrooms,'suites',p.suites,'banheiros',p.bathrooms,'vagas',p.parking_spaces,
  'caracteristicas',to_jsonb(p.features),'video',coalesce(p.video_url,''),'dataPublicacao',coalesce(p.publication_date::text,''),
  'corretor',jsonb_build_object('nome',p.broker_name,'creci',p.broker_creci),'imagens',coalesce((select jsonb_agg(m.storage_path order by m.sort_order) from public.property_media m where m.property_id=p.id),'[]'::jsonb),
  'imagensAlt',coalesce((select jsonb_agg(coalesce(m.alt_text,'') order by m.sort_order) from public.property_media m where m.property_id=p.id),'[]'::jsonb),
  'legendasImagens',coalesce((select jsonb_agg(coalesce(m.caption,'') order by m.sort_order) from public.property_media m where m.property_id=p.id),'[]'::jsonb),
  'imagensTipo',case when exists(select 1 from public.property_media m where m.property_id=p.id and m.media_kind='project') then 'projeto' end,
  'capaTipo',(select m.media_kind from public.property_media m where m.property_id=p.id order by m.is_cover desc,m.sort_order limit 1))
$$;

create or replace function public.list_public_properties(target_hostname text default 'valdineycapistranoimoveis.com.br')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare target_org uuid;
begin
 select s.organization_id into target_org from public.organization_sites s where s.status='active' and s.hostname=lower(split_part(coalesce(target_hostname,''),':',1)) limit 1;
 if target_org is null and lower(split_part(coalesce(target_hostname,''),':',1)) in ('valdineycapistranoimoveis.com.br','www.valdineycapistranoimoveis.com.br','localhost','127.0.0.1') then
   select sub.organization_id into target_org from public.subscriptions sub where sub.is_current and sub.provider='internal' and coalesce((sub.metadata->>'billing_exempt')::boolean,false) order by sub.created_at limit 1;
 end if;
 return query select public.property_public_json(p) from public.properties p where p.organization_id=target_org and p.is_published and p.status in ('available','reserved') order by p.featured desc,p.publication_date desc nulls last,p.code;
end $$;
revoke all on function public.property_public_json(public.properties),public.list_public_properties(text) from public,anon,authenticated;
grant execute on function public.list_public_properties(text) to anon,authenticated;

create or replace function public.refresh_my_notifications(target_organization uuid)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare role_name text; inserted_count integer:=0; last_count integer:=0;
begin
 role_name:=public.current_membership_role(target_organization);
 if role_name not in ('owner','manager','agent') then raise exception using errcode='42501',message='Notification access denied'; end if;
 insert into public.crm_notifications(organization_id,user_id,dedupe_key,kind,title,body,entity_type,entity_id,severity,action_view,expires_at)
 select target_organization,auth.uid(),'lead-unassigned-'||l.id,'lead_unassigned','Lead sem responsável',l.name,'lead',l.id,'attention','leads',now()+interval '14 days'
 from public.leads l where l.organization_id=target_organization and l.assigned_to is null and role_name in ('owner','manager') and l.stage not in ('fechado','perdido')
 on conflict(user_id,dedupe_key) do nothing; get diagnostics inserted_count=row_count;
 insert into public.crm_notifications(organization_id,user_id,dedupe_key,kind,title,body,entity_type,entity_id,severity,action_view,expires_at)
 select target_organization,auth.uid(),'activity-'||a.id,'activity_due',case when a.scheduled_at<now() then 'Atividade vencida' else 'Atividade próxima' end,a.title,'appointment',a.id,case when a.scheduled_at<now() then 'urgent' else 'attention' end,'agenda',a.scheduled_at+interval '7 days'
 from public.appointments a join public.leads l on l.id=a.lead_id where a.organization_id=target_organization and a.status='agendado' and a.scheduled_at<now()+interval '24 hours' and public.can_access_lead(l.id,target_organization)
 on conflict(user_id,dedupe_key) do nothing; get diagnostics last_count=row_count; inserted_count:=inserted_count+last_count;
 delete from public.crm_notifications n where n.user_id=auth.uid() and n.expires_at<now();
 return inserted_count;
end $$;

create or replace function public.replace_property_media(target_property uuid, media_items jsonb)
returns setof public.property_media language plpgsql volatile security definer set search_path='' as $$
declare target_org uuid; item jsonb; item_index integer:=0;
begin
 select p.organization_id into target_org from public.properties p where p.id=target_property;
 if target_org is null or public.current_membership_role(target_org) not in ('owner','manager') then raise exception using errcode='42501',message='Property media access denied'; end if;
 if jsonb_typeof(coalesce(media_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(media_items,'[]'::jsonb))>100 then raise exception using errcode='22023',message='Invalid property media'; end if;
 delete from public.property_media where property_id=target_property;
 for item in select value from jsonb_array_elements(coalesce(media_items,'[]'::jsonb)) loop
  if coalesce(item->>'storage_path','')='' then raise exception using errcode='22023',message='Invalid media path'; end if;
  insert into public.property_media(organization_id,property_id,storage_path,sort_order,is_cover,alt_text,caption,media_kind)
  values(target_org,target_property,item->>'storage_path',item_index,item_index=0,nullif(item->>'alt_text',''),nullif(item->>'caption',''),case when item->>'media_kind'='project' then 'project' else 'photo' end);
  item_index:=item_index+1;
 end loop;
 return query select m.* from public.property_media m where m.property_id=target_property order by m.sort_order;
end $$;

create or replace function public.crm_global_search(target_organization uuid,target_query text,result_limit integer default 20)
returns table(kind text,entity_id uuid,title text,subtitle text,action_view text)
language plpgsql stable security definer set search_path='' as $$
declare q text:='%'||lower(trim(target_query))||'%'; lim integer:=least(greatest(coalesce(result_limit,20),1),50);
begin
 if public.current_membership_role(target_organization) not in ('owner','manager','agent') or length(trim(coalesce(target_query,'')))<2 then return; end if;
 return query
 select 'lead',l.id,l.name,coalesce(l.phone,l.whatsapp,l.email,'Lead'),'leads' from public.leads l where l.organization_id=target_organization and public.can_access_lead(l.id,target_organization) and lower(concat_ws(' ',l.name,l.phone,l.whatsapp,l.email,l.property_code)) like q
 union all select 'property',p.id,p.code||' — '||p.title,coalesce(p.neighborhood,p.city,'Imóvel'),'properties' from public.properties p where p.organization_id=target_organization and lower(concat_ws(' ',p.code,p.title,p.neighborhood,p.city)) like q
 union all select 'activity',a.id,a.title,l.name,'agenda' from public.appointments a join public.leads l on l.id=a.lead_id where a.organization_id=target_organization and public.can_access_lead(l.id,target_organization) and lower(concat_ws(' ',a.title,l.name)) like q limit lim;
end $$;

create or replace function public.get_assistant_briefing(target_organization uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text; result jsonb;
begin
 role_name:=public.current_membership_role(target_organization); if role_name not in ('owner','manager','agent') then raise exception using errcode='42501',message='Assistant access denied'; end if;
 select jsonb_build_object(
  'today_activities',(select count(*) from public.appointments a join public.leads l on l.id=a.lead_id where a.organization_id=target_organization and a.status='agendado' and a.scheduled_at>=date_trunc('day',now()) and a.scheduled_at<date_trunc('day',now())+interval '1 day' and public.can_access_lead(l.id,target_organization)),
  'tomorrow_activities',(select count(*) from public.appointments a join public.leads l on l.id=a.lead_id where a.organization_id=target_organization and a.status='agendado' and a.scheduled_at>=date_trunc('day',now())+interval '1 day' and a.scheduled_at<date_trunc('day',now())+interval '2 days' and public.can_access_lead(l.id,target_organization)),
  'overdue_followups',(select count(*) from public.appointments a join public.leads l on l.id=a.lead_id where a.organization_id=target_organization and a.status='agendado' and a.scheduled_at<now() and public.can_access_lead(l.id,target_organization)),
  'unassigned_leads',(select count(*) from public.leads l where l.organization_id=target_organization and l.assigned_to is null and l.stage not in ('fechado','perdido') and role_name in ('owner','manager')),
  'stale_leads',(select count(*) from public.leads l where l.organization_id=target_organization and l.updated_at<now()-interval '7 days' and l.stage not in ('fechado','perdido') and public.can_access_lead(l.id,target_organization)),
  'open_proposals',(select count(*) from public.proposals p where p.organization_id=target_organization and p.status in ('sent','negotiating') and public.can_access_lead(p.lead_id,target_organization)),
  'expected_commission',(select coalesce(sum(p.commission_expected),0) from public.proposals p where p.organization_id=target_organization and p.status='accepted' and public.can_access_lead(p.lead_id,target_organization)),
  'generated_at',now()) into result; return result;
end $$;

create or replace function public.get_site_status(target_organization uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_membership_role(target_organization) not in ('owner','manager','agent') then raise exception using errcode='42501',message='Site status access denied'; end if;
 return jsonb_build_object('configured',exists(select 1 from public.organization_sites s where s.organization_id=target_organization and s.status='active'),
  'hostname',(select s.hostname from public.organization_sites s where s.organization_id=target_organization and s.status='active' limit 1),
  'published_properties',(select count(*) from public.properties p where p.organization_id=target_organization and p.is_published),
  'last_site_lead_at',(select max(l.created_at) from public.leads l where l.organization_id=target_organization and l.origin='site'),
  'checked_at',now());
end $$;

create or replace function public.list_lead_activity(target_lead uuid,result_limit integer default 100)
returns table(id uuid,actor_id uuid,action text,metadata jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare target_org uuid;
begin
 select l.organization_id into target_org from public.leads l where l.id=target_lead;
 if not coalesce(public.can_access_lead(target_lead,target_org),false) then raise exception using errcode='42501',message='Lead activity access denied'; end if;
 return query select a.id,a.actor_id,a.action,a.metadata,a.created_at from public.audit_events a where a.organization_id=target_org and (
  (a.entity_type='lead' and a.entity_id=target_lead and a.action in ('lead_stage_changed','lead_note_created','lead_assigned','lead_transferred','lead_interest_added','lead_interest_removed'))
  or (a.entity_type='appointment' and a.metadata->>'lead_id'=target_lead::text and a.action in ('activity_created','activity_rescheduled','activity_status_changed'))
  or (a.entity_type='proposal' and a.metadata->>'lead_id'=target_lead::text and a.action in ('proposal_created','proposal_updated','proposal_status_changed','proposal_deleted')))
 order by a.created_at desc,a.id desc limit least(greatest(coalesce(result_limit,100),1),200);
end $$;

do $$ declare signature text; begin foreach signature in array array[
 'refresh_my_notifications(uuid)','replace_property_media(uuid,jsonb)','crm_global_search(uuid,text,integer)','get_assistant_briefing(uuid)','get_site_status(uuid)'] loop
 execute format('revoke all on function public.%s from public,anon',signature); execute format('grant execute on function public.%s to authenticated',signature); end loop; end $$;
revoke all on function public.audit_property_change(),public.audit_proposal_change() from public,anon,authenticated;

-- Planos entregam capacidades reais; START preserva o CRM essencial.
insert into public.plan_entitlements(plan_id,entitlement_key,enabled,limit_value)
select p.id,e.key,true,null from public.plans p join (values
 ('start','crm.property_management'),('start','crm.basic_reports'),
 ('pro','crm.property_management'),('pro','crm.basic_reports'),('pro','crm.proposals'),('pro','crm.notifications'),('pro','crm.matching.center'),('pro','crm.assistant'),
 ('equipe','crm.property_management'),('equipe','crm.basic_reports'),('equipe','crm.proposals'),('equipe','crm.notifications'),('equipe','crm.matching.center'),('equipe','crm.assistant'),('equipe','team.operations_dashboard')
) e(code,key) on e.code=p.code on conflict(plan_id,entitlement_key) do update set enabled=true;

-- Vincula o domínio ao único tenant interno já auditado, sem afetar clientes.
insert into public.organization_sites(organization_id,hostname,status)
select s.organization_id,'valdineycapistranoimoveis.com.br','active' from public.subscriptions s
where s.is_current and s.provider='internal' and coalesce((s.metadata->>'billing_exempt')::boolean,false)
order by s.created_at limit 1
on conflict do nothing;

-- Fotos públicas dos anúncios; gravação limitada ao prefixo do tenant e a owner/manager.
-- O bloco dinâmico mantém compatibilidade com o runner PGlite, que não emula Storage.
do $$ begin if to_regnamespace('storage') is not null then
 execute $storage$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('property-media','property-media',true,15728640,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$storage$;
 execute 'drop policy if exists premium_property_media_insert on storage.objects';
 execute 'drop policy if exists premium_property_media_update on storage.objects';
 execute 'drop policy if exists premium_property_media_delete on storage.objects';
 execute $storage$create policy premium_property_media_insert on storage.objects for insert to authenticated with check(bucket_id='property-media' and public.current_membership_role((storage.foldername(name))[1]::uuid) in ('owner','manager'))$storage$;
 execute $storage$create policy premium_property_media_update on storage.objects for update to authenticated using(bucket_id='property-media' and public.current_membership_role((storage.foldername(name))[1]::uuid) in ('owner','manager')) with check(bucket_id='property-media' and public.current_membership_role((storage.foldername(name))[1]::uuid) in ('owner','manager'))$storage$;
 execute $storage$create policy premium_property_media_delete on storage.objects for delete to authenticated using(bucket_id='property-media' and public.current_membership_role((storage.foldername(name))[1]::uuid) in ('owner','manager'))$storage$;
end if; end $$;

commit;

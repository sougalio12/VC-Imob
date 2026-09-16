-- Imoveis 2.0 e experiencia privada do cliente. Estruturas aditivas e tenant-scoped.
begin;

create table public.property_change_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  change_kind text not null check (change_kind in ('price','status','publication')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index property_change_history_property_idx on public.property_change_history(property_id,created_at desc);

create table public.property_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  expires_at timestamptz not null default now()+interval '30 days',
  updated_at timestamptz not null default now(),
  unique(user_id,property_id)
);
create unique index property_drafts_new_per_user_idx on public.property_drafts(user_id) where property_id is null;

create table public.client_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 1 and 120),
  note text,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_selections_org_lead_idx on public.client_selections(organization_id,lead_id,created_at desc);

create table public.client_selection_items (
  selection_id uuid not null references public.client_selections(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  sort_order smallint not null check(sort_order between 0 and 100),
  broker_note text,
  primary key(selection_id,property_id), unique(selection_id,sort_order)
);

create table public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  selection_id uuid not null references public.client_selections(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reaction text not null check(reaction in ('liked','maybe','disliked','visit_requested')),
  comment text check(comment is null or char_length(comment)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(selection_id,property_id)
);
create index client_feedback_org_created_idx on public.client_feedback(organization_id,created_at desc);

create table public.post_visit_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  outcome text not null check(outcome in ('liked','unsure','disliked')),
  objections text[] not null default '{}',
  positive_points text,
  proposal_intent boolean,
  decision_timeframe text,
  next_step text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index post_visit_feedback_lead_idx on public.post_visit_feedback(lead_id,created_at desc);

alter table public.leads add column if not exists loss_reason text;
alter table public.leads add column if not exists loss_notes text;
alter table public.leads add constraint leads_loss_reason_check check(loss_reason is null or loss_reason in ('price','financing','property_sold','location','gave_up','competitor','no_response','timing','other'));

alter table public.property_change_history enable row level security; alter table public.property_change_history force row level security;
alter table public.property_drafts enable row level security; alter table public.property_drafts force row level security;
alter table public.client_selections enable row level security; alter table public.client_selections force row level security;
alter table public.client_selection_items enable row level security; alter table public.client_selection_items force row level security;
alter table public.client_feedback enable row level security; alter table public.client_feedback force row level security;
alter table public.post_visit_feedback enable row level security; alter table public.post_visit_feedback force row level security;

create policy property_history_read on public.property_change_history for select to authenticated using(public.current_membership_role(organization_id) in ('owner','manager','agent'));
create policy property_drafts_own on public.property_drafts for all to authenticated using(user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager')) with check(user_id=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager'));
create policy client_selections_read on public.client_selections for select to authenticated using(public.can_access_lead(lead_id,organization_id));
create policy client_selection_items_read on public.client_selection_items for select to authenticated using(exists(select 1 from public.client_selections s where s.id=selection_id and public.can_access_lead(s.lead_id,s.organization_id)));
create policy client_feedback_read on public.client_feedback for select to authenticated using(exists(select 1 from public.client_selections s where s.id=selection_id and public.can_access_lead(s.lead_id,s.organization_id)));
create policy post_visit_feedback_read on public.post_visit_feedback for select to authenticated using(public.can_access_lead(lead_id,organization_id));

revoke all on public.property_change_history,public.property_drafts,public.client_selections,public.client_selection_items,public.client_feedback,public.post_visit_feedback from public,anon,authenticated;
grant select on public.property_change_history,public.client_selections,public.client_selection_items,public.client_feedback,public.post_visit_feedback to authenticated;
grant select,insert,update,delete on public.property_drafts to authenticated;

create trigger property_drafts_updated before update on public.property_drafts for each row execute function public.set_updated_at();
create trigger client_feedback_updated before update on public.client_feedback for each row execute function public.set_updated_at();
create trigger post_visit_feedback_updated before update on public.post_visit_feedback for each row execute function public.set_updated_at();

create function public.record_property_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.price is distinct from new.price then insert into public.property_change_history(organization_id,property_id,actor_id,change_kind,old_value,new_value) values(new.organization_id,new.id,auth.uid(),'price',old.price::text,new.price::text); end if;
  if old.status is distinct from new.status then insert into public.property_change_history(organization_id,property_id,actor_id,change_kind,old_value,new_value) values(new.organization_id,new.id,auth.uid(),'status',old.status,new.status); end if;
  if old.is_published is distinct from new.is_published then insert into public.property_change_history(organization_id,property_id,actor_id,change_kind,old_value,new_value) values(new.organization_id,new.id,auth.uid(),'publication',old.is_published::text,new.is_published::text); end if;
  return new;
end $$;
create trigger property_change_history_trigger after update on public.properties for each row execute function public.record_property_history();

create function public.duplicate_crm_property(target_organization uuid,target_property uuid,new_code text,new_title text default null)
returns public.properties language plpgsql volatile security definer set search_path='' as $$
declare source public.properties; copied public.properties;
begin
 if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501',message='Property access denied'; end if;
 select * into source from public.properties where id=target_property and organization_id=target_organization;
 if source.id is null or new_code !~ '^VCI[0-9]{6}$' then raise exception using errcode='22023',message='Invalid property duplication'; end if;
 insert into public.properties(organization_id,code,title,slug,purpose,property_type,description,price,city,state,neighborhood,public_address,total_area,total_area_unit,built_area,bedrooms,suites,bathrooms,parking_spaces,features,status,is_published,featured,video_url,broker_name,broker_creci,disclosure,created_by,updated_by)
 values(target_organization,new_code,coalesce(nullif(trim(new_title),''),source.title||' — cópia'),lower(new_code),source.purpose,source.property_type,source.description,source.price,source.city,source.state,source.neighborhood,source.public_address,source.total_area,source.total_area_unit,source.built_area,source.bedrooms,source.suites,source.bathrooms,source.parking_spaces,source.features,'draft',false,false,source.video_url,source.broker_name,source.broker_creci,source.disclosure,auth.uid(),auth.uid()) returning * into copied;
 insert into public.property_media(organization_id,property_id,storage_path,sort_order,is_cover,alt_text,caption,media_kind)
 select target_organization,copied.id,storage_path,sort_order,is_cover,alt_text,caption,media_kind from public.property_media where property_id=source.id;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'property',copied.id,'property_duplicated',jsonb_build_object('source_property_id',source.id,'new_code',new_code));
 return copied;
end $$;

create function public.create_client_selection(target_organization uuid,target_lead uuid,target_title text,target_note text,target_property_ids uuid[],target_expires_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare selection_id uuid; raw_token text:=encode(gen_random_bytes(32),'hex'); item_id uuid; position smallint:=0;
begin
 if not public.can_access_lead(target_lead,target_organization) then raise exception using errcode='42501',message='Lead access denied'; end if;
 if coalesce(array_length(target_property_ids,1),0) not between 1 and 20 then raise exception using errcode='22023',message='Select between 1 and 20 properties'; end if;
 if exists(select 1 from unnest(target_property_ids) p(id) left join public.properties x on x.id=p.id and x.organization_id=target_organization and x.is_published where x.id is null) then raise exception using errcode='42501',message='Invalid property selection'; end if;
 insert into public.client_selections(organization_id,lead_id,title,note,token_hash,created_by,expires_at) values(target_organization,target_lead,trim(target_title),nullif(trim(target_note),''),encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),coalesce(target_expires_at,now()+interval '30 days')) returning id into selection_id;
 foreach item_id in array target_property_ids loop insert into public.client_selection_items(selection_id,property_id,sort_order) values(selection_id,item_id,position); position:=position+1; end loop;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'client_selection',selection_id,'selection_created',jsonb_build_object('lead_id',target_lead,'property_count',position));
 return jsonb_build_object('id',selection_id,'token',raw_token,'expires_at',coalesce(target_expires_at,now()+interval '30 days'));
end $$;

create function public.revoke_client_selection(target_organization uuid,target_selection uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 update public.client_selections set revoked_at=now() where id=target_selection and organization_id=target_organization and public.can_access_lead(lead_id,organization_id);
 if not found then raise exception using errcode='42501',message='Selection access denied'; end if;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action) values(target_organization,auth.uid(),'client_selection',target_selection,'selection_revoked');
end $$;

create function public.get_client_selection(selection_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',s.title,'note',s.note,'expires_at',s.expires_at,'properties',coalesce(jsonb_agg(public.property_public_json(p)||jsonb_build_object('selection_property_id',p.id) order by i.sort_order) filter(where p.id is not null),'[]'::jsonb))
 from public.client_selections s join public.client_selection_items i on i.selection_id=s.id join public.properties p on p.id=i.property_id and p.organization_id=s.organization_id and p.is_published
 where s.token_hash=encode(extensions.digest(selection_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() group by s.id
$$;

create function public.submit_client_feedback(selection_token text,target_property uuid,target_reaction text,target_comment text default null) returns void language plpgsql volatile security definer set search_path='' as $$
declare s public.client_selections;
begin
 select * into s from public.client_selections where token_hash=encode(extensions.digest(selection_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
 if s.id is null or target_reaction not in ('liked','maybe','disliked','visit_requested') or not exists(select 1 from public.client_selection_items where selection_id=s.id and property_id=target_property) then raise exception using errcode='22023',message='Invalid selection feedback'; end if;
 insert into public.client_feedback(organization_id,selection_id,property_id,reaction,comment) values(s.organization_id,s.id,target_property,target_reaction,nullif(left(trim(target_comment),1000),'')) on conflict(selection_id,property_id) do update set reaction=excluded.reaction,comment=excluded.comment,updated_at=now();
end $$;

create function public.save_post_visit_feedback(target_organization uuid,target_appointment uuid,target_property uuid,target_outcome text,target_objections text[],target_positive_points text,target_proposal_intent boolean,target_decision_timeframe text,target_next_step text)
returns public.post_visit_feedback language plpgsql volatile security definer set search_path='' as $$
declare visit public.appointments; saved public.post_visit_feedback;
begin
 select * into visit from public.appointments where id=target_appointment and organization_id=target_organization and kind='visita';
 if visit.id is null or not public.can_access_lead(visit.lead_id,target_organization) then raise exception using errcode='42501',message='Visit access denied'; end if;
 if target_property is not null and not exists(select 1 from public.properties where id=target_property and organization_id=target_organization) then raise exception using errcode='42501',message='Property access denied'; end if;
 insert into public.post_visit_feedback(organization_id,appointment_id,lead_id,property_id,outcome,objections,positive_points,proposal_intent,decision_timeframe,next_step,created_by)
 values(target_organization,target_appointment,visit.lead_id,target_property,target_outcome,coalesce(target_objections,'{}'),nullif(trim(target_positive_points),''),target_proposal_intent,nullif(trim(target_decision_timeframe),''),nullif(trim(target_next_step),''),auth.uid())
 on conflict(appointment_id) do update set property_id=excluded.property_id,outcome=excluded.outcome,objections=excluded.objections,positive_points=excluded.positive_points,proposal_intent=excluded.proposal_intent,decision_timeframe=excluded.decision_timeframe,next_step=excluded.next_step,updated_at=now() returning * into saved;
 return saved;
end $$;

create function public.find_duplicate_leads(target_organization uuid,target_phone text default null,target_email text default null,target_name text default null)
returns table(id uuid,name text,phone text,email text,match_reason text) language sql stable security definer set search_path='' as $$
 select l.id,l.name,l.phone,l.email,case when regexp_replace(coalesce(l.phone,l.whatsapp,''),'\D','','g')=regexp_replace(coalesce(target_phone,''),'\D','','g') and length(regexp_replace(coalesce(target_phone,''),'\D','','g'))>=10 then 'phone' when lower(l.email)=lower(trim(target_email)) then 'email' else 'name_contact' end
 from public.leads l where l.organization_id=target_organization and public.can_access_lead(l.id,target_organization) and ((length(regexp_replace(coalesce(target_phone,''),'\D','','g'))>=10 and regexp_replace(coalesce(l.phone,l.whatsapp,''),'\D','','g')=regexp_replace(target_phone,'\D','','g')) or (coalesce(trim(target_email),'')<>'' and lower(l.email)=lower(trim(target_email))) or (coalesce(trim(target_name),'')<>'' and lower(trim(l.name))=lower(trim(target_name)) and (target_phone is not null or target_email is not null))) limit 20
$$;

do $$ declare signature text; begin foreach signature in array array[
 'duplicate_crm_property(uuid,uuid,text,text)','create_client_selection(uuid,uuid,text,text,uuid[],timestamptz)','revoke_client_selection(uuid,uuid)','save_post_visit_feedback(uuid,uuid,uuid,text,text[],text,boolean,text,text)','find_duplicate_leads(uuid,text,text,text)'
] loop execute format('revoke all on function public.%s from public,anon,authenticated',signature); execute format('grant execute on function public.%s to authenticated',signature); end loop;
revoke all on function public.get_client_selection(text),public.submit_client_feedback(text,uuid,text,text),public.record_property_history() from public,anon,authenticated;
grant execute on function public.get_client_selection(text),public.submit_client_feedback(text,uuid,text,text) to anon,authenticated;
end $$;

commit;

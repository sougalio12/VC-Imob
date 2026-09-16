begin;

create table public.lead_commercial_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  memory_kind text not null check (memory_kind in ('objection','preference','contact','next_step','visit_feedback','note')),
  content text not null check (length(trim(content)) between 1 and 2000),
  structured_data jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_data)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index lead_commercial_memory_lead_idx on public.lead_commercial_memory(organization_id,lead_id,created_at desc) where archived_at is null;

create table public.assistant_action_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  action_kind text not null check (action_kind in ('create_activity','create_lead','create_proposal')),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in ('pending','confirmed','expired','canceled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  confirmed_at timestamptz
);
create index assistant_action_previews_user_idx on public.assistant_action_previews(requested_by,status,expires_at desc);

alter table public.lead_commercial_memory enable row level security;
alter table public.lead_commercial_memory force row level security;
alter table public.assistant_action_previews enable row level security;
alter table public.assistant_action_previews force row level security;
revoke all on public.lead_commercial_memory,public.assistant_action_previews from public,anon,authenticated;
grant select,insert,update on public.lead_commercial_memory to authenticated;
grant select on public.assistant_action_previews to authenticated;

create policy lead_memory_select on public.lead_commercial_memory for select to authenticated
 using(public.can_access_lead(lead_id,organization_id));
create policy lead_memory_insert on public.lead_commercial_memory for insert to authenticated
 with check(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id));
create policy lead_memory_update on public.lead_commercial_memory for update to authenticated
 using(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id))
 with check(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id));
create policy assistant_preview_select on public.assistant_action_previews for select to authenticated
 using(requested_by=auth.uid() and public.current_membership_role(organization_id) in ('owner','manager','agent'));

create or replace function public.prepare_assistant_action(target_organization uuid,target_kind text,target_payload jsonb)
returns public.assistant_action_previews language plpgsql volatile security definer set search_path='' as $$
declare saved public.assistant_action_previews; target_lead uuid;
begin
 if public.current_membership_role(target_organization) not in ('owner','manager','agent') or not public.can_use_entitlement(target_organization,'crm.assistant') then
  raise exception using errcode='42501',message='ASSISTANT_ACCESS_DENIED';
 end if;
 if target_kind not in ('create_activity','create_lead','create_proposal') or jsonb_typeof(coalesce(target_payload,'null'::jsonb))<>'object' then
  raise exception using errcode='22023',message='ASSISTANT_INVALID_ACTION';
 end if;
 if length(target_payload::text)>12000 then raise exception using errcode='22023',message='ASSISTANT_PAYLOAD_TOO_LARGE'; end if;
 if target_payload ?| array['organization_id','role','provider','entitlement','trial_ends_at'] then raise exception using errcode='22023',message='ASSISTANT_PROTECTED_FIELD'; end if;
 target_lead:=nullif(target_payload->>'lead_id','')::uuid;
 if target_lead is not null and not public.can_access_lead(target_lead,target_organization) then raise exception using errcode='42501',message='ASSISTANT_LEAD_ACCESS_DENIED'; end if;
 if (select count(*) from public.assistant_action_previews p where p.requested_by=auth.uid() and p.created_at>now()-interval '1 minute')>=10 then
  raise exception using errcode='P0001',message='ASSISTANT_RATE_LIMITED';
 end if;
 insert into public.assistant_action_previews(organization_id,requested_by,action_kind,payload)
 values(target_organization,auth.uid(),target_kind,target_payload) returning * into saved;
 return saved;
end $$;

create or replace function public.confirm_assistant_action(target_preview uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare preview public.assistant_action_previews; result jsonb; saved_activity public.appointments; saved_lead public.leads; saved_proposal public.proposals;
begin
 select * into preview from public.assistant_action_previews where id=target_preview and requested_by=auth.uid() for update;
 if not found or preview.status<>'pending' or preview.expires_at<=now() then raise exception using errcode='22023',message='ASSISTANT_PREVIEW_EXPIRED'; end if;
 if public.current_membership_role(preview.organization_id) not in ('owner','manager','agent') or not public.can_use_entitlement(preview.organization_id,'crm.assistant') then raise exception using errcode='42501',message='ASSISTANT_ACCESS_DENIED'; end if;
 if preview.action_kind='create_activity' then
  saved_activity:=public.save_crm_activity(preview.organization_id,null,(preview.payload->>'lead_id')::uuid,auth.uid(),
    preview.payload->>'kind',preview.payload->>'title',(preview.payload->>'scheduled_at')::timestamptz,
    coalesce((preview.payload->>'priority')::integer,2),preview.payload->>'notes');
  result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_activity.id);
 elsif preview.action_kind='create_lead' then
  saved_lead:=public.save_crm_lead(preview.organization_id,null,null,preview.payload);
  result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_lead.id);
 else
  if not public.can_access_lead((preview.payload->>'lead_id')::uuid,preview.organization_id) then raise exception using errcode='42501',message='ASSISTANT_LEAD_ACCESS_DENIED'; end if;
  if nullif(preview.payload->>'property_id','') is not null and not exists(select 1 from public.properties p where p.id=(preview.payload->>'property_id')::uuid and p.organization_id=preview.organization_id) then raise exception using errcode='42501',message='ASSISTANT_PROPERTY_ACCESS_DENIED'; end if;
  insert into public.proposals(organization_id,lead_id,property_id,assigned_to,asking_price,proposed_price,proposal_date,status,notes,created_by)
  values(preview.organization_id,(preview.payload->>'lead_id')::uuid,nullif(preview.payload->>'property_id','')::uuid,auth.uid(),
    nullif(preview.payload->>'asking_price','')::numeric,nullif(preview.payload->>'proposed_price','')::numeric,
    coalesce(nullif(preview.payload->>'proposal_date','')::date,current_date),'draft',nullif(preview.payload->>'notes',''),auth.uid()) returning * into saved_proposal;
  result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_proposal.id);
 end if;
 update public.assistant_action_previews set status='confirmed',confirmed_at=now() where id=preview.id;
 insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
 values(preview.organization_id,auth.uid(),'assistant_action',preview.id,'assistant_action_confirmed',jsonb_build_object('kind',preview.action_kind,'entity_id',result->>'entity_id'));
 return result;
end $$;

create or replace function public.get_lead_commercial_summary(target_lead uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_org uuid; result jsonb;
begin
 select organization_id into target_org from public.leads where id=target_lead;
 if target_org is null or not public.can_access_lead(target_lead,target_org) then raise exception using errcode='42501',message='LEAD_SUMMARY_ACCESS_DENIED'; end if;
 select jsonb_build_object('lead',jsonb_build_object('id',l.id,'name',l.name,'stage',l.stage,'budget',l.budget,'region',l.desired_region,'updated_at',l.updated_at),
  'activities',(select coalesce(jsonb_agg(jsonb_build_object('kind',a.kind,'title',a.title,'scheduled_at',a.scheduled_at,'status',a.status) order by a.scheduled_at desc),'[]'::jsonb) from public.appointments a where a.lead_id=l.id),
  'proposals',(select coalesce(jsonb_agg(jsonb_build_object('status',p.status,'value',coalesce(p.final_price,p.counter_price,p.proposed_price),'updated_at',p.updated_at) order by p.updated_at desc),'[]'::jsonb) from public.proposals p where p.lead_id=l.id),
  'memory',(select coalesce(jsonb_agg(jsonb_build_object('kind',m.memory_kind,'content',m.content,'data',m.structured_data,'created_at',m.created_at) order by m.created_at desc),'[]'::jsonb) from public.lead_commercial_memory m where m.lead_id=l.id and m.archived_at is null)) into result
 from public.leads l where l.id=target_lead; return result;
end $$;

revoke all on function public.prepare_assistant_action(uuid,text,jsonb),public.confirm_assistant_action(uuid),public.get_lead_commercial_summary(uuid) from public,anon,authenticated;
grant execute on function public.prepare_assistant_action(uuid,text,jsonb),public.confirm_assistant_action(uuid),public.get_lead_commercial_summary(uuid) to authenticated;
comment on table public.assistant_action_previews is 'Preview curto, confirmado e auditado antes de qualquer mutacao do Assistente VC.';
comment on table public.lead_commercial_memory is 'Memoria comercial estruturada tenant-scoped; nao contem memoria livre de modelo generativo.';

commit;

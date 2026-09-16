-- Corrige incompatibilidades detectadas pelo lint remoto após o Bloco 4.
-- Mantém o undo restrito aos campos que existem no modelo atual de leads.
begin;

alter table public.lead_undo_actions
  drop constraint if exists lead_undo_actions_field_name_check;

alter table public.lead_undo_actions
  add constraint lead_undo_actions_field_name_check
  check (field_name in ('stage','assigned_to'));

create or replace function public.change_lead_with_undo(
  target_organization uuid,
  target_lead uuid,
  target_expected_updated_at timestamptz,
  target_field text,
  target_value text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  current_lead public.leads;
  saved_lead public.leads;
  old_value text;
  normalized_value text;
  action_id uuid;
  role_name text:=public.current_membership_role(target_organization);
begin
  select * into current_lead
  from public.leads
  where id=target_lead and organization_id=target_organization
  for update;

  if current_lead.id is null or not public.can_access_lead(target_lead,target_organization) then
    raise exception using errcode='42501',message='LEAD_UNDO_ACCESS_DENIED';
  end if;
  if target_expected_updated_at is not null
    and date_trunc('milliseconds',current_lead.updated_at) is distinct from date_trunc('milliseconds',target_expected_updated_at) then
    raise exception using errcode='40001',message='CRM_LEAD_CONFLICT';
  end if;

  if target_field='stage' then
    if target_value is null or target_value not in ('novo','atendimento','visita','negociacao','fechado','perdido') then
      raise exception using errcode='22023',message='LEAD_STAGE_INVALID';
    end if;
    old_value:=current_lead.stage;
    normalized_value:=target_value;
    update public.leads set stage=normalized_value where id=target_lead;
  elsif target_field='assigned_to' then
    if role_name not in ('owner','manager') then
      raise exception using errcode='42501',message='LEAD_ASSIGNMENT_ACCESS_DENIED';
    end if;
    old_value:=current_lead.assigned_to::text;
    normalized_value:=nullif(target_value,'');
    if normalized_value is not null and not exists(
      select 1 from public.organization_members m
      where m.organization_id=target_organization
        and m.user_id=normalized_value::uuid
        and m.status='active'
    ) then
      raise exception using errcode='23514',message='LEAD_ASSIGNEE_INVALID';
    end if;
    update public.leads set assigned_to=normalized_value::uuid where id=target_lead;
  else
    raise exception using errcode='22023',message='LEAD_UNDO_FIELD_INVALID';
  end if;

  insert into public.lead_undo_actions(organization_id,lead_id,actor_id,field_name,before_value,after_value)
    values(target_organization,target_lead,auth.uid(),target_field,old_value,normalized_value)
    returning id into action_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead',target_lead,'lead_change_with_undo',
      jsonb_build_object('field',target_field,'undo_id',action_id));
  select * into saved_lead from public.leads where id=target_lead;
  return jsonb_build_object('lead',to_jsonb(saved_lead),'undo_id',action_id,'expires_at',now()+interval '10 minutes');
end $$;

create or replace function public.undo_lead_change(target_organization uuid,target_action uuid)
returns public.leads
language plpgsql volatile security definer set search_path='' as $$
declare
  action_row public.lead_undo_actions;
  current_lead public.leads;
  result public.leads;
begin
  select * into action_row
  from public.lead_undo_actions
  where id=target_action and organization_id=target_organization and actor_id=auth.uid()
  for update;
  if action_row.id is null or action_row.consumed_at is not null or action_row.expires_at<now()
    or not public.can_access_lead(action_row.lead_id,target_organization) then
    raise exception using errcode='42501',message='LEAD_UNDO_UNAVAILABLE';
  end if;

  select * into current_lead
  from public.leads
  where id=action_row.lead_id and organization_id=target_organization
  for update;
  if current_lead.id is null then
    raise exception using errcode='42501',message='LEAD_UNDO_UNAVAILABLE';
  end if;

  if action_row.field_name='stage' then
    if current_lead.stage is distinct from action_row.after_value then
      raise exception using errcode='40001',message='LEAD_UNDO_CONFLICT';
    end if;
    update public.leads set stage=action_row.before_value where id=action_row.lead_id;
  elsif action_row.field_name='assigned_to' then
    if current_lead.assigned_to::text is distinct from nullif(action_row.after_value,'') then
      raise exception using errcode='40001',message='LEAD_UNDO_CONFLICT';
    end if;
    update public.leads set assigned_to=nullif(action_row.before_value,'')::uuid where id=action_row.lead_id;
  else
    raise exception using errcode='22023',message='LEAD_UNDO_FIELD_INVALID';
  end if;

  update public.lead_undo_actions set consumed_at=now() where id=action_row.id;
  select * into result from public.leads where id=action_row.lead_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(target_organization,auth.uid(),'lead',action_row.lead_id,'lead_change_undone',
      jsonb_build_object('field',action_row.field_name,'undo_id',action_row.id));
  return result;
end $$;

create or replace function public.confirm_assistant_action(target_preview uuid)
returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  preview public.assistant_action_previews;
  result jsonb;
  saved_activity public.appointments;
  saved_lead public.leads;
  saved_proposal public.proposals;
begin
  select * into preview
  from public.assistant_action_previews
  where id=target_preview and requested_by=auth.uid()
  for update;
  if not found or preview.status<>'pending' or preview.expires_at<=now() then
    raise exception using errcode='22023',message='ASSISTANT_PREVIEW_EXPIRED';
  end if;
  if public.current_membership_role(preview.organization_id) not in ('owner','manager','agent')
    or not public.can_use_entitlement(preview.organization_id,'crm.assistant') then
    raise exception using errcode='42501',message='ASSISTANT_ACCESS_DENIED';
  end if;

  if preview.action_kind='create_activity' then
    saved_activity:=public.save_crm_activity(
      preview.organization_id,
      null::uuid,
      (preview.payload->>'lead_id')::uuid,
      auth.uid(),
      preview.payload->>'kind',
      preview.payload->>'title',
      (preview.payload->>'scheduled_at')::timestamptz,
      coalesce((preview.payload->>'priority')::smallint,2::smallint),
      preview.payload->>'notes'
    );
    result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_activity.id);
  elsif preview.action_kind='create_lead' then
    saved_lead:=public.save_crm_lead(preview.organization_id,null,null,preview.payload);
    result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_lead.id);
  else
    if not public.can_access_lead((preview.payload->>'lead_id')::uuid,preview.organization_id) then
      raise exception using errcode='42501',message='ASSISTANT_LEAD_ACCESS_DENIED';
    end if;
    if nullif(preview.payload->>'property_id','') is not null and not exists(
      select 1 from public.properties p
      where p.id=(preview.payload->>'property_id')::uuid and p.organization_id=preview.organization_id
    ) then
      raise exception using errcode='42501',message='ASSISTANT_PROPERTY_ACCESS_DENIED';
    end if;
    insert into public.proposals(
      organization_id,lead_id,property_id,assigned_to,asking_price,proposed_price,
      proposal_date,status,notes,created_by
    ) values(
      preview.organization_id,(preview.payload->>'lead_id')::uuid,
      nullif(preview.payload->>'property_id','')::uuid,auth.uid(),
      nullif(preview.payload->>'asking_price','')::numeric,
      nullif(preview.payload->>'proposed_price','')::numeric,
      coalesce(nullif(preview.payload->>'proposal_date','')::date,current_date),
      'draft',nullif(preview.payload->>'notes',''),auth.uid()
    ) returning * into saved_proposal;
    result:=jsonb_build_object('kind',preview.action_kind,'entity_id',saved_proposal.id);
  end if;

  update public.assistant_action_previews
  set status='confirmed',confirmed_at=now()
  where id=preview.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
    values(preview.organization_id,auth.uid(),'assistant_action',preview.id,'assistant_action_confirmed',
      jsonb_build_object('kind',preview.action_kind,'entity_id',result->>'entity_id'));
  return result;
end $$;

revoke all on function public.change_lead_with_undo(uuid,uuid,timestamptz,text,text),
  public.undo_lead_change(uuid,uuid),public.confirm_assistant_action(uuid)
  from public,anon,authenticated;
grant execute on function public.change_lead_with_undo(uuid,uuid,timestamptz,text,text),
  public.undo_lead_change(uuid,uuid),public.confirm_assistant_action(uuid)
  to authenticated;

commit;

-- Fase D: gestao segura de equipe, convites, atribuicao de leads e auditoria.

begin;

alter table public.organizations
  add column if not exists team_member_limit_override integer
  check (team_member_limit_override is null or team_member_limit_override between 1 and 30);

create unique index if not exists invitations_one_pending_email_per_org_idx
  on public.invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table public.organization_members force row level security;
alter table public.invitations force row level security;
alter table public.audit_events force row level security;

revoke all on table public.organization_members, public.invitations, public.audit_events from public, anon, authenticated;

create or replace function public.team_member_limit(target_organization uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    organization.team_member_limit_override,
    (
      select entitlement.limit_value
      from public.subscriptions as subscription
      join public.plans as plan on plan.id = subscription.plan_id
      join public.plan_entitlements as entitlement
        on entitlement.plan_id = plan.id
       and entitlement.entitlement_key = 'team.members'
       and entitlement.enabled
      where subscription.organization_id = target_organization
        and subscription.status in ('trialing', 'active', 'past_due', 'grace_period')
      order by subscription.created_at desc
      limit 1
    ),
    1
  )::integer
  from public.organizations as organization
  where organization.id = target_organization;
$$;

create or replace function public.list_team_members(target_organization uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  joined_at timestamptz,
  can_manage boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller_role text;
begin
  caller_role := public.current_membership_role(target_organization);
  if caller_role not in ('owner', 'manager') then
    raise exception using errcode = '42501', message = 'Team management access denied';
  end if;

  return query
  select member.user_id, profile.full_name, auth_user.email::text, member.role,
    member.status, member.created_at,
    case when caller_role = 'owner' then member.role <> 'owner' else member.role = 'agent' end
  from public.organization_members as member
  join public.profiles as profile on profile.id = member.user_id
  join auth.users as auth_user on auth_user.id = member.user_id
  where member.organization_id = target_organization
    and (caller_role = 'owner' or member.role = 'agent' or member.user_id = auth.uid())
  order by case member.role when 'owner' then 1 when 'manager' then 2 else 3 end,
    lower(profile.full_name), member.created_at;
end;
$$;

create or replace function public.list_pending_invitations(target_organization uuid)
returns table (invitation_id uuid, email text, role text, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare caller_role text;
begin
  caller_role := public.current_membership_role(target_organization);
  if caller_role not in ('owner','manager') then raise exception using errcode='42501', message='Team management access denied'; end if;
  return query select i.id, i.email, i.role, i.expires_at, i.created_at
  from public.invitations i where i.organization_id=target_organization and i.accepted_at is null and i.revoked_at is null
    and i.expires_at > now() and (caller_role='owner' or i.role='agent') order by i.created_at desc;
end; $$;

create or replace function public.invite_member(target_organization uuid, target_email text, target_role text, expires_in_hours integer default 72)
returns table (invitation_id uuid, invitation_token text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare caller_role text; clean_email text; raw_token text; new_id uuid; expiry timestamptz; used_seats integer; seat_limit integer;
begin
  if auth.uid() is null then raise exception using errcode='28000', message='Authentication required'; end if;
  caller_role := public.current_membership_role(target_organization);
  if caller_role='owner' then
    if target_role not in ('manager','agent') then raise exception using errcode='42501', message='Owner can invite only managers or agents'; end if;
  elsif caller_role='manager' then
    if target_role <> 'agent' then raise exception using errcode='42501', message='Manager can invite only agents'; end if;
  else raise exception using errcode='42501', message='Invitation access denied'; end if;
  clean_email := lower(trim(target_email));
  if clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception using errcode='22023', message='Invalid invitation email'; end if;
  if expires_in_hours not between 1 and 168 then raise exception using errcode='22023', message='Invitation expiration must be between 1 and 168 hours'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization::text, 0));
  if exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id where m.organization_id=target_organization and lower(u.email)=clean_email) then
    raise exception using errcode='23505', message='User is already a member';
  end if;
  delete from public.invitations i where i.organization_id=target_organization and lower(i.email)=clean_email
    and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();
  select count(*) into used_seats from public.organization_members m where m.organization_id=target_organization and m.status in ('active','disabled');
  used_seats := used_seats + (select count(*) from public.invitations i where i.organization_id=target_organization and i.accepted_at is null and i.revoked_at is null and i.expires_at > now());
  seat_limit := public.team_member_limit(target_organization);
  if seat_limit is null or used_seats >= seat_limit then raise exception using errcode='P0001', message='Team member limit reached'; end if;
  raw_token := encode(extensions.gen_random_bytes(32),'hex'); expiry := now() + make_interval(hours => expires_in_hours);
  insert into public.invitations(organization_id,email,role,token_hash,invited_by,expires_at)
  values(target_organization,clean_email,target_role,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),expiry) returning id into new_id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
  values(target_organization,auth.uid(),'invitation',new_id,'member_invited',jsonb_build_object('email',clean_email,'role',target_role));
  return query select new_id,raw_token,expiry;
end; $$;

create or replace function public.accept_invitation(invitation_token text)
returns table (accepted_organization_id uuid, accepted_role text)
language plpgsql volatile security definer set search_path = '' as $$
declare invitation public.invitations%rowtype; caller_email text; used_seats integer; seat_limit integer;
begin
  if auth.uid() is null then raise exception using errcode='28000', message='Authentication required'; end if;
  select lower(email) into caller_email from auth.users where id=auth.uid();
  select * into invitation from public.invitations i where i.token_hash=encode(extensions.digest(invitation_token,'sha256'),'hex') for update;
  if not found then raise exception using errcode='22023', message='Invalid invitation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(invitation.organization_id::text,0));
  if invitation.revoked_at is not null then raise exception using errcode='22023', message='Invitation was revoked'; end if;
  if invitation.accepted_at is not null then raise exception using errcode='22023', message='Invitation was already used'; end if;
  if invitation.expires_at <= now() then raise exception using errcode='22023', message='Invitation expired'; end if;
  if caller_email is null or caller_email <> lower(invitation.email) then raise exception using errcode='42501', message='Invitation belongs to another email'; end if;
  select count(*) into used_seats from public.organization_members m where m.organization_id=invitation.organization_id and m.status in ('active','disabled');
  seat_limit := public.team_member_limit(invitation.organization_id);
  if seat_limit is null or used_seats >= seat_limit then raise exception using errcode='P0001', message='Team member limit reached'; end if;
  insert into public.organization_members(organization_id,user_id,role,status)
  values(invitation.organization_id,auth.uid(),invitation.role,'active')
  on conflict (organization_id,user_id) do update set role=excluded.role,status='active',updated_at=now();
  update public.invitations set accepted_at=now() where id=invitation.id;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata)
  values(invitation.organization_id,auth.uid(),'member',auth.uid(),'member_joined',jsonb_build_object('role',invitation.role,'invitation_id',invitation.id));
  return query select invitation.organization_id,invitation.role;
end; $$;

create or replace function public.revoke_invitation(target_organization uuid, target_invitation uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller_role text; invitation_role text;
begin
  caller_role:=public.current_membership_role(target_organization);
  select role into invitation_role from public.invitations where id=target_invitation and organization_id=target_organization and accepted_at is null and revoked_at is null for update;
  if not found then raise exception using errcode='22023', message='Active invitation not found'; end if;
  if caller_role not in ('owner','manager') or (caller_role='manager' and invitation_role<>'agent') then raise exception using errcode='42501', message='Invitation revoke access denied'; end if;
  update public.invitations set revoked_at=now() where id=target_invitation;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action) values(target_organization,auth.uid(),'invitation',target_invitation,'invitation_revoked');
end; $$;

create or replace function public.change_member_role(target_organization uuid, target_user uuid, target_role text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller_role text; old_role text; target_status text;
begin
  caller_role:=public.current_membership_role(target_organization);
  if caller_role<>'owner' then raise exception using errcode='42501', message='Only an owner can change roles'; end if;
  if target_role not in ('manager','agent') then raise exception using errcode='22023', message='Use transfer_ownership to assign owner'; end if;
  select role,status into old_role,target_status from public.organization_members where organization_id=target_organization and user_id=target_user for update;
  if not found then raise exception using errcode='22023', message='Member not found'; end if;
  if old_role='owner' then raise exception using errcode='42501', message='Use transfer_ownership to change an owner'; end if;
  update public.organization_members set role=target_role,updated_at=now() where organization_id=target_organization and user_id=target_user;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'member',target_user,'role_changed',jsonb_build_object('previous_role',old_role,'new_role',target_role));
end; $$;

create or replace function public.set_member_enabled(target_organization uuid, target_user uuid, enabled boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller_role text; member_role text; next_status text; action_name text;
begin
  caller_role:=public.current_membership_role(target_organization);
  select role into member_role from public.organization_members where organization_id=target_organization and user_id=target_user for update;
  if not found then raise exception using errcode='22023', message='Member not found'; end if;
  if target_user=auth.uid() or member_role='owner' or caller_role not in ('owner','manager') or (caller_role='manager' and member_role<>'agent') then raise exception using errcode='42501', message='Member status access denied'; end if;
  next_status:=case when enabled then 'active' else 'disabled' end; action_name:=case when enabled then 'member_enabled' else 'member_disabled' end;
  update public.organization_members set status=next_status,updated_at=now() where organization_id=target_organization and user_id=target_user;
  if not enabled then update public.leads set assigned_to=null where organization_id=target_organization and assigned_to=target_user; end if;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action) values(target_organization,auth.uid(),'member',target_user,action_name);
end; $$;

create or replace function public.disable_member(target_organization uuid,target_user uuid) returns void language sql volatile security definer set search_path='' as $$ select public.set_member_enabled(target_organization,target_user,false); $$;
create or replace function public.enable_member(target_organization uuid,target_user uuid) returns void language sql volatile security definer set search_path='' as $$ select public.set_member_enabled(target_organization,target_user,true); $$;

create or replace function public.remove_member(target_organization uuid,target_user uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare caller_role text; member_role text;
begin
  caller_role:=public.current_membership_role(target_organization);
  select role into member_role from public.organization_members where organization_id=target_organization and user_id=target_user for update;
  if not found then raise exception using errcode='22023', message='Member not found'; end if;
  if target_user=auth.uid() or member_role='owner' or caller_role not in ('owner','manager') or (caller_role='manager' and member_role<>'agent') then raise exception using errcode='42501', message='Member removal access denied'; end if;
  update public.leads set assigned_to=null where organization_id=target_organization and assigned_to=target_user;
  update public.appointments set assigned_to=null where organization_id=target_organization and assigned_to=target_user;
  delete from public.organization_members where organization_id=target_organization and user_id=target_user;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'member',target_user,'member_removed',jsonb_build_object('role',member_role));
end; $$;

create or replace function public.transfer_ownership(target_organization uuid,target_user uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare target_old_role text;
begin
  if public.current_membership_role(target_organization)<>'owner' then raise exception using errcode='42501', message='Only an owner can transfer ownership'; end if;
  if target_user=auth.uid() then raise exception using errcode='22023', message='Target is already owner'; end if;
  select role into target_old_role from public.organization_members where organization_id=target_organization and user_id=target_user and status='active' for update;
  if not found or target_old_role='owner' then raise exception using errcode='22023', message='Target must be an active manager or agent'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization::text,1));
  update public.organization_members set role='manager',updated_at=now() where organization_id=target_organization and user_id=auth.uid();
  update public.organization_members set role='owner',updated_at=now() where organization_id=target_organization and user_id=target_user;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'member',target_user,'ownership_transferred',jsonb_build_object('previous_owner',auth.uid(),'new_owner',target_user,'previous_target_role',target_old_role));
end; $$;

create or replace function public.assign_lead(target_organization uuid,target_lead uuid,target_user uuid)
returns public.leads language plpgsql volatile security definer set search_path='' as $$
declare previous_user uuid; updated_lead public.leads; action_name text;
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501', message='Lead assignment access denied'; end if;
  select assigned_to into previous_user from public.leads where id=target_lead and organization_id=target_organization for update;
  if not found then raise exception using errcode='22023', message='Lead not found in organization'; end if;
  if target_user is not null and not exists(select 1 from public.organization_members where organization_id=target_organization and user_id=target_user and status='active') then raise exception using errcode='22023', message='Assignee must be an active member of the same organization'; end if;
  update public.leads set assigned_to=target_user where id=target_lead and organization_id=target_organization returning * into updated_lead;
  action_name:=case when previous_user is null then 'lead_assigned' else 'lead_transferred' end;
  insert into public.audit_events(organization_id,actor_id,entity_type,entity_id,action,metadata) values(target_organization,auth.uid(),'lead',target_lead,action_name,jsonb_build_object('previous_assigned_to',previous_user,'new_assigned_to',target_user));
  return updated_lead;
end; $$;

create or replace function public.list_team_audit(target_organization uuid, result_limit integer default 100)
returns table(id uuid,actor_id uuid,entity_type text,entity_id uuid,action text,metadata jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_membership_role(target_organization) not in ('owner','manager') then raise exception using errcode='42501', message='Audit access denied'; end if;
  return query select a.id,a.actor_id,a.entity_type,a.entity_id,a.action,a.metadata,a.created_at from public.audit_events a
    where a.organization_id=target_organization order by a.created_at desc limit least(greatest(result_limit,1),200);
end; $$;

do $$ declare signature text; begin
  foreach signature in array array[
    'team_member_limit(uuid)','list_team_members(uuid)','list_pending_invitations(uuid)',
    'invite_member(uuid,text,text,integer)','accept_invitation(text)','revoke_invitation(uuid,uuid)',
    'change_member_role(uuid,uuid,text)','set_member_enabled(uuid,uuid,boolean)',
    'disable_member(uuid,uuid)','enable_member(uuid,uuid)','remove_member(uuid,uuid)',
    'transfer_ownership(uuid,uuid)','assign_lead(uuid,uuid,uuid)','list_team_audit(uuid,integer)'
  ] loop execute format('revoke all on function public.%s from public, anon',signature); execute format('grant execute on function public.%s to authenticated',signature); end loop;
end $$;

-- Internal helper is reachable only through the narrow wrappers.
revoke all on function public.set_member_enabled(uuid,uuid,boolean) from authenticated;

comment on function public.assign_lead(uuid,uuid,uuid) is 'Ponto de extensao para estrategia futura de round-robin; nesta fase executa atribuicao explicita e atomica.';

commit;

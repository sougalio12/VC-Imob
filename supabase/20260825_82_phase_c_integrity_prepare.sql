-- Fase C1b: integridade preparatória para relações multi-tenant.
-- As FKs são NOT VALID: registros antigos não são examinados nesta etapa,
-- mas novas gravações passam a respeitar o par lead/organização.
-- Nenhuma policy é criada, removida ou substituída aqui.

alter table public.leads
  add constraint leads_id_organization_id_key
  unique (id, organization_id);

alter table public.lead_notes
  add constraint lead_notes_lead_organization_fk
  foreign key (lead_id, organization_id)
  references public.leads (id, organization_id)
  on delete cascade
  not valid;

alter table public.appointments
  add constraint appointments_lead_organization_fk
  foreign key (lead_id, organization_id)
  references public.leads (id, organization_id)
  on delete cascade
  not valid;

alter table public.lead_interests
  add constraint lead_interests_lead_organization_fk
  foreign key (lead_id, organization_id)
  references public.leads (id, organization_id)
  on delete cascade
  not valid;

create or replace function public.enforce_active_organization_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- NULL preserva leads sem atribuição e a captura pública atual.
  if new.assigned_to is null then
    return new;
  end if;

  if new.organization_id is null or not exists (
    select 1
    from public.organization_members as member
    where member.organization_id = new.organization_id
      and member.user_id = new.assigned_to
      and member.status = 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'assigned_to must be an active member of the same organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_organization_assignee() from public;
revoke all on function public.enforce_active_organization_assignee() from anon;
revoke all on function public.enforce_active_organization_assignee() from authenticated;

create trigger leads_enforce_active_organization_assignee
before insert or update of assigned_to, organization_id on public.leads
for each row
execute function public.enforce_active_organization_assignee();

create trigger appointments_enforce_active_organization_assignee
before insert or update of assigned_to, organization_id on public.appointments
for each row
execute function public.enforce_active_organization_assignee();

comment on function public.enforce_active_organization_assignee() is
  'Valida somente novas atribuições ou escritas explícitas de assigned_to/organization_id. assigned_to NULL é permitido para preservar capture_site_lead e a Edge Function.';

begin;

drop policy if exists lead_memory_select on public.lead_commercial_memory;
drop policy if exists lead_memory_insert on public.lead_commercial_memory;
drop policy if exists lead_memory_update on public.lead_commercial_memory;

create policy lead_memory_select on public.lead_commercial_memory for select to authenticated
 using(public.can_access_lead(lead_id,organization_id)
   and public.can_use_entitlement(organization_id,'crm.assistant'));
create policy lead_memory_insert on public.lead_commercial_memory for insert to authenticated
 with check(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id)
   and public.can_use_entitlement(organization_id,'crm.assistant'));
create policy lead_memory_update on public.lead_commercial_memory for update to authenticated
 using(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id)
   and public.can_use_entitlement(organization_id,'crm.assistant'))
 with check(created_by=auth.uid() and public.can_access_lead(lead_id,organization_id)
   and public.can_use_entitlement(organization_id,'crm.assistant'));

comment on table public.lead_commercial_memory is
  'Memória comercial estruturada, tenant-scoped e restrita ao entitlement crm.assistant.';

commit;

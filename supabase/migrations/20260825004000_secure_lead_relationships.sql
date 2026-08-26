-- Este patch já foi executado manualmente no Supabase.
-- Corrige o isolamento entre organizações para notas e agendamentos.
-- Não deve ser reexecutado automaticamente sem necessidade.

create or replace function public.lead_belongs_to_organization(
  target_lead uuid,
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leads
    where id = target_lead
      and organization_id = target_organization
  );
$$;

drop policy if exists "organization members manage notes" on public.lead_notes;
create policy "organization members manage notes"
on public.lead_notes
for all
using (
  public.same_organization(organization_id)
  and public.lead_belongs_to_organization(lead_id, organization_id)
)
with check (
  public.same_organization(organization_id)
  and public.lead_belongs_to_organization(lead_id, organization_id)
);

drop policy if exists "organization members manage appointments" on public.appointments;
create policy "organization members manage appointments"
on public.appointments
for all
using (
  public.same_organization(organization_id)
  and public.lead_belongs_to_organization(lead_id, organization_id)
)
with check (
  public.same_organization(organization_id)
  and public.lead_belongs_to_organization(lead_id, organization_id)
);

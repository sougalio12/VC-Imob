-- Fase C4: rollback definitivo da RLS/grants para a baseline legada.
-- A baseline foi comparada com o catálogo real de produção antes da preparação
-- deste arquivo. Executar SOMENTE para reverter a migration de ativação
-- 20260825_85_phase_c_rls_activation.sql.
--
-- Esta migration é destinada somente a reverter uma futura ativação C4.
-- Ela restaura APENAS as policies RLS e os grants legados descritos abaixo.
-- Ela NÃO remove nem desfaz constraints, chaves, funções ou triggers criados
-- pela migration 20260825_82_phase_c_integrity_prepare.sql. Portanto, após este
-- rollback, a integridade preparatória da migration 82 continuará ativa.
-- A migration 85 usa exatamente os nomes phase_c_* abaixo. Se esses nomes forem
-- alterados, este rollback deverá ser atualizado e novamente revisado.

begin;

drop policy if exists "phase_c_organizations_select" on public.organizations;

drop policy if exists "phase_c_profiles_select" on public.profiles;
drop policy if exists "phase_c_profiles_update" on public.profiles;

drop policy if exists "phase_c_leads_select" on public.leads;
drop policy if exists "phase_c_leads_insert" on public.leads;
drop policy if exists "phase_c_leads_update" on public.leads;
drop policy if exists "phase_c_leads_delete" on public.leads;

drop policy if exists "phase_c_lead_notes_select" on public.lead_notes;
drop policy if exists "phase_c_lead_notes_insert" on public.lead_notes;
drop policy if exists "phase_c_lead_notes_update" on public.lead_notes;
drop policy if exists "phase_c_lead_notes_delete" on public.lead_notes;

drop policy if exists "phase_c_appointments_select" on public.appointments;
drop policy if exists "phase_c_appointments_insert" on public.appointments;
drop policy if exists "phase_c_appointments_update" on public.appointments;
drop policy if exists "phase_c_appointments_delete" on public.appointments;

drop policy if exists "phase_c_lead_interests_select" on public.lead_interests;
drop policy if exists "phase_c_lead_interests_insert" on public.lead_interests;
drop policy if exists "phase_c_lead_interests_update" on public.lead_interests;
drop policy if exists "phase_c_lead_interests_delete" on public.lead_interests;

create or replace function public.same_organization(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and organization_id = target_organization
  );
$$;

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

-- O estado legado versionado deixou estas funções executáveis por PUBLIC.
grant execute on function public.same_organization(uuid) to public;
grant execute on function public.lead_belongs_to_organization(uuid, uuid) to public;
grant execute on function public.is_active_organization_member(uuid, uuid) to authenticated;

drop policy if exists "organization members can read organization" on public.organizations;
create policy "organization members can read organization"
on public.organizations
for select
using (public.same_organization(id));

drop policy if exists "users can read organization profiles" on public.profiles;
create policy "users can read organization profiles"
on public.profiles
for select
using (public.same_organization(organization_id));

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and public.same_organization(organization_id)
);

drop policy if exists "organization members manage leads" on public.leads;
create policy "organization members manage leads"
on public.leads
for all
using (public.same_organization(organization_id))
with check (public.same_organization(organization_id));

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

grant usage on schema public to authenticated;

-- Remove ACLs explícitas por coluna criadas pela C4 antes de restaurar os
-- grants amplos da baseline legada.
revoke update (full_name) on table public.profiles from authenticated;

revoke insert (
  organization_id,
  assigned_to,
  name,
  phone,
  whatsapp,
  email,
  origin,
  responsible_name,
  property_code,
  property_title,
  budget,
  desired_region,
  notes,
  stage,
  entered_at,
  next_follow_up,
  visit_date
) on table public.leads from authenticated;
revoke update (
  name,
  phone,
  whatsapp,
  email,
  origin,
  responsible_name,
  property_code,
  property_title,
  budget,
  desired_region,
  notes,
  stage,
  next_follow_up,
  visit_date
) on table public.leads from authenticated;

revoke insert (
  organization_id,
  lead_id,
  author_id,
  content
) on table public.lead_notes from authenticated;
revoke update (content) on table public.lead_notes from authenticated;

revoke insert (
  organization_id,
  lead_id,
  assigned_to,
  kind,
  scheduled_at,
  status,
  notes
) on table public.appointments from authenticated;
revoke update (
  kind,
  scheduled_at,
  status,
  notes
) on table public.appointments from authenticated;

revoke insert (
  organization_id,
  lead_id,
  property_code,
  property_title,
  source
) on table public.lead_interests from authenticated;
revoke update (
  property_code,
  property_title,
  source
) on table public.lead_interests from authenticated;

grant select on table public.organizations to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.lead_notes to authenticated;
grant select, insert, update, delete on table public.appointments to authenticated;

-- lead_interests não possuía policy nem grants autenticados no estado legado.
revoke all on table public.lead_interests from authenticated;
revoke all on table public.lead_interests from anon;

revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.leads from anon;
revoke all on table public.lead_notes from anon;
revoke all on table public.appointments from anon;

commit;

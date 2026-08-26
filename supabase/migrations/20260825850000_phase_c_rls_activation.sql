-- Fase C4: ativação definitiva da autorização baseada em memberships.
-- Pré-requisitos em produção: migrations 80, 81 e 82 aplicadas; diagnósticos
-- da migration 83 sem inconsistências; frontend sem entered_at no UPDATE.
-- Não altera privilégios de service_role nem a captura pública do site.

begin;

-- Remove somente privilégios do cliente autenticado. service_role permanece
-- intocado e capture_site_lead() continua executando com seu owner definer.
revoke all on table public.organizations from authenticated;
revoke all on table public.profiles from authenticated;
revoke all on table public.leads from authenticated;
revoke all on table public.lead_notes from authenticated;
revoke all on table public.appointments from authenticated;
revoke all on table public.lead_interests from authenticated;

grant select on table public.organizations to authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

grant select, delete on table public.leads to authenticated;
grant insert (
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
) on table public.leads to authenticated;
grant update (
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
) on table public.leads to authenticated;

grant select, delete on table public.lead_notes to authenticated;
grant insert (
  organization_id,
  lead_id,
  author_id,
  content
) on table public.lead_notes to authenticated;
grant update (content) on table public.lead_notes to authenticated;

grant select, delete on table public.appointments to authenticated;
grant insert (
  organization_id,
  lead_id,
  assigned_to,
  kind,
  scheduled_at,
  status,
  notes
) on table public.appointments to authenticated;
grant update (
  kind,
  scheduled_at,
  status,
  notes
) on table public.appointments to authenticated;

grant select, delete on table public.lead_interests to authenticated;
grant insert (
  organization_id,
  lead_id,
  property_code,
  property_title,
  source
) on table public.lead_interests to authenticated;
grant update (
  property_code,
  property_title,
  source
) on table public.lead_interests to authenticated;

-- As policies legadas são permissivas. Elas precisam sair na mesma transação
-- para não serem combinadas por OR com as policies definitivas.
drop policy if exists "organization members can read organization" on public.organizations;
drop policy if exists "users can read organization profiles" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "organization members manage leads" on public.leads;
drop policy if exists "organization members manage notes" on public.lead_notes;
drop policy if exists "organization members manage appointments" on public.appointments;

create policy "phase_c_organizations_select"
on public.organizations
for select
to authenticated
using (public.is_active_organization_member(id));

-- Profile é dado da conta, não fonte de autorização do tenant. O usuário pode
-- ler o próprio profile; grants de coluna limitam UPDATE somente a full_name.
create policy "phase_c_profiles_select"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "phase_c_profiles_update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "phase_c_leads_select"
on public.leads
for select
to authenticated
using (
  public.can_operate_organization(organization_id)
  or (
    public.current_membership_role(organization_id) = 'agent'
    and assigned_to = auth.uid()
  )
);

create policy "phase_c_leads_insert"
on public.leads
for insert
to authenticated
with check (
  (
    public.can_operate_organization(organization_id)
    and (
      assigned_to is null
      or public.is_assignable_member(organization_id, assigned_to)
    )
  )
  or (
    public.current_membership_role(organization_id) = 'agent'
    and assigned_to = auth.uid()
  )
);

create policy "phase_c_leads_update"
on public.leads
for update
to authenticated
using (public.can_access_lead(id, organization_id))
with check (public.can_access_lead(id, organization_id));

create policy "phase_c_leads_delete"
on public.leads
for delete
to authenticated
using (public.can_operate_organization(organization_id));

create policy "phase_c_lead_notes_select"
on public.lead_notes
for select
to authenticated
using (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_notes_insert"
on public.lead_notes
for insert
to authenticated
with check (
  public.can_access_lead(lead_id, organization_id)
  and author_id = auth.uid()
);

create policy "phase_c_lead_notes_update"
on public.lead_notes
for update
to authenticated
using (public.can_access_lead(lead_id, organization_id))
with check (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_notes_delete"
on public.lead_notes
for delete
to authenticated
using (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_appointments_select"
on public.appointments
for select
to authenticated
using (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_appointments_insert"
on public.appointments
for insert
to authenticated
with check (
  public.can_access_lead(lead_id, organization_id)
  and (
    (
      public.current_membership_role(organization_id) = 'agent'
      and assigned_to = auth.uid()
    )
    or (
      public.can_operate_organization(organization_id)
      and (
        assigned_to is null
        or public.is_assignable_member(organization_id, assigned_to)
      )
    )
  )
);

create policy "phase_c_appointments_update"
on public.appointments
for update
to authenticated
using (public.can_access_lead(lead_id, organization_id))
with check (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_appointments_delete"
on public.appointments
for delete
to authenticated
using (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_interests_select"
on public.lead_interests
for select
to authenticated
using (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_interests_insert"
on public.lead_interests
for insert
to authenticated
with check (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_interests_update"
on public.lead_interests
for update
to authenticated
using (public.can_access_lead(lead_id, organization_id))
with check (public.can_access_lead(lead_id, organization_id));

create policy "phase_c_lead_interests_delete"
on public.lead_interests
for delete
to authenticated
using (public.can_access_lead(lead_id, organization_id));

-- Helpers legados deixam de sustentar qualquer policy após a troca acima.
revoke all on function public.same_organization(uuid) from public;
revoke all on function public.same_organization(uuid) from anon;
revoke all on function public.same_organization(uuid) from authenticated;

revoke all on function public.lead_belongs_to_organization(uuid, uuid) from public;
revoke all on function public.lead_belongs_to_organization(uuid, uuid) from anon;
revoke all on function public.lead_belongs_to_organization(uuid, uuid) from authenticated;

-- A overload segura de um argumento permanece concedida a authenticated.
revoke all on function public.is_active_organization_member(uuid, uuid) from public;
revoke all on function public.is_active_organization_member(uuid, uuid) from anon;
revoke all on function public.is_active_organization_member(uuid, uuid) from authenticated;

commit;

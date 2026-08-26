-- DIAGNÓSTICO MANUAL da Fase C1b. NÃO executar como migration automática.
-- Executar manualmente, com sessão administrativa apropriada, ANTES da
-- migration 20260825_82_phase_c_integrity_prepare.sql e revisar os resultados.
-- Este arquivo contém exclusivamente SELECTs e não corrige dados.

-- 1. Profiles sem membership active correspondente na organização legada.
select
  profile.id as user_id,
  profile.organization_id,
  profile.role as legacy_role
from public.profiles as profile
left join public.organization_members as member
  on member.organization_id = profile.organization_id
 and member.user_id = profile.id
 and member.status = 'active'
where member.id is null
order by profile.organization_id, profile.id;

-- 2. Memberships sem profile correspondente.
select
  member.id as membership_id,
  member.organization_id,
  member.user_id,
  member.role,
  member.status
from public.organization_members as member
left join public.profiles as profile on profile.id = member.user_id
where profile.id is null
order by member.organization_id, member.user_id;

-- 3. Memberships cuja organização diverge do profile legado.
-- Pode ser legítimo para usuários multi-organização; revisar, não corrigir
-- automaticamente.
select
  member.id as membership_id,
  member.organization_id as membership_organization_id,
  member.user_id,
  member.role as membership_role,
  member.status,
  profile.organization_id as legacy_profile_organization_id,
  profile.role as legacy_profile_role
from public.organization_members as member
join public.profiles as profile on profile.id = member.user_id
where member.organization_id is distinct from profile.organization_id
order by member.user_id, member.organization_id;

-- 4. Duplicidades lógicas de membership que impediriam unicidade futura.
-- A constraint atual já deveria tornar este resultado vazio.
select
  member.organization_id,
  member.user_id,
  count(*) as membership_count
from public.organization_members as member
group by member.organization_id, member.user_id
having count(*) > 1
order by member.organization_id, member.user_id;

-- 5. Memberships active com role fora do conjunto oficial.
-- A CHECK atual já deveria tornar este resultado vazio.
select
  member.id,
  member.organization_id,
  member.user_id,
  member.role,
  member.status
from public.organization_members as member
where member.status = 'active'
  and member.role not in ('owner', 'manager', 'agent')
order by member.organization_id, member.user_id;

-- 6. Leads atribuídos a usuário sem membership active no mesmo tenant.
select
  lead.id as lead_id,
  lead.organization_id,
  lead.assigned_to
from public.leads as lead
left join public.organization_members as member
  on member.organization_id = lead.organization_id
 and member.user_id = lead.assigned_to
 and member.status = 'active'
where lead.assigned_to is not null
  and member.id is null
order by lead.organization_id, lead.id;

-- 7. Duplicidades do par exigido pela chave leads(id, organization_id).
-- A PK atual em id já deveria tornar este resultado vazio.
select
  lead.id,
  lead.organization_id,
  count(*) as lead_count
from public.leads as lead
group by lead.id, lead.organization_id
having count(*) > 1
order by lead.id, lead.organization_id;

-- 8. Notas órfãs ou cujo lead pertence a outra organização.
select
  note.id as note_id,
  note.organization_id as note_organization_id,
  note.lead_id,
  lead.organization_id as lead_organization_id,
  case when lead.id is null then 'missing_lead' else 'organization_mismatch' end as inconsistency
from public.lead_notes as note
left join public.leads as lead on lead.id = note.lead_id
where lead.id is null
   or lead.organization_id is distinct from note.organization_id
order by note.organization_id, note.id;

-- 9. Appointments órfãos ou cujo lead pertence a outra organização.
select
  appointment.id as appointment_id,
  appointment.organization_id as appointment_organization_id,
  appointment.lead_id,
  lead.organization_id as lead_organization_id,
  case when lead.id is null then 'missing_lead' else 'organization_mismatch' end as inconsistency
from public.appointments as appointment
left join public.leads as lead on lead.id = appointment.lead_id
where lead.id is null
   or lead.organization_id is distinct from appointment.organization_id
order by appointment.organization_id, appointment.id;

-- 10. Appointments atribuídos fora da organização ou a membership não active.
select
  appointment.id as appointment_id,
  appointment.organization_id,
  appointment.assigned_to
from public.appointments as appointment
left join public.organization_members as member
  on member.organization_id = appointment.organization_id
 and member.user_id = appointment.assigned_to
 and member.status = 'active'
where appointment.assigned_to is not null
  and member.id is null
order by appointment.organization_id, appointment.id;

-- 11. Interesses órfãos ou cujo lead pertence a outra organização.
select
  interest.id as interest_id,
  interest.organization_id as interest_organization_id,
  interest.lead_id,
  lead.organization_id as lead_organization_id,
  case when lead.id is null then 'missing_lead' else 'organization_mismatch' end as inconsistency
from public.lead_interests as interest
left join public.leads as lead on lead.id = interest.lead_id
where lead.id is null
   or lead.organization_id is distinct from interest.organization_id
order by interest.organization_id, interest.id;

-- 12. Duplicidades de interesses cobertas pela unique(lead_id, property_code).
-- Incluído para detectar drift de schema ou constraint ausente no catálogo real.
select
  interest.lead_id,
  interest.property_code,
  count(*) as interest_count
from public.lead_interests as interest
where interest.property_code is not null
group by interest.lead_id, interest.property_code
having count(*) > 1
order by interest.lead_id, interest.property_code;

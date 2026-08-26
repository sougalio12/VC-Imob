-- Fase C1a: helpers aditivos para a futura RLS baseada em memberships.
-- Esta migration não altera nenhuma policy existente.
--
-- Compatibilidade: a função legada
-- public.is_active_organization_member(uuid, uuid) é preservada. A versão
-- definitiva abaixo é uma sobrecarga de um argumento e sempre usa auth.uid().
-- A overload de dois argumentos é legado temporário e não tem seu comportamento
-- alterado nesta etapa. Antes da ativação C4, revogar seu EXECUTE após verificar
-- no catálogo, logs e integrações reais que nenhuma dependência ainda a utiliza.

create or replace function public.is_active_organization_member(
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and target_organization is not null
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = target_organization
        and member.user_id = auth.uid()
        and member.status = 'active'
    );
$$;

create or replace function public.current_membership_role(
  target_organization uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.organization_members as member
  where auth.uid() is not null
    and target_organization is not null
    and member.organization_id = target_organization
    and member.user_id = auth.uid()
    and member.status = 'active'
  limit 1;
$$;

create or replace function public.can_operate_organization(
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and target_organization is not null
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = target_organization
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'manager')
    );
$$;

create or replace function public.can_access_lead(
  target_lead uuid,
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and target_lead is not null
    and target_organization is not null
    and exists (
      select 1
      from public.leads as lead
      join public.organization_members as member
        on member.organization_id = lead.organization_id
       and member.user_id = auth.uid()
       and member.status = 'active'
      where lead.id = target_lead
        and lead.organization_id = target_organization
        and (
          member.role in ('owner', 'manager')
          or (
            member.role = 'agent'
            and lead.assigned_to = auth.uid()
          )
        )
    );
$$;

create or replace function public.is_assignable_member(
  target_organization uuid,
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and target_organization is not null
    and target_user is not null
    and exists (
      select 1
      from public.organization_members as caller
      where caller.organization_id = target_organization
        and caller.user_id = auth.uid()
        and caller.status = 'active'
        and caller.role in ('owner', 'manager')
    )
    and exists (
      select 1
      from public.organization_members as assignee
      where assignee.organization_id = target_organization
        and assignee.user_id = target_user
        and assignee.status = 'active'
    );
$$;

revoke all on function public.is_active_organization_member(uuid) from public;
revoke all on function public.current_membership_role(uuid) from public;
revoke all on function public.can_operate_organization(uuid) from public;
revoke all on function public.can_access_lead(uuid, uuid) from public;
revoke all on function public.is_assignable_member(uuid, uuid) from public;

revoke all on function public.is_active_organization_member(uuid) from anon;
revoke all on function public.current_membership_role(uuid) from anon;
revoke all on function public.can_operate_organization(uuid) from anon;
revoke all on function public.can_access_lead(uuid, uuid) from anon;
revoke all on function public.is_assignable_member(uuid, uuid) from anon;

grant execute on function public.is_active_organization_member(uuid) to authenticated;
grant execute on function public.current_membership_role(uuid) to authenticated;
grant execute on function public.can_operate_organization(uuid) to authenticated;
grant execute on function public.can_access_lead(uuid, uuid) to authenticated;
grant execute on function public.is_assignable_member(uuid, uuid) to authenticated;

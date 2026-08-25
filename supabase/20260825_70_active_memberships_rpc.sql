-- Fase B1: contexto de organização no cliente sem expor organization_members diretamente.
-- Execute manualmente somente após a Fase A. Não altera policies operacionais existentes.

create or replace function public.get_my_active_memberships()
returns table (
  organization_id uuid,
  organization_name text,
  role text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    member.organization_id,
    organization.name,
    member.role,
    member.status
  from public.organization_members as member
  join public.organizations as organization on organization.id = member.organization_id
  where member.user_id = auth.uid()
    and member.status = 'active'
  order by organization.name, member.organization_id;
end;
$$;

revoke all on function public.get_my_active_memberships() from public;
grant execute on function public.get_my_active_memberships() to authenticated;

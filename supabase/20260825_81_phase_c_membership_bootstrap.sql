-- Fase C1b: novos usuários do signup legado recebem organização, profile e
-- membership owner ativa na mesma transação do trigger de auth.users.
-- Não altera nem faz backfill de usuários existentes.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'company_name'), ''),
      nullif(trim(new.email), ''),
      'VC Imob'
    )
  )
  returning id into new_org_id;

  insert into public.profiles (id, organization_id, full_name, role)
  values (
    new.id,
    new_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'owner'
  );

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (
    new_org_id,
    new.id,
    'owner',
    'active'
  );

  return new;
end;
$$;

-- A função é chamada somente pelo trigger on_auth_user_created.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

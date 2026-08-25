-- Execute manualmente APÓS 20260824_initial_crm.sql, se o CRM autenticado receber "permission denied".
-- Mantém RLS ativo e não concede acesso ao papel anon.

grant usage on schema public to authenticated;

grant select on table public.organizations to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.lead_notes to authenticated;
grant select, insert, update, delete on table public.appointments to authenticated;

revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.leads from anon;
revoke all on table public.lead_notes from anon;
revoke all on table public.appointments from anon;

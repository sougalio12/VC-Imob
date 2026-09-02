-- Fase F.7: keep every activity transition inside audited RPCs.
begin;

revoke insert, update, delete on table public.appointments from authenticated;

commit;

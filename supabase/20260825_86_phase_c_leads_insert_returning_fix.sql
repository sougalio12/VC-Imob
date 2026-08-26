-- Fase C4 hotfix: permite que INSERT ... RETURNING avalie a nova linha sem
-- depender de can_access_lead(), que reconsulta public.leads durante o mesmo
-- comando. A regra de acesso permanece idêntica: owner/manager ativos acessam
-- todos os leads do tenant; agent ativo acessa somente leads atribuídos a si.

begin;

alter policy "phase_c_leads_select"
on public.leads
using (
  public.can_operate_organization(organization_id)
  or (
    public.current_membership_role(organization_id) = 'agent'
    and assigned_to = auth.uid()
  )
);

commit;

# Fase F — CRM avançado

## Arquitetura

F.1 evolui o Kanban existente. F.2–F.7 reutilizam `leads`, `appointments`, `lead_interests`, `audit_events`, `organization_members`, planos e entitlements; não existe um CRM paralelo. As migrations automáticas `20260902000000_phase_f_crm_advanced.sql` e `20260902100000_phase_f_activity_rpc_only.sql` possuem espelhos históricos byte a byte no diretório `supabase/`.

`appointments` é a fonte estruturada para tarefas, reuniões, visitas e retornos. As RPCs `save_crm_activity` e `set_crm_activity_status` validam organização, acesso ao lead, responsável ativo e papel do chamador, mantêm timestamps de conclusão/cancelamento e geram auditoria. A agenda oferece aberto/hoje/atrasado/concluído, reagendamento e conclusão.

Preferências objetivas permanecem no lead. Interesses específicos permanecem em `lead_interests`. O matching é determinístico e explicável: tipo (25), cidade (20), região (15), preço (25), quartos (10) e área (5), normalizados pelo total de critérios informados. Incompatibilidades objetivas de tipo, cidade, teto de preço, quartos ou área eliminam a sugestão.

O score não usa dados sensíveis nem aprendizado de máquina. Ele explica os sinais utilizados: recência, interesse, follow-up vencido ou futuro, visita e inatividade. Leads encerrados não são priorizados.

O dashboard preserva indicadores essenciais. Relatórios avançados, matching, múltiplos interesses e automações consultam os entitlements já existentes (`crm.advanced_reports`, `crm.matching`, `crm.multiple_interests`, `crm.automation`). Nenhum preço ou plano foi alterado. Automações geram somente alertas internos; não enviam WhatsApp, SMS ou email ao cliente.

## Segurança

Todas as novas escritas usam o tenant ativo resolvido no backend. `SECURITY DEFINER` usa `search_path=''`, valida membership ativa e mantém grants mínimos. A configuração de automações possui RLS forçada: membros ativos leem; owner/manager alteram. Agents operam somente leads permitidos e atividades atribuídas a si. Membros desativados, sem membership ou de outro tenant falham fechados.

A auditoria F.7 identificou que RPCs legadas de equipe/billing usavam `role NOT IN (...)` com uma função que podia retornar SQL `NULL`. A função agora retorna o sentinela inválido `__none__`, que preserva comparações legítimas e fecha as verificações antigas. Regressões cobrem equipe e billing para membership ausente/desativada.

## Operação e rollout

1. Reconstruir banco local vazio com `scripts/validate-local.ps1`.
2. Confirmar paridade histórica/automática, parser PowerShell, `node --check`, secrets e frontend sem `service_role`.
3. Executar `supabase migration list --linked` e `supabase db push --linked --dry-run`.
4. Aplicar somente se o dry-run listar exclusivamente a migration F esperada.
5. Verificar novamente o histórico remoto antes de publicar o frontend.

Nunca executar reset, seed, fixture ou usuários sintéticos em produção.

## Testes

`scripts/test-phase-f.ps1` executa suites comportamentais F.2–F.7 e PostgreSQL real em memória via PGlite. A suite valida lifecycle de atividades, matching, scoring, relatórios, automações internas, owner/manager/agent, disabled, membership ausente, cross-tenant, RLS, grants, auditoria, constraints e bloqueio anônimo. `scripts/validate-local.ps1` também executa F.1, site público, Fases C/D/E e Property Ad sobre reconstrução local completa.

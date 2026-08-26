# Cadeia automática do Supabase

Esta pasta é a fonte executável para bancos locais vazios e, futuramente, para staging. Os SQLs históricos continuam na raiz de `supabase/` como registro do que foi aplicado manualmente em produção.

Mapeamento da cadeia:

| Migration automática | Fonte histórica |
| --- | --- |
| `20260824000000_initial_crm.sql` | `20260824_initial_crm.sql` |
| `20260825001000_authenticated_crm_grants.sql` | `20260825_grant_authenticated_crm.sql` |
| `20260825002000_site_lead_rate_limit.sql` | `20260825_add_site_lead_capture.sql` |
| `20260825003000_site_lead_capture.sql` | `20260825_add_site_lead_deduplication.sql` |
| `20260825004000_secure_lead_relationships.sql` | `20260825_secure_lead_relationships.sql` |
| `20260825100000_saas_core.sql` | `20260825_10_saas_core.sql` |
| `20260825200000_plans_entitlements.sql` | `20260825_20_plans_entitlements.sql` |
| `20260825300000_billing_foundation.sql` | `20260825_30_billing_foundation.sql` |
| `20260825400000_organization_sites.sql` | `20260825_40_organization_sites.sql` |
| `20260825500000_lead_interests.sql` | `20260825_50_lead_interests.sql` |
| `20260825600000_team_foundation.sql` | `20260825_60_team_foundation.sql` |
| `20260825700000_active_memberships_rpc.sql` | `20260825_70_active_memberships_rpc.sql` |
| `20260825800000_phase_c_helpers.sql` | `20260825_80_phase_c_helpers.sql` |
| `20260825810000_phase_c_membership_bootstrap.sql` | `20260825_81_phase_c_membership_bootstrap.sql` |
| `20260825820000_phase_c_integrity_prepare.sql` | `20260825_82_phase_c_integrity_prepare.sql` |
| `20260825850000_phase_c_rls_activation.sql` | `20260825_85_phase_c_rls_activation.sql` |
| `20260825860000_phase_c_leads_insert_returning_fix.sql` | `20260825_86_phase_c_leads_insert_returning_fix.sql` |

Exclusões deliberadas:

- `20260825_83_phase_c_diagnostics.sql`: diagnóstico manual, não é migration.
- `20260825_84_phase_c_rollback_legacy_rls.sql`: rollback de emergência, nunca deve integrar a cadeia de avanço.

As cópias executáveis devem permanecer idênticas às fontes históricas. `scripts/validate-local.ps1` verifica essa correspondência antes de iniciar qualquer serviço.

# Fase I — SaaS público, trial e assinaturas

## Decisão arquitetural

O VC Imob mantém uma única autoridade de entitlement no PostgreSQL/Supabase. Web, PWA, iOS e Android são clientes; nenhum deles pode ativar plano, estender trial ou definir expiração. A base criada na Fase E foi evoluída, sem tabela paralela de assinatura.

Fluxo: `Supabase Auth signup → trigger transacional → organização + profile + membership owner + trial START → get_my_access_state → RLS/RPC operacional`.

Assinaturas verificadas seguem `provider adapter → evento normalizado server-to-server → apply_verified_billing_event → subscriptions/billing_events/audit_events`. O ID externo do evento é único por provider e o timestamp impede regressão por evento fora de ordem.

## Cadastro e onboarding

- Campos obrigatórios: nome, e-mail, telefone e senha (armazenada exclusivamente pelo Supabase Auth).
- Opcionais: CRECI e nome da imobiliária.
- Termos e Privacidade possuem checkbox não pré-marcado e versões `2026-09-12` registradas no backend.
- O trigger distingue `public_signup`; cadastro público incompleto falha fechado.
- O usuário autenticado recém-criado é owner somente da organização criada na mesma transação. IDs de organização não vêm do cliente.
- Quando confirmação de e-mail está ativa, o usuário é orientado a confirmar e entrar; quando a sessão vem na resposta, segue ao CRM.

## Trial

Todos os planos possuem 7 dias. Uma organização nova recebe START `trialing`, com timestamps do banco. `trial_claims` impõe unicidade por usuário e por organização e exatamente sete dias. Logout, limpeza de storage, reinstalação e troca de plataforma não reiniciam o trial.

Limitação antiabuso: uma pessoa ainda pode criar uma identidade nova com outro e-mail. Evitou-se fingerprint invasivo; controles futuros podem usar confirmação de telefone/risk scoring após decisão de produto e privacidade.

Clientes existentes não são migrados nem têm acesso reduzido pela migration. O antigo default interno permanece apenas nas linhas já existentes.

## Planos e preços

| Plano | Mensal | Anual | Equipe |
| --- | ---: | ---: | ---: |
| START | R$ 39,90 | R$ 399,00 | 1 |
| PRO | R$ 79,90 | R$ 799,00 | 1 |
| EQUIPE | R$ 149,90 | R$ 1.499,00 | até 30 |

Os entitlements existentes da Fase E são preservados. O anual é antecipado e a interface comunica “2 meses grátis no anual”. Não há promessa de parcelamento.

## Estados e acesso

- `trialing`: acesso até `trial_ends_at`.
- `active`: acesso até `current_period_ends_at` ou, para legado interno, sem termo definido.
- `past_due` / `grace_period`: acesso somente enquanto houver período validado ainda vigente.
- `canceled`: continua até `current_period_ends_at`.
- `expired`, `refunded`, `revoked`: sem acesso comercial.

O backend faz gating por `current_membership_role`, `can_operate_organization`, `can_access_lead` e `is_assignable_member`. Quando o entitlement termina, esses helpers falham fechados. Membership, assinatura, conta, exclusão e logout permanecem disponíveis por helpers de conta separados. Dados não são apagados.

## Apple, Google e Web

### Apple / StoreKit

Planejadas seis assinaturas auto-renováveis em um único subscription group, com níveis START, PRO e EQUIPE e durações mensal/anual. Convenção sugerida (ainda **não criada**): `vcimob.start.monthly`, `vcimob.start.annual`, `vcimob.pro.monthly`, `vcimob.pro.annual`, `vcimob.team.monthly`, `vcimob.team.annual`. Preços exibidos no app devem vir da StoreKit storefront. Upgrade/downgrade/proration ficam sob regras Apple; o backend reconcilia App Store Server Notifications e transações verificadas.

### Google Play Billing

Planejados três subscription products com base plans mensal/anual, ou seis IDs conforme a modelagem final do Play Console. O app deve usar a versão corrente da Play Billing Library, consultar preço localizado, reconhecer a compra no prazo exigido e validar purchase token no backend via Google Play Developer API. Real-time Developer Notifications alimentam o mesmo evento normalizado.

### Web

O adapter `web` continua provider-agnostic. Nenhum gateway foi escolhido e nenhum cartão é manipulado. A UI informa indisponibilidade sem simular cobrança.

### Cross-platform e restore

O entitlement pertence à organização, não ao aparelho. Após login, qualquer plataforma consulta o backend. Restore/reconciliação será ligada ao adapter real da loja e nunca concede acesso a partir de uma mensagem do frontend. Se já houver provider ativo, o produto deve informar onde gerenciar a assinatura e evitar compra duplicada; não cancela assinatura externa automaticamente.

## Eventos de provider

`billing-provider-event` fica desabilitada por padrão. Ela aceita apenas eventos normalizados de um adapter verificador, requer segredo server-to-server e usa service role somente no servidor. **Não habilitar** até implementar e testar Apple signed JWS / App Store Server API e Google Play Developer API/PubSub com credenciais reais. Receipts e tokens completos não são persistidos em logs.

Renovação, cancelamento, billing issue, grace, expiração, refund/revocation e mudança de produto convergem em `apply_verified_billing_event`. Eventos duplicados não mudam o período; eventos antigos são ignorados.

## Exclusão de conta

- Agent/manager: cria pedido auditado e desativa a própria membership; dados comerciais permanecem na organização.
- Owner com outro owner: mesmo fluxo, sem deixar a organização órfã.
- Owner único: abre pedido com escopo `organization` e mantém acesso até revisão de sucessão, billing, auditoria e retenção.
- A remoção definitiva de `auth.users` é operação administrativa posterior; não existe deleção destrutiva improvisada pelo cliente.

A página pública `/crm/exclusao-de-conta.html` explica o fluxo. Prazos e retenção precisam de revisão jurídica.

## Privacidade, App Privacy e Data Safety

Inventário técnico:

| Categoria | Exemplos | Finalidade | Armazenamento/processor |
| --- | --- | --- | --- |
| Conta | nome, e-mail, telefone, CRECI opcional | autenticação, suporte e identificação | Supabase Auth/PostgreSQL |
| Organização/equipe | nome, papéis, status, convites | multi-tenancy e colaboração | PostgreSQL |
| Conteúdo comercial | leads, contatos, notas, agenda, imóveis | operação do CRM | PostgreSQL |
| Assinatura | plano, período, provider, referências externas | entitlement e suporte de billing | PostgreSQL + loja/gateway futuro |
| Diagnóstico/auditoria | eventos estruturados, ações de segurança | segurança, integridade e suporte | PostgreSQL/infraestrutura |

Apple App Privacy e Google Data Safety devem declarar coleta compatível com a tabela, associação à identidade quando aplicável e compartilhamento com processadores técnicos. Não há venda de dados. Finalidades, retenção, controlador legal, contato e base jurídica requerem validação humana/jurídica.

## E-mails transacionais

Eventos previstos: boas-vindas, início/fim próximo/fim do trial, ativação, cancelamento agendado e expiração. Nenhum envio foi ativado sem provedor/configuração; deduplicação deve usar tipo + assinatura/período. Marketing exige consentimento separado e nunca está pré-marcado.

## Referências oficiais consultadas

- Apple App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple — Offering account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple StoreKit / In-App Purchase: https://developer.apple.com/documentation/storekit/in-app_purchase
- Apple App Privacy: https://developer.apple.com/app-store/app-privacy-details/
- Google Play Billing integration: https://developer.android.com/google/play/billing/integrate
- Google Play Billing security: https://developer.android.com/google/play/billing/security
- Google Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google personal-account testing requirements: https://support.google.com/googleplay/android-developer/answer/14151465
- Supabase user-data trigger guidance: https://supabase.com/docs/guides/auth/managing-user-data

Para novas contas pessoais do Google Play criadas após 13/11/2023, a regra publicada exige closed test com pelo menos 12 testadores opt-in continuamente por 14 dias antes de solicitar acesso à produção. Confirmar novamente no Play Console no momento do lançamento, pois políticas mudam.

## Pendências humanas e de lojas

1. Revisão jurídica de Termos, Política, retenção, contato e identificação do fornecedor pessoa física.
2. Apple Developer/App Store Connect: contratos, dados fiscais/bancários, subscription group, seis produtos/price points, shared setup, App Privacy, signing e sandbox.
3. Google Play Console: verificação da conta pessoal, produtos/base plans, service account/PubSub, Data Safety, testers e closed test.
4. Escolher provider web e configurar checkout/webhooks sem cartão no VC Imob.
5. Implementar adapters verificadores reais e então habilitar `billing-provider-event`.
6. Implementar a remoção administrativa/anônima final após política de retenção aprovada.

## Release e operação

Migration: `20260912000000_phase_i_public_saas.sql`. Aplicar somente após `supabase db push --dry-run` listar exclusivamente migrations esperadas. A Edge Function não deve ser publicada/habilitada sem o segredo e os verificadores reais. Web/PWA/Capacitor compartilham os novos arquivos do diretório `crm` pelo bundle da Fase H.

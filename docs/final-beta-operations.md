# Operações comerciais da rodada final

Esta entrega adiciona uma fundação operacional tenant-scoped para captação, proprietários, campanhas, metas, distribuição, preferências do dashboard e integrações. Nenhuma rotina altera imagens, billing ou permissões históricas.

## Captação e proprietário

`property_owners` armazena apenas contato e observações comerciais necessárias. `property_acquisitions` mantém um pipeline separado do funil comprador, com responsável, próxima ação e motivo de perda. Owner e manager administram; agent enxerga somente captações atribuídas. Triggers impedem referências cruzadas entre organizações.

## Marketing

`marketing_campaigns` guarda UTM, período e custo opcional. Leads aceitam atribuição estruturada de `source`, `medium`, `campaign`, `content`, `term`, landing page e imóvel/campanha. ROI, CPL e CAC permanecem desconhecidos enquanto custo ou volume necessário não existir; não há conversão de `null` em zero.

## Equipe e metas

`lead_distribution_settings` nasce em modo manual e desativado. Owner/manager podem optar explicitamente por round-robin, menor carteira, origem ou imóvel. `assign_lead_by_rule` valida membership e audita a atribuição. `sales_goals` suporta leads, contatos, visitas, propostas, vendas e VGV por pessoa ou equipe.

## Importação, simuladores e comparação

`operations-suite.js` fornece parser CSV com preview por linha, mapeamento, validação de contato e duplicados no arquivo. Linhas inválidas não são silenciosamente aceitas. Simulação de financiamento exige taxa e prazo informados e sempre se identifica como estimativa, não proposta bancária. O comparador usa somente dados cadastrados e não inventa zeros para campos desconhecidos.

## Organização, dashboard e integrações

Branding básico é atualizado exclusivamente por RPC de owner e mantém a identidade global do VC Imob. Preferências de widgets são próprias do usuário. Webhooks exigem HTTPS, são owner-only e armazenam somente digest SHA-256 do segredo; a entrega externa e retenção segura do material de assinatura exigem worker/Edge Function configurado antes de ativação comercial.

## Segurança e operação

Todas as tabelas novas têm RLS ativada e forçada, grants mínimos, índices operacionais e validações de referências tenant-scoped. Funções sensíveis usam `security definer`, `search_path=''`, autorização pela sessão e auditoria sem conteúdo pessoal excessivo.

## Bloco 3 — operação de captação

A migration `20260915050000_capture_marketing_secure.sql` remove escrita direta nas estruturas de captação e campanhas e concentra mutações em RPCs que derivam organização, papel e responsável da sessão. O funil de captação é independente do funil comprador, mantém atividades e histórico, e a conversão cria somente um imóvel em rascunho, de forma idempotente e sem publicação automática.

O CRM oferece ficha 360 do proprietário/captação, filtros por etapa e responsável, próxima ação, motivo de perda, atividades editáveis e vínculo com propostas do imóvel captado. Agents operam apenas registros próprios; owner/manager podem atribuir e converter.

QRs são gerados localmente no navegador para páginas públicas já publicadas. UTMs são limitadas, normalizadas e capturadas pela Edge Function `site-lead`; a landing page aceita somente o domínio oficial. A RPC pública de captura atribuída é executável apenas pelo `service_role` da função, nunca pelo navegador.

Campanhas armazenam custo opcional e observação separada dos parâmetros UTM. CPL, CAC e ROI só são calculados quando os denominadores e valores reais existem; valores desconhecidos permanecem `null` e vendas de mesmo valor não são deduplicadas indevidamente.
# Bloco 4 — equipe e operação

O último bloco de desenvolvimento adiciona, sem alterar os fluxos validados dos blocos anteriores:

- visão gerencial objetiva por membro, calculada no backend e restrita a owner/manager no plano EQUIPE;
- metas individuais ou de equipe para contatos, leads, follow-ups, visitas, propostas, vendas e VGV;
- distribuição de leads desativada por padrão, com modos manual, rodízio, menor carteira, origem ou imóvel; a escolha é explícita, auditada e serializada por lock transacional;
- onboarding persistente, pulável e retomável por usuário;
- importação CSV de leads em lotes de até 250 linhas, com preview, validação e rejeição explícita de duplicados;
- exportação tenant-scoped com proteção contra formula injection;
- revisão de possíveis duplicados sem merge destrutivo automático;
- undo real, por dez minutos e vinculado ao ator, para mudança de etapa no Kanban;
- comparador de imóveis e simulador informativo que exige taxa fornecida pelo usuário;
- preferências de dashboard por usuário;
- identidade comercial sem CSS/HTML arbitrário;
- central de segurança baseada apenas em dados disponíveis e fluxo seguro de redefinição de senha;
- fundação de webhooks owner-only. O segredo é retornado uma única vez, somente o hash persiste e a integração nasce desativada. Entregas externas exigem um worker autorizado futuro.

Migration append-only: `20260915060000_team_operations_secure.sql`.

## Dependências externas deliberadamente não simuladas

- mapa: depende de serviço/chave real;
- push web/nativo: depende de VAPID/APNs e infraestrutura de entrega;
- voz e IA generativa: dependem de provider/credencial real;
- entrega de webhooks: depende de worker autorizado e política operacional de retries.

O service worker continua cacheando somente shell estático público. Dados do CRM, respostas REST e tokens não são colocados no Cache Storage.

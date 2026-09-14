# Rodada master pós-beta — 2026-09-14

## Escopo entregue

Esta rodada corrige os dois bloqueios reproduzidos no beta (`permission denied for table properties` e `Lead failed`) sem ampliar permissões de tabela. As mutações críticas passam por RPCs `security definer` com `search_path` vazio, organização derivada da membership ativa, payload em lista permitida, controle de concorrência e auditoria já existente.

- `save_crm_property`: criação/edição de imóvel restrita a owner/manager da própria organização.
- `save_crm_property_with_media`: imóvel, ordem e capa das fotos são confirmados na mesma transação.
- `save_crm_lead`: criação/edição e preferências do lead são atômicas; agente continua limitado aos leads atribuídos a ele.
- O frontend não envia nem pode modificar `organization_id`, ator, role, entitlement ou billing.
- Erros técnicos são registrados sem token/payload e traduzidos para mensagens úteis ao usuário.

## Mobile, dados e apresentação

Os modais móveis usam `visualViewport`, `dvh`, safe areas, scroll interno e bloqueio do body. Kanban mantém apenas o scroll horizontal intencional. Telefone e moeda usam helpers únicos (`bindPhoneInput`, `bindCurrencyInput`) com persistência normalizada/numérica. Nome de apresentação segue perfil, metadata segura e somente então e-mail. O cadastro exige nome e o envia ao Auth para o bootstrap de perfil/organização.

O editor de imóveis resolve URLs estáticas a partir da raiz do site e preserva URLs HTTP/Storage, corrigindo miniaturas sem alterar ou recomprimir arquivos. Upload continua limitado a JPEG/PNG/WebP e 15 MB. Ordem e primeira foto/capa são preservadas explicitamente.

## Inteligência comercial

`premium-intelligence.js` mantém regras determinísticas: Meu Dia, prioridade operacional, próxima melhor ação, comparação de períodos, pipeline, radar de demanda e exportação CSV protegida contra formula injection. O Assistente VC usa apenas fatos retornados pelo backend/RLS; nenhum modelo generativo está conectado e nenhum número é inventado.

## Segurança e operação

As migrations são append-only:

- `20260913120000_master_beta_crud_security.sql`
- `20260914010000_master_beta_atomic_property_media.sql`

Ambas foram aplicadas no projeto de produção e a lista local/remota está em paridade. O smoke autenticado de produção foi transacional (`ROLLBACK`) e cobriu imóvel, mídia/capa, lead/preferências, agenda, proposta e tentativas cross-tenant. Uma consulta posterior confirmou ausência de resíduos sintéticos.

O service worker continua restrito ao shell e assets públicos same-origin de `/crm/`; endpoints Supabase/Auth/RPC e dados privados não entram em Cache Storage. O Capacitor desativa o service worker no wrapper, e `npm run mobile:sync` valida a compatibilidade Web/Android/iOS.

## Dependências externas não simuladas

- IA generativa: requer escolha de provedor, credencial backend e política de retenção; o produto usa hoje o Assistente estruturado real.
- Push PWA/iOS: requer infraestrutura VAPID/APNs e consentimento; a central interna permanece funcional sem push.
- Voz e mapas: não são solicitadas permissões nem exibidos recursos falsos sem provedores/configuração.
- Fase J/lojas: permanece parcial; StoreKit/Play Billing, assinatura e submissão não fazem parte desta rodada.
- Gerador jurídico: não implementado.

## Validação

Use `node --test` em todos os arquivos `tests/**/*.test.mjs` com `PGLITE_PACKAGE` configurado para a regressão completa embutida. Os testes master ficam em `tests/master-beta/`. As suítes C/D/E e Property Ad que dependem do stack Docker continuam disponíveis nos scripts existentes; na ausência do Docker, a reconstrução PGlite de todas as migrations oferece a validação estrutural/RLS sem alterar produção.

# Estabilização VC-Imob

## Escopo e limites

Esta alteração prepara código e testes. Não aplica SQL remoto, não modifica dados existentes, não publica o site nem implanta Edge Functions. Os testes de banco executam a cadeia SQL em PostgreSQL isolado em memória (PGlite), não no projeto Supabase.

## Ambientes

O código-fonte carrega `js/environment.js` com um padrão de desenvolvimento sem chave. O modo demonstração e o catálogo estático continuam disponíveis; autenticação/captação reais permanecem desativadas até configurar o backend local.

Os perfis públicos ficam em `config/environments/{development,staging,production}.json`. Nunca colocar service-role, sb_secret, tokens de usuário ou credenciais de assinatura nesses arquivos. A chave publishable de produção já era pública no frontend; foi centralizada no perfil de produção.

Requisitos: Node >=22.13 (Node 22 ou 24 atual), npm e `npm ci`.

Variáveis opcionais de build:

- `VC_IMOB_SUPABASE_URL`: URL do projeto do ambiente escolhido.
- `VC_IMOB_SUPABASE_PUBLISHABLE_KEY`: somente publishable ou JWT anon local.
- `VC_IMOB_SITE_ORIGIN`: origem sem caminho, utilizada no callback `/crm/confirm.html`.
- `VC_IMOB_ENVIRONMENT`: development por padrão; selecionar produção exige escolha explícita.

Não coloque chaves privadas nessas variáveis. Forneça a chave pública local pelo gerenciador de variáveis do terminal/CI, sem versionar arquivos `.env` reais.

### Desenvolvimento

1. Prepare um Supabase local isolado quando precisar de backend completo. `supabase/config.toml` usa callbacks locais; os scripts PowerShell existentes exigem Docker e pwsh.
2. Configure a chave pública local. O endpoint permitido é local, normalmente `http://127.0.0.1:54321`.
3. Execute `npm run dev`. O script gera `dist/` com a configuração de desenvolvimento e serve em `http://127.0.0.1:4174`.

Sem Supabase local, use demonstração. Nenhum script de build inicia, reseta ou migra banco. O servidor não possui hot reload; reinicie após editar arquivos.

### Staging e previews

Configure URL/chave pública de um projeto Supabase separado e `VC_IMOB_SITE_ORIGIN` com a origem exata do preview; execute `npm run build:web -- --environment staging`. A origem precisa estar na allowlist de callbacks do Auth desse projeto. Adapte também CORS e as variáveis da Edge Function no ambiente de staging.

Staging sem configuração falha antes de gerar artefato. Endereço Supabase de produção e callback oficial de produção são recusados em ambientes não produtivos. O runtime bloqueia também um artefato de produção copiado acidentalmente para preview ou localhost.

### Produção (preparação, sem deploy nesta tarefa)

O comando explícito `npm run build:web -- --environment production` prepara `dist/`, mas não publica. É bloqueado quando `NODE_ENV=test`, `VC_IMOB_TEST_RUN=1` ou `GITHUB_EVENT_NAME=pull_request`. Sirva o artefato apenas no domínio oficial. Não publicar diretamente a raiz do repositório: o código-fonte agora usa configuração segura de desenvolvimento.

O build gera o arquivo público de ambiente e adapta `_headers` ao backend escolhido. Hospedagem precisa suportar `_headers` ou configurar cabeçalhos equivalentes. O bundle mobile usa o mesmo builder; `npm run mobile:build-web` também assume desenvolvimento. Produção móvel requer seleção explícita e runtime nativo Capacitor.

## Cadastro e provisionamento administrativo

Todo usuário novo sem evidência administrativa confiável deve ter nome, telefone, aceite e versões legais reconhecidas pelo servidor. Omitir ou enviar `public_signup=false` em `user_metadata` não dispensa essas regras. Versões aceitas atualmente: `2026-09-12` para termos e privacidade. Alterações legais futuras devem atualizar backend e frontend juntos.

O trigger registra os consentimentos e o trial na mesma transação do cadastro; falhas não deixam organização/perfil órfãos.

Provisionamento legítimo pelo Auth Admin API deve enviar `app_metadata: { vcimob_provisioning: "administrative" }`, definido exclusivamente no servidor com autorização administrativa. Convites oficiais do Auth também são reconhecidos pelo campo confiável `invited_at`. Não aceitar esse marcador em um endpoint público nem copiá-lo de `user_metadata`.

Usuários existentes não são reescritos. Contas administrativas novas continuam criando organização/perfil/vínculo sem inventar consentimentos. Antes de qualquer rollout, inventariar os consumidores do Admin API e atualizar os que criam usuários sem a marca. Revisar o modelo de provisionamento com o responsável pelo Supabase.

## Catálogo e captura

`20261104000000_published_site_lead.sql` compartilha a regra de publicação entre o catálogo e a captura (`is_published` e status available/reserved). O novo RPC `capture_published_site_lead` só pode ser executado por service_role. Ele fixa a organização informada pelo servidor, lê o título no banco e mantém um bloqueio de leitura no imóvel durante a transação de captura.

A Edge Function não consulta mais o JSON estático e ignora organização/título enviados pelo navegador. Mantém CORS, honeypot, atribuição, deduplicação e rate limit. `SITE_LEAD_ORGANIZATION_ID` deve coincidir com a organização do domínio do catálogo. A variável `SITE_PUBLIC_URL` deixou de ser necessária para essa função.

Respostas vazias válidas substituem o cache. Cache foi separado por backend e hostname; o namespace antigo não é reutilizado. Em erro de rede, a contingência continua disponível. Se não for aceitável exibir anúncios anteriores durante indisponibilidade, discutir uma política de expiração mais restrita separadamente.

## Testes

- `npm test`: suíte de arquivos `*.test.mjs`, sequencial, com PGlite fixado no lockfile e fuso America/Cuiaba.
- `npm run test:unit`: frontend e contratos de código.
- `npm run test:db`: banco isolado e segurança SQL.
- `npm run test:stabilization`: regressões desta alteração (catálogo, modal, handler real com dependências simuladas, cadastro, organização e configuração).

O runner configura `PGLITE_PACKAGE` para os testes legados e carrega uma proteção contra fetch remoto. Os runners REST legados também passam por uma validação estrita de endpoint local, inclusive contra URLs com localhost em caminho/credenciais. Não use staging ou produção nesses runners.

Testes SQL usam fixtures administrativas explícitas; os novos testes de cadastro usam app_metadata vazio e tentam falsificar apenas metadados editáveis pelo usuário. PGlite não substitui Auth, gateway, Storage ou o runtime Deno completo.

Os smoke tests de navegador legados dependem de Chrome no Windows; sua ausência deve aparecer como teste ignorado. `tests/auth/clean-ui-browser-smoke.mjs` tem ativação própria. Os runners REST de fase C/D/E e property-ad exigem stack local e fixtures, não são iniciados por `npm test`.

`.github/workflows/ci.yml` instala dependências e executa testes/build de desenvolvimento em push/PR. Não contém deploy nem credenciais de produção.

## Rollout futuro e riscos

1. Revisar o PR e reconciliar o histórico de migrações do ambiente alvo.
2. Validar as duas novas migrações em Supabase local completo/staging e os fluxos administrativos reais.
3. Em uma mudança operacional separada e autorizada, disponibilizar o RPC antes de atualizar a Edge Function.
4. Validar CORS, Auth, captura e configuração do artefato em staging antes de qualquer produção.

O novo handler depende do novo RPC; não implantar somente a função. A aplicação desta migração não altera a Edge Function que já está publicada. A migração de consentimentos altera o contrato dos novos cadastros administrativos e deve ser coordenada.

Pendências fora deste recorte: paginação das listagens do CRM, coordenação de refresh de sessão, revisão da CSP inline, E2E multiplataforma, billing e distribuição nas lojas.

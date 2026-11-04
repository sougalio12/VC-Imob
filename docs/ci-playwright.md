# CI e Playwright — VC-Imob

## Workflow único

`.github/workflows/ci.yml` já existia na branch de estabilização. A inspeção do GitHub encontrou execuções aprovadas por `push` e `pull_request` para 10374ae, e o check `tests` estava registrado no PR #1. Não foi possível estabelecer o motivo da ausência anterior na interface; não havia falha de gatilho comprovada. A configuração foi atualizada no mesmo arquivo.

O workflow roda em `pull_request` com destino a main e em push na main. Um push na branch do PR gera somente a execução de pull_request; o gatilho duplicado de push na branch foi removido. O job `tests` foi preservado para manter o nome do check.

Permissões do workflow: somente `contents: read`. Checkout não persiste credenciais. Não são usados secrets, credenciais Supabase, deploy, chamadas de migração remota ou `pull_request_target`.

Etapas: Node 22 atual, `npm ci --ignore-scripts`, Deno typecheck da função sem executá-la, `test:unit`, `test:db`, instalação do Chromium com bibliotecas Linux e `test:e2e`. Bancos de teste são PostgreSQL em memória via PGlite.

## Rodar localmente

```sh
npm ci --ignore-scripts
npm run test:unit
npm run test:db
npm run test:e2e:install
npm run test:e2e
```

No Linux sem bibliotecas do navegador: `npx playwright install --with-deps chromium`. A instalação de bibliotecas pode exigir privilégios locais. Se o cache padrão não for gravável, defina `PLAYWRIGHT_BROWSERS_PATH` para uma pasta gravável nos comandos de instalação e execução. Não há caminho de Chrome fixo no novo Playwright.

`npm test` continua executando a suíte Node completa; Playwright roda separadamente por `test:e2e`. Os antigos smoke tests CDP dependentes do Windows permanecem preservados, e o novo fluxo Linux não depende deles.

## Isolamento

O servidor E2E gera um artefato development local e serve apenas `127.0.0.1:4176`. Seu catálogo possui dois imóveis fictícios em `tests/e2e/fixtures/catalog.json`; notícias também são controladas. Variáveis de backend herdadas do terminal são substituídas no processo de teste por valores locais e uma chave pública fictícia.

O navegador usa um contexto limpo por teste, sem service workers. Somente recursos do servidor local são liberados; RPC de catálogo e captura em `127.0.0.1:54321` são respondidos por mocks. Não é necessário haver Supabase nessa porta. Todas as outras requisições e WebSockets são bloqueados e fazem o teste falhar. WhatsApp é observado por um substituto de `window.open`, sem navegação externa.

A proteção Node em `tests/helpers/no-network.mjs` bloqueia fetch, HTTP/HTTPS e WebSocket remotos, inclusive URLs com localhost disfarçado em credenciais/caminhos. Ela é carregada pelo runner Node, pelo processo Playwright e pelo servidor E2E. As fixtures autorizadas do navegador não abrem conexões reais com o backend.

E2E exercita home, filtro do catálogo, navegação ao anúncio, dados/galeria do imóvel, validação e envio sintético do modal, limpeza/reabertura e continuar sem cadastrar dados, além de catálogo vazio após cache preenchido. São cinco cenários em Chromium desktop e viewport mobile, dez execuções.

## Relatórios

Playwright produz relatório HTML em `playwright-report/` e JUnit em `test-results/e2e.xml`. Em falhas, retém screenshots, traces e vídeos em `test-results/artifacts/`.

O passo `actions/upload-artifact` roda quando o job falha e publica essas pastas, se existirem, com retenção de sete dias. Os arquivos não são versionados e contêm somente dados sintéticos. Para investigar localmente, use `npx playwright show-report` ou `npx playwright show-trace caminho/trace.zip`.

## Evidência local desta alteração

- `npm run test:unit`: 424 aprovados, 0 falhas, 1 ignorado (smoke CDP legado do Windows).
- `npm run test:db`: 139 aprovados, 0 falhas; nenhum banco remoto.
- `npm run test:e2e`: 10 aprovados, 0 falhas, 0 ignorados, Chromium desktop/mobile.
- `npm ls --depth=0` e `git diff --check`: aprovados.

A primeira execução E2E falhou porque o setup tentava gravar localStorage em about:blank. Relatórios, screenshots, vídeos e traces foram produzidos; o setup passou a executar somente na origem local e a reexecução completa passou. Não foi necessário alterar o código funcional do site.

A validação da execução real do Actions deve ser feita no SHA enviado, conferindo evento pull_request, PR #1 e os passos de Chromium. Um teste local aprovado não comprova uma execução remota.

## Diagnóstico da execução remota

Após o push de 4b7c62e, o GitHub confirmou o SHA na referência e dois commits na comparação com main, mas o PR ainda listava apenas 10374ae e não havia execução para o novo SHA. Fechar/reabrir o mesmo PR atualizou sua cabeça e gerou a execução pull_request [41814482742](https://github.com/sougalio12/VC-Imob/actions/runs/41814482742).

Essa execução falhou no typecheck porque `deno.lock` também registra as dependências npm do workspace e ainda não incluía Playwright. O lockfile foi regenerado com Deno 2.5.6 e a checagem local `deno check --frozen supabase/functions/site-lead/index.ts` passou. A exigência `--frozen` do CI foi preservada. O resultado da execução posterior deve ser conferido no PR, sem usar os checks do commit anterior como evidência.

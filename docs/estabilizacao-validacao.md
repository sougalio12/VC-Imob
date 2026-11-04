# Validação da estabilização — 2026-11-04

Branch local: `fix/estabilizacao-vcimob`.
Base: `3fb6e23125be6d14e7b3baeacc55309caa0463c2`.

Executado nesta tarefa:

| Verificação | Resultado |
| --- | --- |
| `npm test` — execução final | 562 testes: 561 aprovados, 0 falhas, 1 ignorado |
| `npm run test:stabilization` | 30 aprovados, 0 falhas |
| `npm run build:web` — desenvolvimento | Aprovado; somente artefato local em dist/ |
| Bundle mobile via teste H23 | Aprovado; somente artefato local |
| `deno check supabase/functions/site-lead/index.ts`, Deno 2.5.6 | Aprovado; com trust store do sistema |
| `git diff --check` | Aprovado |
| `node --import ./tests/helpers/no-network.mjs tests/auth/clean-ui-browser-smoke.mjs` | 1 ignorado por depender de Chrome no Windows/ativação específica |

O teste de navegador `tests/share-news-browser.test.mjs` foi o ignorado da suíte principal: caminho fixo do Chrome no Windows ausente neste ambiente Linux. Não há afirmação de validação visual real ou E2E no navegador nesta tarefa.

A primeira execução completa teve 556 aprovações, 2 falhas e 1 ignorado: um teste antigo assumia fuso America/Cuiaba e uma asserção textual ainda apontava para o handler anterior. O runner passou a fixar o fuso e a asserção foi atualizada para o novo módulo; as execuções subsequentes passaram. Novas regressões foram adicionadas depois e estão incluídas na contagem final.

A primeira tentativa de typecheck Deno falhou por CA desconhecida no proxy do ambiente; repetir com `DENO_TLS_CA_STORE=system` resolveu, sem desativar verificação TLS. O SDK Supabase do entrypoint foi fixado em 2.118.0 e o deno.lock foi versionado.

Não executado:

- Integração REST/Edge Functions contra Supabase completo: Docker local inacessível por permissão e ferramentas Supabase CLI/pwsh ausentes.
- Scripts PowerShell de preparação/limpeza: pwsh ausente. Foram atualizados para fixtures administrativas e imóvel sintético local, mas precisam de validação em ambiente apropriado.
- Instalação/execução em Android/iOS, compras e distribuição nas lojas.
- Migrações remotas, mudanças de dados reais, publicação de site e deploy de funções.

As 42 migrações foram exercitadas exclusivamente em bancos PGlite descartáveis pelos testes SQL. As duas novas migrações permanecem como código para revisão; nenhum banco remoto foi alterado.

Riscos de integração: coordenar RPC antes do novo handler, configurar projeto separado de staging/callbacks/CORS e atualizar consumidores administrativos para app_metadata confiável. Detalhes em `docs/estabilizacao-vcimob.md`.

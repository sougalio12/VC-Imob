# VC Imob 2.0 — Etapa 1

Base: PR #3, `feat/vc-imob-2-minimal-warm`. PR #2 permanece separado; seu CSS não foi carregado. Nenhuma alteração em CRM, migrações, dados de imóveis ou segredos.

## Implementação

- RPC pública é prioritária, inclusive quando retorna catálogo vazio. Erros usam cache por até 24 horas e depois o JSON original, com aviso de contingência. Timeout de oito segundos. Preview oficial consulta o hostname canônico sem alterar o banco.
- Home limita seis anúncios; catálogo, modalidades, bairro, tipo e histórico preservam parâmetros de URL e estados vazios.
- Aluguel usa preço real e `/mês`, preservando centavos e tratando preços ausentes ou inválidos sem inventar condomínio. Detalhe também identifica aluguel mensal.
- Cartões mantêm lead e compartilhamento, navegação sem links aninhados, fotos 4:3 e até três características disponíveis.
- WhatsApp usa SITE_CONFIG; botão duplicado removido. Menu tem foco, teclado, Escape, clique externo, scroll lock e safe areas. Splash pode ser pulado, sai ao teclado, respeita sessão e movimento reduzido.
- Formulário de proprietários preservado; links para seções ocultas removidos. Paleta, logotipo, hero e CTA aprovados mantidos.
- Assets alterados usam versão na URL para invalidar caches anteriores. Preview imutável é usado para a inspeção final.
- Workflow GitHub Actions produz o check obrigatório `tests`; nenhuma proteção de branch foi alterada.

## Evidências locais — 2026-11-09 UTC

Comando de regressão:

```sh
node --test tests/auth/*.test.mjs tests/public-site.test.mjs tests/news-and-share.test.mjs tests/final-round/platform-hardening.test.mjs tests/master-beta/frontend.test.mjs tests/phase-h/phase-h.test.mjs tests/phase-i/phase-i.test.mjs tests/phase-j/phase-j.test.mjs tests/vc-imob-2/fallback.test.mjs
```

Resultado: **184 testes passaram**. Inclui build mobile reproduzível, autenticação, isolamento de cache, formulários/CRM, compartilhamento e seis novos casos de RPC/fallback. Não há lint ou build de site estático configurado. `node --check` passou nos scripts alterados; `git diff --check` passou.

```sh
python3 -m http.server 8000
node tests/vc-imob-2/browser.cjs
```

Matriz Chromium e WebKit, desktop e iPhone 13: filtros, preço, histórico, menu visível, Tab/Shift+Tab, Escape, backdrop, fechamento por link, ausência de overflow, lead sem envio, âncoras e estados vazios. Desktop também testa home com sete registros exclusivamente na fixture de teste, catálogo completo, RPC vazia, rede lenta (750 ms), falha remota com cache e JSON, splash/Pular/sessão. Todos os contextos iniciais usam `prefers-reduced-motion: reduce`.

As fixtures são snapshots públicos de leitura, nunca enviadas ao banco. Nenhum lead fictício foi criado. Screenshots ficam em `artifacts/vc-imob-2` e são publicados como artefato do workflow.

No ambiente cloud faltavam bibliotecas WebKit. Foram baixados pacotes oficiais Debian, verificados por SHA256 do índice e extraídos em `/tmp`. O wrapper temporário preserva LD_LIBRARY_PATH, pois o wrapper do Playwright o sobrescreve. O pré-check ldconfig foi desativado apenas localmente após comprovar carregamento da biblioteca GLES; os testes reais de WebKit foram executados. O CI usa `playwright install --with-deps` normalmente.

## Supabase — consultas somente leitura

RPC real retornou seis anúncios ativos, incluindo VCI000007, finalidade `locacao`, preço 2300, bairro Bandeirantes, tipo Apartamento e dataPublicacao 2026-11-09. JSON local não foi atualizado artificialmente.

Consulta de catálogo de sistema confirmou RLS nas **50 tabelas públicas**. A RPC é STABLE, filtra tenant, publicação e disponibilidade; seu SECURITY DEFINER e search_path vazio são intencionais. Nenhuma SQL de escrita foi executada.

Advisors existentes: 15 tabelas com RLS sem policies (acesso direto fechado), `set_updated_at` sem search_path fixo, funções SECURITY DEFINER executáveis, proteção de senhas vazadas desativada. Estes avisos precisam de avaliação própria; não foram corrigidos automaticamente nesta mudança visual.

Referências: [RLS sem policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [SECURITY DEFINER público](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Publicação

Preview de branch: https://feat-vc-imob-2-minimal-warm.valdiney-im-veis.pages.dev

O preview de `ff4c13a` foi validado com RPC real em Chromium/WebKit, desktop/iPhone: VCI000007, preço, detalhe, home, WhatsApp e redirect do CRM para login. A rodada adicional de foco identificou e corrigiu a regra antiga `display:none` e o breakpoint 1100px; o drawer fechado também não deixa área rolável lateral. A matriz local ampliada passou após esta correção.

O check `tests` de `ff4c13a` passou no GitHub: https://github.com/sougalio12/VC-Imob/actions/runs/42712897822

O commit final também exige check verde e smoke do preview antes do merge protegido. Resultado final de publicação e verificação pública será registrado no PR #3. Nenhum teste autenticado de conta real do CRM nem envio real de lead é afirmado; a entrada protegida e a regressão do código preservado são verificadas sem criar dados.

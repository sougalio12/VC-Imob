# Abertura VC Imob 2.0

Base: main após o PR #4 (merge 34fb548). Alteração limitada à abertura; CRM, Supabase, dados, catálogo, menu, cartões, filtros, rodapé e formulários não foram alterados.

## Comportamento

A abertura contém apenas a marca original e os dois textos aprovados. O botão Pular, seu CSS e seus handlers foram removidos. A lógica foi isolada em `js/welcome.js`; não há dependências novas nem requisições de rede nesse módulo.

- Logo: entrada de 620 ms, com opacidade e deslocamento vertical de 6 px.
- Título: letras entram a partir de 250 ms, em intervalos de 18 ms.
- Subtítulo: letras entram a partir de 1050 ms, após a entrada completa do título, em intervalos de 12 ms.
- Permanência: todos os elementos ficam visíveis antes da saída.
- Letras saem progressivamente a partir de 2400/2450 ms; logo sai a partir de 3100 ms.
- Fundo #F5F1EA dissolve entre 3400 e 3750 ms.
- Timer independente remove o overlay em 3800 ms mesmo com animações CSS desativadas. Retorno à aba também verifica o prazo.

Textos completos ficam disponíveis a leitores de tela; letras visuais usam `aria-hidden`. Abertura executa uma vez por sessão. Movimento reduzido ou armazenamento de sessão indisponível levam diretamente à home. O overlay não captura foco nem exige interação.

A logomarca original disponível é JPEG. A composição multiply já validada integra visualmente o branco ao bege, preservando exatamente os pixels da identidade; nenhum redesenho ou arquivo gerado foi usado. Ela mantém proporção, enquadramento e tamanho responsivo da versão aprovada no PR #4.

## Verificação local

184 testes de regressão existentes passaram, incluindo build mobile, autenticação e site público:

```sh
node --test tests/auth/*.test.mjs tests/public-site.test.mjs tests/news-and-share.test.mjs tests/final-round/platform-hardening.test.mjs tests/master-beta/frontend.test.mjs tests/phase-h/phase-h.test.mjs tests/phase-i/phase-i.test.mjs tests/phase-j/phase-j.test.mjs tests/vc-imob-2/fallback.test.mjs
```

```sh
python3 -m http.server 8000
node tests/vc-imob-2/browser.cjs
node tests/vc-imob-2/welcome.cjs
```

Matriz existente aprovada em Chromium/WebKit, desktop/iPhone. Testes específicos aprovados nos quatro perfis: sequência de entrada/saída, opacidade progressiva, logo saindo por último, dissolução, ausência de botão, textos acessíveis, geometria estável, ausência de overflow e sessão única. Nos dois engines, também passaram timer com animações desativadas, movimento reduzido e storage bloqueado.

Gravação real local: duração medida de 3800,6 ms; ao encerrar, documento `complete` e seis cartões carregados. Evidências locais em `artifacts/vc-imob-2/welcome-*` e vídeo em `artifacts/vc-imob-2/welcome-video/`. O CI publica screenshots como artefatos.

O ambiente cloud usa as bibliotecas WebKit temporárias previamente verificadas em `/tmp` e wrapper que preserva LD_LIBRARY_PATH. O CI instala dependências normalmente com Playwright.

## Preview e produção

A execução remota reproduz os testes existentes e específicos. Preview e domínio oficial devem ser inspecionados antes e depois do merge protegido. O resultado real e os endereços ficam registrados no PR correspondente; este documento não antecipa publicação.

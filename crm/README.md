# VC Imob CRM

Site/CRM em JavaScript, com Auth, RPCs e Storage no Supabase.

A configuração do navegador é compartilhada por `js/environment.js` e `js/runtime-config.js`. A cópia de código-fonte assume desenvolvimento sem credenciais; mantenha apenas chaves públicas no frontend. Use `npm ci`, `npm run dev` e `npm test`.

A cadeia de banco está em `supabase/migrations/`. Não instale apenas o SQL inicial nem execute os históricos indiscriminadamente em produção.

Leia [ambientes, cadastro administrativo e testes](../docs/estabilizacao-vcimob.md) antes de configurar o backend. O modo demonstração continua disponível sem backend. O site já integra catálogo e captação pública; o adaptador legado não é o caminho principal do site.

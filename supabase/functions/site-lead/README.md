# Edge Function site-lead

Recebe interesses públicos, valida campos/CORS/honeypot, aplica rate limit e chama `capture_published_site_lead`. A organização vem exclusivamente de `SITE_LEAD_ORGANIZATION_ID`; o título e a publicação são confirmados no banco na mesma transação de captura, usando a regra do catálogo público. Nenhuma consulta ao JSON estático é feita.

Configuração no servidor, sem versionar valores privados:

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: disponibilizados pelo Supabase no runtime da função.
- `SITE_LEAD_ORGANIZATION_ID`: organização correspondente ao domínio do catálogo.
- `SITE_LEAD_ALLOWED_ORIGINS`: origens permitidas separadas por vírgula, próprias do ambiente.
- `SITE_LEAD_RATE_LIMIT_SALT`: segredo aleatório do ambiente.

`SITE_PUBLIC_URL` não é mais necessária. O novo RPC exige `supabase/migrations/20261104000000_published_site_lead.sql`; revisar/aplicar em ambiente isolado antes de planejar atualização da função. Não implantar o handler antes do RPC.

O RPC é fechado a anon/authenticated. O wrapper preserva a captura com atribuição e deduplicação já existentes, incluindo histórico de interesse. O handler pode ser exercitado sem rede através da fábrica `createSiteLeadHandler` e dependências simuladas.

Procedimentos de ambientes, cadastro administrativo, testes e limites: [estabilização](../../../docs/estabilizacao-vcimob.md). Nenhum comando de deploy é executado pelo build ou pelos testes desta alteração.

# Edge Function `site-lead`

Esta função recebe interesses do site público, valida os campos, limita tentativas por origem e grava o lead no CRM. Ela nunca aceita `organization_id` ou o título do imóvel do navegador: a organização vem de um segredo da função e o imóvel/título é confirmado no catálogo público ativo.

## Pré-requisitos manuais

1. Execute manualmente `supabase/20260825_add_site_lead_capture.sql` e `supabase/20260825_add_site_lead_deduplication.sql` no SQL Editor.
2. Defina os segredos no projeto Supabase (substitua os valores pelos valores reais):

```sh
supabase secrets set SITE_LEAD_ORGANIZATION_ID="uuid-da-organizacao-do-crm"
supabase secrets set SITE_PUBLIC_URL="https://valdineycapistranoimoveis.com.br"
supabase secrets set SITE_LEAD_ALLOWED_ORIGINS="https://valdineycapistranoimoveis.com.br"
supabase secrets set SITE_LEAD_RATE_LIMIT_SALT="valor-aleatorio-longo-e-secreto"
```

Para desenvolvimento local, inclua também a origem local em `SITE_LEAD_ALLOWED_ORIGINS`, separada por vírgula. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são disponibilizados somente no ambiente da Edge Function pelo Supabase; nunca os coloque no frontend, em arquivos de configuração públicos ou no repositório.

3. Publique manualmente a função como endpoint público (a validação acontece dentro dela):

```sh
supabase functions deploy site-lead --no-verify-jwt
```

O site só envia nome, telefone, e-mail opcional, código do imóvel e um campo honeypot. A Publishable Key usada pelo navegador não concede `insert` público em `leads`; o insert é feito no ambiente protegido da função, após validação e rate limit.

Antes de criar um lead, a função privada `capture_site_lead` procura apenas leads abertos da organização. Ela prioriza o telefone normalizado e usa o e-mail informado como correspondência complementar. Todo contato repetido cria uma nota de histórico com origem e data/hora, sem alterar a etapa; quando o imóvel muda, a nota também registra o interesse anterior antes da atualização do imóvel principal.

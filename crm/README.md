# VC Imob CRM

## Configuração do Supabase

1. Crie um projeto no Supabase e execute `../supabase/20260824_initial_crm.sql` no SQL Editor.
2. Em `crm/js/config.js`, informe somente `supabaseUrl` e `supabasePublishableKey` com os valores públicos do projeto. A Publishable Key substitui a antiga nomenclatura de anon key.
3. Nunca use ou publique uma `service_role key` no navegador.
4. Crie o primeiro usuário no Supabase Auth. O trigger SQL cria o perfil e a organização inicial.
5. Se o CRM autenticado retornar `permission denied`, execute manualmente `../supabase/20260825_grant_authenticated_crm.sql`. Ele concede permissões somente ao papel `authenticated`; o RLS continua responsável pelo isolamento por organization.

Enquanto os placeholders estiverem presentes, use **Entrar em modo demonstração**. Os dados de demonstração vivem apenas em memória e são perdidos ao recarregar a página.

## Integração futura do site

`crm/js/site-lead-adapter.js` expõe `registerSiteLead({ name, phone, email, propertyCode, propertyTitle })`. O arquivo não é carregado pelo site público nesta fase. Quando um formulário de captação for aprovado, ele poderá chamar esse adaptador antes ou depois da abertura do WhatsApp.

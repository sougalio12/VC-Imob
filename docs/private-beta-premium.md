# Evolução pós-beta privado

## Arquitetura

O CRM e o catálogo público passam a compartilhar `public.properties` e `public.property_media` como fonte de verdade. Somente owner e manager alteram o catálogo; membros ativos podem consultá-lo no CRM. O site lê exclusivamente o RPC `list_public_properties(hostname)`, que devolve um JSON público reduzido e apenas imóveis publicados nos estados disponível ou reservado. O arquivo `data/imoveis.json` permanece como fallback estático de disponibilidade e SEO, não como segunda interface de edição.

Os imóveis históricos são semeados por `scripts/build-catalog-seed.mjs`. O script preserva códigos, conteúdo, capa e ordem das imagens. As imagens existentes continuam nos mesmos arquivos e não são reprocessadas.

## Operação premium

- ficha 360 do lead reúne preferências, interesses, matching explicável, agenda, propostas e timeline auditada;
- matching permanece determinístico: banco e regras de negócio calculam compatibilidade; nenhum modelo decide permissões ou resultados;
- propostas são registros comerciais, não documentos jurídicos, e seguem o acesso ao lead;
- notificações internas são deduplicadas e vinculadas a ações; push externo não foi ativado, pois não há infraestrutura VAPID autorizada;
- busca global, briefing, status do site e relatórios usam RPCs tenant-scoped;
- gestão de imóveis inclui rascunho/publicação, fotos, capa e ordenação com upload restrito a imagens de até 15 MB;
- o Assistente VC entregue nesta rodada é um copiloto estruturado baseado em fatos calculados no backend. Nenhum provedor generativo foi conectado e a interface não simula IA generativa.

## Segurança e planos

Todas as tabelas novas possuem `organization_id`, RLS forçada, grants por coluna e políticas baseadas em membership ou acesso ao lead. O RPC público não expõe rascunhos nem campos privados. START recebe gestão essencial de imóveis e relatórios básicos; PRO recebe matching central, propostas, notificações, relatórios avançados e Assistente VC; EQUIPE acrescenta operação gerencial. A licença interna EQUIPE/billing-exempt existente não é alterada.

## Migration e publicação

Aplicar `20260913000000_private_beta_premium.sql` pelo fluxo normal do Supabase, após dry-run. Depois, gerar e executar o seed:

```powershell
node scripts/build-catalog-seed.mjs > catalog-seed.sql
supabase db query --linked --file catalog-seed.sql
```

O seed deve ser executado somente no projeto vinculado correto e após confirmar que o domínio aponta para a organização interna esperada.

## Dependências externas

Push PWA e redação generativa exigem provedor/credenciais de backend ainda não escolhidos. Nada foi colocado no frontend. StoreKit 2, Google Play Billing, builds assinados e publicação em lojas permanecem no estado parcial documentado na Fase J.

## Validação

Executar `tests/private-beta`, regressões C–J, site público e Property Ad. Para banco, usar Docker/Supabase local quando disponível ou PGlite. Validar também 390×844, 430×932, tablet e desktop, preservando o scroll horizontal intencional do Kanban.

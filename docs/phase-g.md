# Fase G — Mobile e PWA

## Escopo

A Fase G adiciona uma camada responsiva e instalável ao CRM existente sem alterar banco, autenticação, RLS, billing ou funcionalidades da Fase F. O site público permanece fora do escopo do aplicativo instalado.

## Navegação e experiência mobile

- Até 820 px, o CRM usa uma barra inferior com Início, Leads, Funil, Agenda e Mais.
- Mais abre a navegação lateral existente para Imóveis, Equipe, Plano/Assinatura, site público e logout.
- A navegação inferior e os painéis respeitam as safe areas do iOS.
- Tabelas de leads e equipe são apresentadas como cards rotulados no celular, sem alterar o HTML ou as permissões das ações.
- Kanban mantém rolagem horizontal controlada, drag por alça e seletor de etapa acessível.
- Modais viram painéis inferiores com altura baseada em `dvh`, rolagem interna e ações fixas.
- Inputs móveis usam fonte de 16 px e `inputmode` coerente para telefone, e-mail e números.

## PWA

- Manifest: `crm/manifest.webmanifest`.
- Escopo e ID: `/crm/`.
- Entrada: `/crm/index.html?source=pwa`; a autenticação existente redireciona usuários sem sessão para o login.
- Modo: `standalone`, com fallback para `minimal-ui`.
- Ícones 192, 512, maskable 512 e Apple Touch Icon são derivados tecnicamente do símbolo oficial já versionado.
- Atalhos: Leads, Funil e Agenda.

## Service worker e privacidade

O service worker controla somente `/crm/` e usa uma allowlist de shell público:

- CSS e JavaScript do CRM;
- manifest e ícones;
- página offline sem dados comerciais.

Navegações usam rede e, na falha, mostram `offline.html`. Assets permitidos usam rede com fallback para cache. Requisições externas, Supabase, REST, Auth, Functions, dados de leads, notas, equipe, billing e respostas autenticadas não são interceptadas nem gravadas em Cache Storage.

O cache tem versão explícita e caches antigos prefixados por `vc-imob-` são removidos no `activate`. O arquivo do service worker recebe `no-cache` em `_headers`; uma versão instalada nova passa a valer na próxima abertura sem recarregar formulários em andamento.

## Instalação

- Chromium: o CTA aparece somente após `beforeinstallprompt`, não reaparece na sessão depois de rejeitado e some quando instalado.
- iOS: orientação contextual para Compartilhar → Adicionar à Tela de Início; fica oculta em standalone e após confirmação na sessão.
- A ausência dessas APIs não afeta o CRM normal.

## Segurança

- Nenhum token, secret ou dado privado é incluído no manifest/service worker.
- Sessão e logout continuam usando a implementação existente.
- O PWA não modifica regras de autorização e não cria armazenamento offline de dados privados.
- Nenhuma migration é necessária.

## Testes

Execute:

```powershell
.\scripts\test-phase-g.ps1
```

A suíte cobre manifest, ícones, escopo, navegação mobile, safe areas, tabelas, formulários, modal, reduced motion, instalação, offline, versionamento de cache, allowlist e bypass de APIs privadas.

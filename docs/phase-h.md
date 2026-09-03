# Fase H — distribuição mobile

## Decisão arquitetural

O VC Imob usa Capacitor 8 como contêiner web-native, mantendo HTML, CSS e JavaScript como fonte principal. O build cria um bundle local mínimo em `dist-mobile`, sem `server.url`: o shell e os assets são instalados no aplicativo, enquanto Supabase continua remoto por HTTPS e protegido pelas mesmas RLS/RPCs. PWA, site público e CRM web continuam independentes do wrapper.

Foram descartadas PWA pura (não atende distribuição nativa completa) e um WebView remoto simples (dependência integral do deploy web, experiência mais frágil e maior risco de rejeição por baixo valor nativo). Uma implementação nativa duplicada aumentaria custo e divergência sem benefício proporcional nesta fase.

- Nome: `VC Imob`
- Package/bundle ID: `br.com.valdineycapistrano.vcimob`
- Versão inicial: `1.0.0`; Android `versionCode 1`; iOS `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1`.
- Entrada local: `/index.html`, que direciona ao login local em `/crm/login.html`.
- APIs: somente `https://isbkhhobutbdtdtpaavn.supabase.co`, usando a Publishable Key pública já destinada a clientes.

## Build e sincronização

1. `npm ci`
2. `npm run mobile:sync`
3. Android: abrir `android/` no Android Studio ou executar `android/gradlew assembleDebug` com JDK/SDK compatíveis.
4. iOS: abrir `ios/App/App.xcodeproj` no Xcode e escolher a equipe de assinatura.

`dist-mobile`, assets web copiados às plataformas, e artefatos de build não são versionados. O script `scripts/build-mobile.mjs` reconstrói o bundle; `scripts/generate-mobile-assets.ps1` documenta a derivação técnica de ícones/splash a partir dos PNGs oficiais existentes. Keystores, certificados, provisioning e arquivos de ambiente estão ignorados.

## Auth, storage e segurança

A autenticação continua sendo Supabase Auth por senha, sem fluxo paralelo. Access/refresh tokens permanecem no `sessionStorage` do WebView como no CRM web; não foram movidos para Preferences, cookies menos restritos ou Cache Storage. Isso privilegia não piorar o armazenamento existente; uma futura persistência nativa entre encerramentos completos deve usar Keychain/Keystore por plugin auditado, nunca armazenamento simples.

Logout chama Supabase e sempre remove sessão/contexto locais. RLS, membership ativa, papéis e isolamento multi-tenant continuam sendo a autoridade. Não há `service_role`, senha, token privado ou segredo no bundle. O service worker roda somente na Web/PWA e é explicitamente desativado no Capacitor, evitando caches/versionamentos concorrentes. Offline usa o estado já existente e não persiste dados privados.

Android permite apenas `INTERNET`, bloqueia cleartext e backup. iOS não declara câmera, microfone, fotos, localização ou contatos; ATS permanece restritivo por padrão. Não há SDK de analytics, anúncios, tracking ou push.

## Navegação e deep links

Rotas locais do CRM e detalhes de imóvel permanecem no app. Site público e HTTPS externos abrem no navegador seguro do sistema; `tel:` e `mailto:` usam o aplicativo apropriado; WhatsApp usa o fluxo externo existente. Deep links mínimos aceitam somente `vcimob://crm/{dashboard|leads|kanban|properties|agenda|team|billing}`. Valores desconhecidos falham fechados.

Universal Links/App Links verificados ficam pendentes porque exigem Apple Team ID e impressão digital da chave real Android. Não devem ser publicados com identificadores inventados.

## Billing e políticas das lojas

A tela nativa permanece somente informativa: mostra plano/uso e declara que mudanças são processadas pelo canal comercial; não inicia compra nem contém link de pagamento. A abstração backend já aceita provedores `apple` e `google`, mas nenhuma cobrança foi implementada.

Para distribuição pública, assinatura de funcionalidade digital/SaaS normalmente exige avaliação de Apple In-App Purchase e Google Play Billing. A exceção Apple para serviços empresariais pode ser aplicável somente se o produto for efetivamente vendido a organizações para seus usuários; a decisão depende do modelo comercial/distribuição. No Google Play, software de produtividade e cloud services estão abrangidos pela política de pagamentos, salvo exceção/região/programa aplicável. Não se deve adicionar CTA externo antes dessa decisão.

Referências oficiais para revisão no momento da submissão:

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- Capacitor: https://capacitorjs.com/docs

## Inventário técnico de privacidade

Dados processados: conta (ID, nome e email), organização/membership/papel, leads (nome, telefone, email, origem, interesse, notas e histórico), imóveis, tarefas/agenda, equipe, auditoria e metadados de assinatura. Finalidades: autenticação, operação do CRM, atribuição, acompanhamento comercial, segurança, auditoria e aplicação de entitlements. Armazenamento remoto: Supabase; armazenamento local transitório: sessão e contexto no `sessionStorage`. Compartilhamento técnico conhecido: Supabase como infraestrutura; WhatsApp/telefone/email somente por ação explícita do usuário. Não há coleta de localização, contatos, identificadores de publicidade ou diagnóstico nativo nesta fase.

Esse inventário auxilia Apple App Privacy e Google Data Safety, mas não substitui revisão jurídica nem autoriza declarar conformidade não verificada. A política de privacidade existente no site deve ser revisada juridicamente e receber URL pública estável antes da submissão.

## Exclusão de conta

O app atual não oferece criação de conta; usuários entram com contas provisionadas pela operação. Não foi implementada deleção destrutiva: em ambiente multi-tenant, apagar um owner pode afetar organização, billing, auditoria e dados de terceiros. Antes de habilitar auto cadastro ou submissão pública, definir e implementar fluxo autenticado de solicitação/exclusão, sucessão do owner, retenções legais e URL web externa. Apple exige exclusão no app quando o app permite criação de conta; Google exige fluxo no app e recurso web quando há criação de conta. Referência Google: https://support.google.com/googleplay/android-developer/answer/13327111

## Checklist humano de publicação

### Apple

1. Manter conta Apple Developer ativa e contratos/dados fiscais aceitos.
2. Registrar o bundle ID exatamente como definido e informar o Team ID no signing.
3. Criar App Store Connect, assinar/archive no macOS/Xcode e enviar o build.
4. Fornecer descrição, categoria, suporte, política de privacidade revisada, screenshots reais sem dados de clientes e respostas App Privacy.
5. Definir com produto/jurídico se distribuição é pública, privada/Custom App ou enterprise e decidir IAP antes de expor aquisição de plano.
6. Fornecer conta de revisão com dados fictícios seguros e instruções; submeter e responder ao review.

### Google Play

1. Manter conta Play Console verificada e contratos aceitos.
2. Criar aplicativo com o application ID exato; habilitar Play App Signing e guardar com segurança a upload key real.
3. Gerar AAB release assinado no Android Studio/JDK/SDK, sem versionar a chave.
4. Preencher descrição, suporte, política de privacidade revisada, screenshots reais sem dados pessoais, classificação e Data Safety.
5. Implementar/fornecer o fluxo e URL de exclusão se criação de conta for habilitada; decidir Play Billing antes de permitir aquisição digital.
6. Executar trilhas de teste exigidas pela conta, corrigir o pre-launch report e promover para produção.

## Limites de validação desta fase

No Windows sem JDK/Android SDK não é possível compilar APK/AAB. Sem macOS/Xcode, equipe Apple, certificados e provisioning não é possível compilar/assinar iOS. Os projetos, configurações e assets ficam versionados e estruturalmente testados; publicação permanece ação humana.

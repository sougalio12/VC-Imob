# Fase J — pré-lançamento do VC Imob 1.0

## Estado e decisão de release

O VC Imob permanece em uma base web/PWA empacotada com Capacitor 8.5.1 para `br.com.valdineycapistrano.vcimob`. A versão comercial continua 1.0.0 (Android 1/1.0; iOS 1/1.0). Web, PWA, Android e iOS consultam o mesmo Supabase e o backend continua sendo a única autoridade de trial, assinatura e entitlement.

Os produtos deste documento e de `store/products.json` são uma configuração **planejada e ainda não criada nas lojas**. Builds, produtos e aplicativos **NÃO publicados**. Não existe credencial Apple/Google, Team ID, upload key ou signing de distribuição neste repositório.

## Billing: limite seguro desta etapa

A interface permanece fail-closed: antes dos adapters verificados, “Escolher plano” e “Restaurar compras” não cobram nem concedem acesso. Isso é intencional. A função `billing-provider-event` também fica desabilitada. Ativá-la antes de validar JWS Apple ou purchase token Google permitiria confiar indevidamente no cliente.

Para o lançamento com aquisição dentro do app ainda é desenvolvimento obrigatório:

1. implementar StoreKit 2 e Play Billing usando os IDs realmente criados;
2. enviar a transação/token ao backend autenticado, associando-o à organização do usuário sem aceitar `organization_id` livre;
3. Apple: verificar JWS/App Store Server API e App Store Server Notifications V2;
4. Google: consultar `purchases.subscriptionsv2.get`, exigir estado comprado/ativo e reconhecer a compra no backend;
5. normalizar somente eventos verificados em `apply_verified_billing_event`;
6. testar compra, restore, renovação, cancelamento, upgrade/downgrade, grace, expiração, refund e revocation em sandbox;
7. só então marcar o catálogo como `created_and_verified` e habilitar o ingress.

Uma única subscription group Apple evita assinaturas simultâneas; EQUIPE é nível 1, PRO nível 2 e START nível 3. A Apple administra upgrade, downgrade, crossgrade e proration. No Google, cada plano usa um produto e base plans `monthly`/`annual`; trocas devem respeitar `linkedPurchaseToken` e os modos oficiais de replacement. O entitlement é da organização e é reconciliado após login em qualquer plataforma; restore nunca concede acesso localmente.

## Apple — sequência humana exata

1. Inscrever/renovar a conta Apple Developer, aceitar acordos e preencher banco/fiscal pelo titular.
2. Registrar o App ID explícito `br.com.valdineycapistrano.vcimob`; fornecer Team ID real ao signing.
3. Criar o registro “VC Imob” no App Store Connect, idioma primário pt-BR e bundle ID exato.
4. Criar um subscription group “VC Imob” e os seis produtos propostos; escolher price points que exibam os preços autorizados no Brasil. O preço exibido no app deve vir da StoreKit, não deste JSON.
5. Configurar App Store Server Notifications V2 em sandbox, implementar/verificar JWS e testar a notificação oficial de teste.
6. No macOS, executar `npm ci`, `npm run mobile:sync`, abrir `ios/App/App.xcodeproj`, selecionar a equipe, resolver signing e gerar Archive. Validar o privacy manifest produzido pelos SDKs efetivamente presentes.
7. Testar StoreKit sandbox e TestFlight interno com conta sintética; depois preencher App Privacy, classificação, screenshots e conta de review.
8. Upload/submissão e ativação de Billing Grace Period só após sandbox. Contratos, impostos, dados bancários, assinatura e botão de submissão são ações humanas.

Sem macOS/Xcode nesta execução não houve compile, Archive ou IPA. Universal Links exigem o Team ID real no `apple-app-site-association`; não publicar placeholder.

## Google Play — sequência humana exata

1. Criar/verificar a conta no Google Play Console pessoal e pagar a taxa pelo titular.
2. Criar o app pt-BR com package `br.com.valdineycapistrano.vcimob`; habilitar Play App Signing.
3. Criar uma upload key em máquina segura, guardar backup e preencher localmente `android/keystore.properties` a partir do exemplo. Nunca versionar a chave.
4. Criar os três produtos e seis base plans propostos, com preços BRL autorizados. Preço no app vem do Play Billing.
5. Vincular projeto Google Cloud, Play Developer API e service account de mínimo privilégio; configurar Pub/Sub/RTDN e validar notificações.
6. Com JDK 21 e Android SDK instalados, executar `npm ci`, `npm run mobile:sync` e `android/gradlew bundleRelease`. O AAB assinado usa a upload key real.
7. Publicar primeiro em Internal testing, validar Billing sandbox e pre-launch report; depois Closed testing.
8. Se a conta pessoal foi criada após 13/11/2023, manter pelo menos 12 testadores opt-in continuamente por 14 dias e então solicitar acesso à produção. Não há testadores inventados nem período iniciado neste repositório.
9. Preencher Data Safety, classificação de conteúdo, público-alvo, declaração de anúncios, acesso do revisor, screenshots e URLs; envio final depende do titular.

Neste Windows não há JDK nem Android SDK; portanto não houve Gradle sync, APK ou AAB. Não foi criada assinatura falsa.

## Metadados, screenshots e review

O texto pt-BR versionado está em `store/metadata/pt-BR.json`. A política, os termos e a página de exclusão usam URLs HTTPS públicas. Os textos são técnicos e precisam de revisão jurídica antes da submissão, inclusive identificação do fornecedor pessoa física, contato, retenção e foro.

Plano de screenshots reais, sem dados de clientes: login/cadastro, dashboard, leads, Kanban, agenda, imóveis, equipe e assinatura. Usar uma organização demo isolada e remover/rotacionar credenciais depois. Para Apple, fornecer entre 1 e 10 imagens aceitas pelo App Store Connect e priorizar o maior tamanho de iPhone suportado; para Google, capturar formatos exigidos pelo Console no momento do envio. Nenhuma imagem promocional fictícia foi gerada.

A conta de review deve ser sintética, limitada, sem dados reais, com trial/entitlement suficiente para avaliação. Sua criação permanente exige decisão operacional sobre rotação e suporte e não foi feita em produção.

## Privacidade, exclusão e permissões

`store/privacy-data.json` é o inventário técnico para App Privacy e Data Safety, não uma declaração jurídica pronta para publicação. Contato, identificador e conteúdo comercial são associados à conta e usados para funcionalidade; não há tracking, publicidade ou SDK nativo de diagnóstico. Supabase e Resend são processadores atuais; Apple/Google entram quando billing estiver ativo.

O cadastro existe dentro do app e a solicitação de exclusão também está na tela de assinatura/conta. Agent/manager e owner com sucessor podem ter acesso revogado sem apagar dados comerciais da organização; owner único abre revisão para não tornar a organização órfã. A URL pública é `/crm/exclusao-de-conta.html`. A remoção final e os prazos de retenção dependem de política jurídica/operacional; não improvisar deleção destrutiva.

Android solicita apenas `INTERNET`, bloqueia cleartext e backup. iOS não declara câmera, microfone, fotos, localização ou contatos. ATS permanece restritivo. O esquema `vcimob://crm/...` está implementado. App Links/Universal Links verificados dependem da impressão SHA-256 da chave Android e do Team ID Apple reais.

## Segurança, builds e checklist de submissão

- Nunca versionar `.jks`, `.keystore`, `.p8`, `.p12`, `.cer`, `.mobileprovision`, service account, tokens ou senhas.
- `npm run release:check` lista bloqueios sem imprimir segredos.
- Confirmar HTTPS do Supabase Site URL e redirects, SMTP/Resend e cadastro antes de cada candidato.
- Executar Fases C–J, site público, Property Ad, `npm audit`, checks JavaScript e secret scan.
- Validar em dispositivo/emulador real: instalação, login, cadastro/confirmação, navegação, billing sandbox, restore, deep links, links externos e logout.
- Submissão final, contratos e publicação exigem autorização expressa.

## Referências oficiais verificadas em 13/09/2026

- Apple subscriptions: https://developer.apple.com/app-store/subscriptions/
- App Store Connect subscriptions: https://developer.apple.com/documentation/appstoreconnectapi/managing-auto-renewable-subscriptions
- App Store Server Notifications: https://developer.apple.com/documentation/appstoreservernotifications
- Apple account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app
- Apple App Privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy
- Apple screenshots: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots
- Google Play Billing: https://developer.android.com/google/play/billing/integrate
- Google subscription lifecycle: https://developer.android.com/google/play/billing/lifecycle/subscriptions
- Google RTDN: https://developer.android.com/google/play/billing/rtdn-reference
- Google account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google personal-account testing: https://support.google.com/googleplay/android-developer/answer/14151465
- Supabase Auth user data: https://supabase.com/docs/guides/auth/managing-user-data
- Capacitor: https://capacitorjs.com/docs

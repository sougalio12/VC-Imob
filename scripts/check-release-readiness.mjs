import { existsSync, readFileSync } from 'node:fs';

const required = [
  'capacitor.config.json', 'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
  'ios/App/App/Info.plist', 'store/products.json', 'store/metadata/pt-BR.json',
  'store/privacy-data.json', 'docs/phase-j.md'
];
const missing = required.filter(path => !existsSync(path));
if (missing.length) throw new Error(`Arquivos obrigatórios ausentes: ${missing.join(', ')}`);
const products = JSON.parse(readFileSync('store/products.json', 'utf8'));
const metadata = JSON.parse(readFileSync('store/metadata/pt-BR.json', 'utf8'));
const blockers = [];
if (products.status !== 'created_and_verified') blockers.push('produtos Apple/Google ainda não foram criados e verificados nas lojas');
if (!existsSync('android/keystore.properties')) blockers.push('upload key Android não configurada localmente');
if (!process.env.APPLE_TEAM_ID) blockers.push('APPLE_TEAM_ID/signing Apple não disponível');
if (!process.env.APP_STORE_CONNECT_KEY_ID) blockers.push('credencial App Store Connect não disponível');
if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT) blockers.push('credencial Google Play Developer API não disponível');
if (!process.env.BILLING_ADAPTERS_VERIFIED) blockers.push('adapters StoreKit/Play Billing ainda não foram validados em sandbox');
console.log(JSON.stringify({ version: '1.0.0', metadata: metadata.name, technicallyPrepared: true, readyToSubmit: blockers.length === 0, blockers }, null, 2));
if (blockers.length) process.exitCode = 2;

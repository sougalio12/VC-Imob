import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const config = json('capacitor.config.json');
const pkg = json('package.json');
const androidManifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const androidBuild = readFileSync('android/app/build.gradle', 'utf8');
const iosPlist = readFileSync('ios/App/App/Info.plist', 'utf8');
const nativeSource = readFileSync('crm/js/native.js', 'utf8');
const pwaSource = readFileSync('crm/js/pwa.js', 'utf8');
const swSource = readFileSync('crm/service-worker.js', 'utf8');

function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function nativeHarness(native = true) {
  const calls = { browser: [], launcher: [], listeners: {}, document: {} };
  const classList = { values: [], add(value) { this.values.push(value); } };
  const location = { href: 'capacitor://localhost/crm/index.html' };
  const Plugins = {
    Browser: { async open(value) { calls.browser.push(value); } },
    AppLauncher: { async openUrl(value) { calls.launcher.push(value); } },
    Network: { addListener(name, fn) { calls.listeners[name] = fn; } },
    App: { addListener(name, fn) { calls.listeners[name] = fn; } }
  };
  const context = vm.createContext({
    URL, Event,
    window: { Capacitor: { isNativePlatform: () => native, Plugins }, location, dispatchEvent() {}, open() {} },
    document: { documentElement: { classList }, addEventListener(name, fn) { calls.document[name] = fn; } }
  });
  vm.runInContext(nativeSource, context);
  return { calls, context, location, classList };
}

test('H01 Capacitor 8 is pinned reproducibly', () => assert.equal(pkg.dependencies['@capacitor/core'], '8.5.1'));
test('H02 app identity is stable', () => assert.deepEqual([config.appName, config.appId], ['VC Imob', 'br.com.valdineycapistrano.vcimob']));
test('H03 local bundle is used instead of a remote server URL', () => { assert.equal(config.webDir, 'dist-mobile'); assert.equal(config.server.url, undefined); });
test('H04 cleartext and mixed content are disabled', () => { assert.equal(config.android.allowMixedContent, false); assert.match(androidManifest, /usesCleartextTraffic="false"/); });
test('H05 Android requests only Internet permission', () => assert.deepEqual([...androidManifest.matchAll(/uses-permission android:name="([^"]+)/g)].map(m => m[1]), ['android.permission.INTERNET']));
test('H06 Android backup is disabled', () => assert.match(androidManifest, /allowBackup="false"/));
test('H07 Android package and version are correct', () => { assert.match(androidBuild, /applicationId "br\.com\.valdineycapistrano\.vcimob"/); assert.match(androidBuild, /versionCode 1/); assert.match(androidBuild, /versionName "1\.0"/); });
test('H08 iOS bundle identifier comes from signed build settings', () => assert.match(iosPlist, /<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/));
test('H09 iOS declares no privacy-gated usage descriptions', () => assert.doesNotMatch(iosPlist, /NS(?:Camera|Microphone|PhotoLibrary|Location|Contacts)UsageDescription/));
test('H10 standard HTTPS is marked as non-exempt encryption', () => assert.match(iosPlist, /ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/));
test('H11 custom deep-link scheme exists on Android and iOS', () => { assert.match(androidManifest, /android:scheme="vcimob" android:host="crm"/); assert.match(iosPlist, /<string>vcimob<\/string>/); });
test('H12 deep links have an explicit route allowlist', () => assert.match(nativeSource, /new Set\(\["dashboard", "leads", "kanban", "properties", "agenda", "team", "billing"\]\)/));
test('H13 native runtime is progressive enhancement only', () => { const h = nativeHarness(false); assert.equal(h.calls.document.click, undefined); assert.equal(h.context.window.VC_IMOB_NATIVE, false); });
test('H14 native external HTTPS uses the secure browser plugin', async () => { const h = nativeHarness(); h.calls.document.click({ defaultPrevented: false, preventDefault() {}, target: { closest: () => ({ getAttribute: () => 'https://example.com/help' }) } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.calls.browser[0].url, 'https://example.com/help'); });
test('H15 tel and mailto use the platform launcher', async () => { for (const url of ['tel:+5565999999999', 'mailto:suporte@example.com']) { const h = nativeHarness(); h.calls.document.click({ defaultPrevented: false, preventDefault() {}, target: { closest: () => ({ getAttribute: () => url }) } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.calls.launcher[0].url, url); } });
test('H15b WhatsApp window.open leaves the WebView through the browser plugin', async () => { const h = nativeHarness(); h.context.window.open('https://wa.me/5565999999999'); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.calls.browser[0].url, 'https://wa.me/5565999999999'); });
test('H16 service worker is disabled only in native runtime', () => assert.match(pwaSource, /!window\.VC_IMOB_NATIVE && "serviceWorker" in navigator/));
test('H17 web PWA still uses its restricted CRM service-worker scope', () => { assert.match(pwaSource, /scope: "\.\/"/); assert.match(swSource, /url\.pathname\.startsWith\("\/crm\/"\)/); });
test('H18 private and remote API responses remain outside SW cache', () => { assert.doesNotMatch(swSource.match(/const SAFE_SHELL = \[([\s\S]*?)\];/)[1], /supabase|rest|auth|index\.html/i); assert.match(swSource, /url\.origin !== self\.location\.origin/); });
test('H19 auth storage remains session-scoped', () => { const auth = readFileSync('crm/js/supabase.js', 'utf8'); assert.match(auth, /sessionStorage/); assert.doesNotMatch(auth, /localStorage|Preferences/); });
test('H20 no native file contains service role or credential-shaped secrets', () => { const files = ['capacitor.config.json', 'crm/js/native.js', 'android/app/src/main/AndroidManifest.xml', 'ios/App/App/Info.plist']; for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /service_role|BEGIN (?:RSA |EC )?PRIVATE KEY|password\s*[:=]/i, file); });
test('H21 official icon derivatives have required sizes', () => { assert.deepEqual(pngSize('ios/App/App/Assets.xcassets/AppIcon.appiconset/VCImobAppIcon.png'), [1024, 1024]); assert.deepEqual(pngSize('android/app/src/main/res/mipmap-xxxhdpi/vc_imob_launcher.png'), [192, 192]); });
test('H22 Android adaptive icon uses the official-derived foreground', () => assert.match(readFileSync('android/app/src/main/res/mipmap-anydpi-v26/vc_imob_launcher.xml', 'utf8'), /vc_imob_foreground/));
test('H23 mobile bundle is reproducibly generated', () => { execFileSync(process.execPath, ['scripts/build-mobile.mjs']); for (const file of ['dist-mobile/index.html', 'dist-mobile/crm/login.html', 'dist-mobile/crm/js/native.js', 'dist-mobile/data/imoveis.json']) assert.ok(existsSync(file), file); });
test('H24 bundle entry sends unauthenticated users through normal login', () => assert.match(readFileSync('dist-mobile/index.html', 'utf8'), /crm\/login\.html/));
test('H25 PWA manifest is preserved', () => { const manifest = json('crm/manifest.webmanifest'); assert.deepEqual([manifest.name, manifest.scope, manifest.start_url], ['VC Imob', '/crm/', '/crm/index.html?source=pwa']); });
test('H26 VCI000006 remains in bundled public property data', () => { const property = json('dist-mobile/data/imoveis.json').find(item => item.codigo === 'VCI000006'); assert.equal(property.imagens.length, 6); assert.equal(property.preco, 550000); });
test('H27 credential and build artifacts are ignored', () => { const ignore = readFileSync('.gitignore', 'utf8'); for (const pattern of ['*.jks', '*.keystore', '*.p12', '*.mobileprovision', 'dist-mobile/', 'node_modules/']) assert.ok(ignore.includes(pattern), pattern); });
test('H28 billing remains informational without a purchase redirect', () => { const billing = readFileSync('crm/js/billing.js', 'utf8'); assert.match(billing, /nenhuma cobrança é iniciada nesta tela/); assert.doesNotMatch(billing, /checkout|purchase|window\.open/); });
test('H29 no database migration was added for the mobile wrapper', () => assert.equal(config.webDir, 'dist-mobile'));
test('H30 publication documentation covers privacy, deletion, billing and both stores', () => { const docs = readFileSync('docs/phase-h.md', 'utf8'); for (const heading of ['Inventário técnico de privacidade', 'Exclusão de conta', 'Apple', 'Google Play', 'Billing']) assert.match(docs, new RegExp(heading, 'i')); });

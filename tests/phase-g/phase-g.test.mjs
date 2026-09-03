import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';

const manifest = JSON.parse(readFileSync('crm/manifest.webmanifest', 'utf8'));
const crm = readFileSync('crm/index.html', 'utf8');
const login = readFileSync('crm/login.html', 'utf8');
const css = readFileSync('crm/css/phase-g.css', 'utf8');
const pwa = readFileSync('crm/js/pwa.js', 'utf8');
const app = readFileSync('crm/js/app.js', 'utf8');
const sw = readFileSync('crm/service-worker.js', 'utf8');
const offline = readFileSync('crm/offline.html', 'utf8');
const headers = readFileSync('_headers', 'utf8');

function pngSize(path) {
  const buffer = readFileSync(path);
  assert.deepEqual([...buffer.subarray(1, 4)], [80, 78, 71]);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function serviceWorkerHarness() {
  const handlers = {};
  const puts = [];
  const store = new Map();
  const cache = {
    addAll: async urls => urls.forEach(url => store.set(new URL(url, 'https://example.test/crm/service-worker.js').href, { ok: true, type: 'basic', cached: true })),
    put: async (request, response) => { puts.push(String(request.url || request)); store.set(String(request.url || request), response); }
  };
  const context = {
    URL, Promise,
    self: {
      location: new URL('https://example.test/crm/service-worker.js'),
      clients: { claim: async () => undefined },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => undefined
    },
    caches: {
      open: async () => cache,
      keys: async () => ['vc-imob-old', 'unrelated-cache'],
      delete: async key => key === 'vc-imob-old',
      match: async request => store.get(String(request.url || request))
    },
    fetch: async request => ({ ok: true, type: 'basic', url: request.url, clone() { return this; } })
  };
  new Script(sw).runInNewContext(context);
  return { handlers, puts, store };
}

test('G01 manifest is valid JSON with VC Imob identity', () => assert.equal(manifest.name, 'VC Imob'));
test('G02 manifest starts inside authenticated CRM flow', () => assert.equal(manifest.start_url, '/crm/index.html?source=pwa'));
test('G03 manifest scope is restricted to CRM', () => assert.equal(manifest.scope, '/crm/'));
test('G04 manifest uses a stable application id', () => assert.equal(manifest.id, '/crm/'));
test('G05 manifest supports standalone display', () => assert.equal(manifest.display, 'standalone'));
test('G06 manifest provides CRM shortcuts', () => assert.deepEqual(manifest.shortcuts.map(item => item.short_name), ['Leads', 'Funil', 'Agenda']));
test('G07 192 icon is a real 192px PNG', () => assert.deepEqual(pngSize('crm/icons/icon-192.png'), [192, 192]));
test('G08 512 icon is a real 512px PNG', () => assert.deepEqual(pngSize('crm/icons/icon-512.png'), [512, 512]));
test('G09 maskable icon is a real 512px PNG', () => assert.deepEqual(pngSize('crm/icons/icon-maskable-512.png'), [512, 512]));
test('G10 Apple touch icon is a real 180px PNG', () => assert.deepEqual(pngSize('crm/icons/apple-touch-icon.png'), [180, 180]));
test('G11 manifest declares a dedicated maskable icon', () => assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable')));
test('G12 CRM declares manifest and Apple metadata', () => { assert.match(crm, /manifest\.webmanifest/); assert.match(crm, /apple-mobile-web-app-capable/); });
test('G13 login participates in the same PWA', () => { assert.match(login, /manifest\.webmanifest/); assert.match(login, /pwa\.js/); });
test('G14 viewport supports iPhone safe areas', () => { assert.match(crm, /viewport-fit=cover/); assert.match(login, /viewport-fit=cover/); });
test('G15 mobile navigation has five labeled targets', () => assert.equal((crm.match(/crm-bottom-nav[\s\S]*?<\/nav>/)?.[0].match(/<button/g) || []).length, 5));
test('G16 mobile navigation includes daily areas', () => ['dashboard', 'leads', 'kanban', 'agenda'].forEach(view => assert.match(crm, new RegExp(`data-view-link="${view}"`))));
test('G17 bottom navigation includes safe-area padding', () => assert.match(css, /mobile-nav-height[\s\S]*safe-area-inset-bottom/));
test('G18 touch controls reach the 44px target', () => assert.match(css, /min-height:\s*44px/));
test('G19 forms prevent iOS input zoom', () => assert.match(css, /font-size:\s*16px/));
test('G20 tables become labeled mobile cards', () => { assert.match(css, /content:\s*attr\(data-label\)/); assert.match(pwa, /enhanceTables/); });
test('G21 Kanban retains controlled horizontal mobile navigation', () => assert.match(css, /kanban-view \.kanban[\s\S]*overscroll-behavior-inline/));
test('G22 modals use dynamic viewport, safe area and managed focus', () => { assert.match(css, /max-height:\s*calc\(100dvh[\s\S]*safe-area-inset-bottom/); assert.match(pwa, /returnFocus/); assert.match(pwa, /event\.key !== "Tab"/); });
test('G23 reduced motion is respected', () => assert.match(css, /prefers-reduced-motion:\s*reduce/));
test('G24 navigation maintains view hash and current-page semantics', () => { assert.match(app, /aria-current/); assert.match(app, /window\.location\.hash/); });
test('G25 offline page explicitly refuses private offline data', () => assert.match(offline, /dados de clientes não são armazenados/i));
test('G26 service worker cache is versioned and cleans old VC Imob caches', () => { assert.match(sw, /CACHE_VERSION/); assert.match(sw, /caches\.delete/); });
test('G27 service worker caches only an explicit safe shell initially', () => { const shell = sw.match(/const SAFE_SHELL = \[([\s\S]*?)\];/)?.[1] || ''; assert.doesNotMatch(shell, /index\.html|data\/|supabase|rest\/v1|auth\/v1/); });
test('G28 service worker bypasses remote and private API requests', () => { const h = serviceWorkerHarness(); let response; h.handlers.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://project.supabase.co/rest/v1/leads' }, respondWith(value) { response = value; } }); assert.equal(response, undefined); });
test('G29 service worker handles safe same-origin static assets', async () => { const h = serviceWorkerHarness(); let response; h.handlers.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.test/crm/js/app.js' }, respondWith(value) { response = value; } }); assert.ok(response); await response; });
test('G30 navigation falls back only to the offline shell', () => { assert.match(sw, /request\.mode === "navigate"[\s\S]*caches\.match\(OFFLINE_URL\)/); assert.doesNotMatch(sw, /cache\.put\(request[\s\S]*mode === "navigate"/); });
test('G31 install UX supports Chromium, iOS and standalone detection', () => { assert.match(pwa, /beforeinstallprompt/); assert.match(pwa, /iphone\|ipad\|ipod/i); assert.match(pwa, /display-mode: standalone/); });
test('G32 offline submissions fail safely with user feedback', () => { assert.match(pwa, /document\.addEventListener\("submit"/); assert.match(pwa, /Reconecte-se para salvar alterações/); });
test('G33 service worker is served with no-cache headers', () => { assert.match(headers, /\/crm\/service-worker\.js[\s\S]*Cache-Control: no-cache/); assert.match(headers, /Service-Worker-Allowed: \/crm\//); });
test('G34 no PWA file contains credential-shaped secrets or service role keys', () => [crm, login, css, pwa, sw, offline, JSON.stringify(manifest)].forEach(value => assert.doesNotMatch(value, /service_role|eyJ[A-Za-z0-9_-]{20,}|sk_live_|RESEND_API_KEY/)));
test('G35 public site files remain outside the service-worker scope', () => assert.equal(manifest.scope.startsWith('/crm/'), true));
test('G36 required PWA files exist', () => ['crm/service-worker.js', 'crm/offline.html', 'crm/css/phase-g.css', 'crm/js/pwa.js'].forEach(path => assert.equal(existsSync(path), true)));

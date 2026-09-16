import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(path, "utf8");
const utils = read("crm/js/utils.js");
const data = read("crm/js/data.js");
const premiumData = read("crm/js/premium-data.js");
const properties = read("crm/js/properties.js");
const signup = read("crm/js/signup.js");
const signupHtml = read("crm/signup.html");
const supabase = read("crm/js/supabase.js");
const pwa = read("crm/js/pwa.js");
const serviceWorker = read("crm/service-worker.js");
const css = read("crm/css/premium.css");
const intelligence = read("crm/js/premium-intelligence.js");
const dashboard = read("crm/js/dashboard.js");
const insights = read("crm/js/lead-insights.js");
const crm = read("crm/index.html");

const context = vm.createContext({
  Intl, Date, Number, String, Math, Array, Object, Map, Set, Blob, URL,
  setTimeout, clearTimeout,
  requestAnimationFrame: callback => callback(),
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { createElement: () => ({}) },
  window: { location: new URL("https://valdineycapistranoimoveis.com.br/crm/") }
});
vm.runInContext(utils, context);
vm.runInContext(properties, context);

test("UI01 Brazilian phone normalization accepts local and +55 formats", () => {
  assert.equal(context.normalizePhone("+55 (65) 99999-9999"), "65999999999");
  assert.equal(context.normalizePhone("(65) 3333-4444"), "6533334444");
});

test("UI02 phone presentation uses DDD, parentheses and hyphen", () => {
  assert.equal(context.formatPhone("65999999999"), "(65) 99999-9999");
  assert.equal(context.formatPhone("6533334444"), "(65) 3333-4444");
});

test("UI03 BRL parser accepts raw, grouped and pasted currency", () => {
  assert.equal(context.parseBrlNumber("550000"), 550000);
  assert.equal(context.parseBrlNumber("550.000"), 550000);
  assert.equal(context.parseBrlNumber("R$ 550.000,00"), 550000);
});

test("UI04 BRL formatter always presents a real currency input value", () => {
  assert.equal(context.formatBrlInput("550000"), "R$\u00a0550.000,00");
  assert.equal(context.formatBrlInput(""), "");
});

test("UI05 display name prefers profile and metadata before email", () => {
  assert.equal(context.getDisplayName({ full_name: "Valdiney Capistrano", email: "fallback@example.invalid" }, {}), "Valdiney Capistrano");
  assert.equal(context.getDisplayName({ full_name: "" }, { user: { email: "fallback@example.invalid", user_metadata: { full_name: "Nome Seguro" } } }), "Nome Seguro");
});

test("UI06 signup requires and persists full name and binds phone mask", () => {
  assert.match(signupHtml, /name="fullName"[^>]*required/);
  assert.match(signup, /if \(!payload\.fullName\)/);
  assert.match(signup, /bindPhoneInput\(phoneInput\)/);
  assert.match(supabase, /full_name: payload\.fullName/);
});

test("UI07 lead create and update use the tenant-safe RPC", () => {
  assert.match(data, /callCrmRpc\("save_crm_lead"/);
  assert.doesNotMatch(data, /supabaseRequest\("\/rest\/v1\/leads"[\s\S]{0,120}method: "POST"/);
});

test("UI08 property and media save is one backend transaction", () => {
  assert.match(premiumData, /save_crm_property_with_media/);
  assert.match(premiumData, /target_media:/);
  assert.match(properties, /saveManagedProperty\(payload, property\?\._row, media\)/);
});

test("UI09 property thumbnail resolves static paths outside /crm", () => {
  assert.equal(context.propertyMediaUrl("./assets/images/imoveis/foto.jpg"), "https://valdineycapistranoimoveis.com.br/assets/images/imoveis/foto.jpg");
  assert.equal(context.propertyMediaUrl("https://cdn.example.test/foto.jpg"), "https://cdn.example.test/foto.jpg");
});

test("UI10 thumbnail failure has an accessible fallback", () => {
  assert.match(properties, /Miniatura indisponível/);
  assert.match(properties, /role: "status"/);
});

test("UI11 publishing requires a public-compatible status", () => {
  assert.match(properties, /Para publicar, escolha o status Disponível ou Reservado/);
});

test("UI12 double submit is blocked in primary mutations", () => {
  assert.match(properties, /if \(save\.disabled\) return/);
  assert.match(read("crm/js/leads.js"), /if \(save\.disabled\) return/);
  assert.match(read("crm/js/premium.js"), /if\(save\.disabled\)return/);
});

test("UI13 technical database errors are translated and logs are sanitized", () => {
  assert.match(supabase, /friendlySupabaseError/);
  assert.match(supabase, /Você não possui permissão/);
  assert.match(supabase, /operation:.*status:.*code:.*timestamp:/s);
  assert.doesNotMatch(supabase, /console\.error\([^\n]*(?:access_token|refresh_token|Authorization)/);
});

test("UI14 optimistic conflicts have a specific retry message", () => {
  assert.match(supabase, /40001/);
  assert.match(supabase, /atualizado em outra sessão/);
});

test("UI15 iPhone modal tracks the visual viewport and safe areas", () => {
  assert.match(pwa, /window\.visualViewport/);
  assert.match(css, /--visual-viewport-height/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /\.modal-card>h2\{position:sticky/);
});

test("UI16 intentional Kanban horizontal scrolling remains preserved", () => {
  assert.match(css, /\.kanban-view,\.kanban\{contain:none/);
  assert.match(read("crm/css/crm.css") + read("crm/css/kanban.css"), /\.kanban\{[^}]*overflow:auto/);
});

test("UI17 Meu Dia and next best action use calculated data", () => {
  assert.match(dashboard, /buildMyDay/);
  assert.match(insights, /leadNextBestAction/);
  assert.match(intelligence, /buildOperationalOpportunities/);
  assert.doesNotMatch(intelligence, /Math\.random/);
});

test("UI18 analytics handles missing baselines and demand uses real records", () => {
  assert.match(intelligence, /Amostra insuficiente|Sem base anterior/);
  assert.match(intelligence, /buildDemandRadar/);
  assert.doesNotMatch(intelligence, /fake|mock/i);
});

test("UI19 exports prevent spreadsheet formula injection", () => {
  assert.match(intelligence, /\^\[=\+\\-@\]/);
  assert.match(intelligence, /text = `'/);
});

test("UI20 PWA caches only same-origin public shell assets", () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/crm\/"\)/);
  assert.doesNotMatch(serviceWorker, /rest\/v1|auth\/v1|rpc\//);
  assert.match(serviceWorker, /vc-imob-shell-[a-z0-9-]+/);
});

test("UI21 new assets have explicit cache-busting in the CRM shell", () => {
  assert.match(crm, /premium-intelligence\.js\?v=master-beta-20260913/);
  assert.match(crm, /premium\.css\?v=master-beta-20260914/);
  assert.match(crm, /pwa\.js\?v=ux-audit-20260916/);
  assert.match(crm, /responsive-system\.css\?v=ux-audit-20260916/);
});

test("UI22 no generative provider, fake push or store billing was introduced", () => {
  const changed = [intelligence, dashboard, insights, properties, premiumData].join("\n");
  assert.doesNotMatch(changed, /OPENAI_API_KEY|ANTHROPIC_API_KEY|VAPID_PRIVATE|StoreKit|BillingClient/);
});

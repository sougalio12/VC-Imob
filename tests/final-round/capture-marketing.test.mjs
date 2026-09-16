import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const migration = readFileSync("supabase/migrations/20260915050000_capture_marketing_secure.sql", "utf8");
const ui = readFileSync("crm/js/capture-marketing.js", "utf8");
const html = readFileSync("crm/index.html", "utf8");
const sw = readFileSync("crm/service-worker.js", "utf8");
const publicLead = readFileSync("js/site-lead.js", "utf8");
const edge = readFileSync("supabase/functions/site-lead/index.ts", "utf8");
const qrSource = readFileSync("crm/js/vendor/qrcode-generator.js", "utf8");

test("CAP01 pipeline, owner 360 and marketing views are wired", () => {
  assert.match(html, /data-view-link="acquisitions"/);
  assert.match(html, /data-view-link="marketing"/);
  assert.match(html, /capture-marketing\.js/);
  assert.match(ui, /async function renderAcquisitions/);
  assert.match(ui, /async function openAcquisition360/);
  assert.match(ui, /async function renderMarketing/);
  assert.match(ui, /if\(isDemoMode\(\)\).*Entre em uma organização/);
});

test("CAP02 all acquisition stages, loss reasons and explicit conversion are present", () => {
  for (const stage of ["new_contact","qualification","technical_visit","documentation","negotiation","authorization","acquired","lost"]) assert.match(ui, new RegExp(stage));
  for (const reason of ["price","financing","sold","location","withdrawal","competitor","no_response","timing","other"]) assert.match(ui, new RegExp(reason));
  assert.match(ui, /Criar imóvel em rascunho/);
  assert.match(migration, /'status','draft','is_published',false/);
});

test("CAP03 write access is RPC-only and tenant references are validated", () => {
  assert.match(migration, /revoke insert,update,delete on public\.property_owners,public\.property_acquisitions,public\.marketing_campaigns from authenticated/);
  assert.match(migration, /current_membership_role\(target_organization\)/);
  assert.match(migration, /CAPTURE_REFERENCE_DENIED/);
  assert.match(migration, /MARKETING_REFERENCE_DENIED/);
  assert.match(migration, /force row level security/);
  assert.doesNotMatch(ui, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("CAP04 UTM capture is normalized, bounded and cannot grant private access", () => {
  assert.match(publicLead, /\^\[a-z0-9\._~-\]\+\$/);
  assert.match(edge, /capture_site_lead_attributed/);
  assert.match(edge, /parsed\.hostname === "valdineycapistranoimoveis\.com\.br"/);
  assert.match(migration, /grant execute on function public\.capture_site_lead_attributed[\s\S]+to service_role/);
  assert.match(migration, /revoke all on function public\.capture_site_lead_attributed[\s\S]+from public,anon,authenticated/);
});

test("CAP05 ROI preserves unknown cost and aggregates without join multiplication", () => {
  assert.match(ui, /Custo não informado/);
  assert.match(ui, /ROI não calculável/);
  assert.match(migration, /with lead_stats as/);
  assert.match(migration, /visit_stats as/);
  assert.match(migration, /proposal_stats as/);
  assert.doesNotMatch(migration, /sum\(distinct/);
  assert.match(migration, /case when c\.cost>0 and ps\.revenue is not null/);
});

test("CAP06 QR is generated locally only for a published property", () => {
  const context = vm.createContext({ console, Math, Date, Array, String, Number, Object });
  vm.runInContext(qrSource, context);
  const qr = context.qrcode(0, "M");
  qr.addData("https://valdineycapistranoimoveis.com.br/imovel.html?codigo=VCI000006");
  qr.make();
  assert.match(qr.createDataURL(2, 4), /^data:image\/gif;base64,/);
  assert.match(ui, /property\?\.publicado/);
  assert.match(ui, /utm_source","qr"/);
  assert.match(ui, /navigator\.share/);
  assert.match(ui, /download:`\$\{property\.codigo\}-qr\.gif`/);
});

test("CAP07 PWA caches only the new static scripts, never CRM data", () => {
  assert.match(sw, /capture-marketing\.js/);
  assert.match(sw, /qrcode-generator\.js/);
  assert.match(sw, /\(request\.method !== "GET"/);
  assert.doesNotMatch(sw, /rest\/v1|functions\/v1/);
});

test("CAP08 existing property images and catalogue were not incorporated into Block 3", () => {
  assert.doesNotMatch(migration, /VCI00000[2-6]/);
  assert.doesNotMatch(ui, /assets\/images\/imoveis/);
});

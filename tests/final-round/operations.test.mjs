import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("crm/js/operations-suite.js", "utf8");
const sql = readFileSync("supabase/migrations/20260915000000_final_beta_operations.sql", "utf8");
const context = vm.createContext({ console, Date, Math, Number, String, Array, Object, Set, Map, TextEncoder, crypto: globalThis.crypto });
vm.runInContext(source, context);

test("OPS01 CSV parser handles quoted delimiters and normalized headers", () => {
  const parsed = context.parseDelimitedCsv('Nome;Telefone;Observações\n"João Silva";65999999999;"Busca casa; centro"');
  assert.deepEqual([...parsed.headers], ["nome", "telefone", "observacoes"]);
  assert.equal(parsed.rows[0].values.observacoes, "Busca casa; centro");
});

test("OPS02 lead import reports invalid and duplicate rows without silently importing", () => {
  const parsed = context.parseDelimitedCsv("name,phone,email\nMaria,65999999999,maria@example.test\nOutra,65888888888,maria@example.test\nX,,invalido");
  const rows = context.validateLeadImport(parsed);
  assert.equal(rows[0].valid, true);
  assert.match(rows[1].errors.join(" "), /Duplicado/);
  assert.match(rows[2].errors.join(" "), /Nome obrigatório|E-mail inválido/);
});

test("OPS03 ROI remains unknown when cost was not informed", () => {
  const absent = context.calculateCampaignRoi({ cost: null, leads: 5, sales: 1, revenue: 500000 });
  assert.equal(absent.roi, null);
  const actual = context.calculateCampaignRoi({ cost: 1000, leads: 10, sales: 2, revenue: 5000 });
  assert.equal(actual.cpl, 100);
  assert.equal(actual.cac, 500);
  assert.equal(actual.roi, 400);
});

test("OPS04 financing simulator requires an explicit rate and labels result as estimate", () => {
  assert.throws(() => context.simulateFinancing({ price: 500000, downPayment: 100000, months: 360 }), /taxa válidos/);
  const result = context.simulateFinancing({ price: 500000, downPayment: 100000, annualRate: 10, months: 360 });
  assert.ok(result.payment > 0);
  assert.match(result.disclaimer, /não é proposta bancária/);
});

test("OPS05 property comparison calculates price per square metre only with real values", () => {
  const rows = context.compareProperties([{ codigo:"VCI000006", titulo:"Apartamento", preco:550000, areaTotal:53.97, quartos:2 }]);
  assert.equal(rows[0].code, "VCI000006");
  assert.ok(rows[0].pricePerSquareMeter > 10000);
  assert.equal(context.compareProperties([{ codigo:"X" }])[0].pricePerSquareMeter, null);
});

test("OPS06 new operational tables are tenant scoped with RLS forced", () => {
  for (const table of ["property_owners","property_acquisitions","marketing_campaigns","sales_goals","lead_distribution_settings","user_dashboard_preferences","integration_webhooks","webhook_delivery_log"]) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security; alter table public\\.${table} force row level security;`));
  }
});

test("OPS07 owner and acquisition data cannot be read by unrelated agents", () => {
  assert.match(sql, /acquisitions_select[\s\S]+current_membership_role\(organization_id\) in \('owner','manager'\) or assigned_to=auth\.uid\(\)/);
  assert.match(sql, /owners_manage[\s\S]+current_membership_role\(organization_id\) in \('owner','manager'\)/);
});

test("OPS08 automatic distribution is disabled by default and configured explicitly", () => {
  assert.match(sql, /mode text not null default 'manual'/);
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /configure_lead_distribution/);
  assert.match(sql, /distribution_configured/);
});

test("OPS09 webhook endpoints require HTTPS and secrets are hash-only", () => {
  assert.match(sql, /endpoint_url ~ '\^https:\/\/'/);
  assert.match(sql, /secret_hash text not null/);
  assert.doesNotMatch(sql, /secret_value|plaintext_secret|service_role/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
});

test("OPS10 sensitive settings RPCs derive authorization from membership", () => {
  assert.match(sql, /configure_lead_distribution[\s\S]+current_membership_role\(target_organization\) not in \('owner','manager'\)/);
  assert.match(sql, /update_organization_branding[\s\S]+current_membership_role\(target_organization\)<>'owner'/);
  assert.match(sql, /save_dashboard_preferences[\s\S]+auth\.uid\(\)/);
});

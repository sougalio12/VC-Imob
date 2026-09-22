import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const read = path => readFileSync(path, "utf8");
const css = read("crm/css/responsive-system.css");
const html = read("crm/index.html");
const pwa = read("crm/js/pwa.js");
const campaignUi = read("crm/js/capture-marketing.js");
const app = read("crm/js/app.js");
const sw = read("crm/service-worker.js");
const migration = read("supabase/migrations/20260916000000_global_mobile_crud_audit.sql");

test("UXAUDIT01 global responsive invariants contain pages, forms, grids and intentional scrollers", () => {
  assert.match(css, /body\.crm-app[\s\S]*overflow-x:\s*clip/);
  assert.match(css, /\.crm-content[\s\S]*min-width:\s*0/);
  assert.match(css, /\.crm-app input:not/);
  assert.match(css, /width:\s*100%[\s\S]*max-width:\s*100%/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.lead-table-wrap,[\s\S]*\.kanban,[\s\S]*\.capture-board/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.ok(html.indexOf("responsive-system.css") > html.indexOf("assistant.css"));
  assert.match(sw, /vc-imob-shell-premium-20260922/);
  assert.match(sw, /\.\/css\/responsive-system\.css/);
});

test("UXAUDIT02 every shared CRM modal receives an accessible persistent close action", () => {
  assert.match(pwa, /function bindModalAccessibility/);
  assert.match(pwa, /enhanceModalChrome/);
  assert.match(pwa, /modal-close-button/);
  assert.match(pwa, /setAttribute\("aria-label", "Fechar janela"\)/);
  assert.match(pwa, /close\.addEventListener\("click"/);
  assert.match(pwa, /closeModal\(\)/);
  assert.match(pwa, /new MutationObserver/);
  assert.match(html, /id="sidebarCloseButton"[\s\S]*aria-label="Fechar menu"/);
  assert.match(pwa, /pwa-guide-close/);
  assert.match(pwa, /Fechar instruções de instalação/);
  assert.match(css, /\.modal-system-header[\s\S]*position:\s*sticky/);
  assert.match(css, /\.modal-close-button[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
});

test("UXAUDIT03 campaign removal is confirmed, guarded against double submit and preserves history", () => {
  assert.match(campaignUi, /openCampaignArchiveConfirmation/);
  assert.match(campaignUi, /Excluir campanha\?/);
  assert.match(app, /openDestructiveConfirmation/);
  assert.match(app, /text: "Cancelar"/);
  assert.match(app, /if \(confirm\.disabled\) return/);
  assert.match(app, /confirm\.disabled = true/);
  assert.match(app, /successMessage/);
  assert.match(campaignUi, /archive_marketing_campaign/);
  assert.match(campaignUi, /archived_at=is\.null/);
  assert.match(migration, /add column if not exists archived_at/);
  assert.match(migration, /campaign_archived/);
  assert.match(migration, /preserved_attributions/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.marketing_campaigns/i);
});

const pkg = process.env.PGLITE_PACKAGE;
test("UXAUDIT04 campaign archive RPC is tenant-safe and keeps related lead history", { skip: !pkg }, async () => {
  const { PGlite } = await import(pathToFileURL(resolve(pkg, "dist/index.js")));
  const { pgcrypto } = await import(pathToFileURL(resolve(pkg, "dist/contrib/pgcrypto.js")));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; create extension pgcrypto with schema extensions;`);
  for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql") && name <= "20260916000000_global_mobile_crud_audit.sql").sort()) await db.exec(read(`supabase/migrations/${file}`));
  const ids = {
    owner: "56000000-0000-0000-0000-000000000001",
    manager: "56000000-0000-0000-0000-000000000002",
    agent: "56000000-0000-0000-0000-000000000003",
    outsider: "56000000-0000-0000-0000-000000000004"
  };
  for (const [name,id] of Object.entries(ids)) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')", [id, `${name}@ux-audit.invalid`]);
  const org = (await db.query("select organization_id from profiles where id=$1", [ids.owner])).rows[0].organization_id;
  await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'manager','active'),($1,$3,'agent','active')", [org,ids.manager,ids.agent]);
  async function as(who, sql, args=[]) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[who]]);
    await db.exec("set role authenticated");
    try { return await db.query(sql,args); } finally { await db.exec("reset role"); }
  }
  const campaign = (await as("owner", "select (save_marketing_campaign($1,null,$2::jsonb)).*", [org, JSON.stringify({ name:"Campanha auditável", source:"site", status:"active" })])).rows[0];
  const lead = (await db.query("insert into leads(organization_id,name,phone,stage,assigned_to,marketing_campaign_id) values($1,'Lead preservado','6599999907','novo',$2,$3) returning id", [org,ids.agent,campaign.id])).rows[0];

  await assert.rejects(as("agent", "select archive_marketing_campaign($1,$2)", [org,campaign.id]), error => error.code === "42501");
  await assert.rejects(as("outsider", "select archive_marketing_campaign($1,$2)", [org,campaign.id]), error => error.code === "42501");
  const archived = (await as("manager", "select (archive_marketing_campaign($1,$2)).*", [org,campaign.id])).rows[0];
  assert.ok(archived.archived_at);
  assert.equal(archived.archived_by, ids.manager);
  assert.equal(archived.status, "finished");
  assert.equal((await as("owner", "select marketing_campaign_id from leads where id=$1", [lead.id])).rows[0].marketing_campaign_id, campaign.id);
  assert.equal((await as("owner", "select count(*)::int n from get_marketing_roi($1) where campaign_id=$2", [org,campaign.id])).rows[0].n, 0);
  assert.equal((await as("owner", "select count(*)::int n from list_team_audit($1,100) where entity_id=$2 and action='campaign_archived'", [org,campaign.id])).rows[0].n, 1);
  await as("owner", "select archive_marketing_campaign($1,$2)", [org,campaign.id]);
  assert.equal((await as("owner", "select count(*)::int n from list_team_audit($1,100) where entity_id=$2 and action='campaign_archived'", [org,campaign.id])).rows[0].n, 1);
  const newLead = (await db.query("insert into leads(organization_id,name,phone,stage,assigned_to) values($1,'Nova atribuição bloqueada','6599999908','novo',$2) returning id", [org,ids.agent])).rows[0];
  await assert.rejects(
    as("owner", "select attribute_lead_marketing($1,$2::jsonb)", [newLead.id, JSON.stringify({ source:"site", marketing_campaign_id:campaign.id })]),
    error => error.code === "23514"
  );
  await db.close();
});

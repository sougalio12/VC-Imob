import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sql=readFileSync("supabase/migrations/20260915060000_team_operations_secure.sql","utf8");
const ui=readFileSync("crm/js/team-operations.js","utf8");
const operations=readFileSync("crm/js/operations-suite.js","utf8");
const html=readFileSync("crm/index.html","utf8");
const sw=readFileSync("crm/service-worker.js","utf8");

test("B4-01 new state is tenant-scoped and force-RLS",()=>{
  for(const table of ["user_onboarding_progress","lead_undo_actions"]){
    assert.match(sql,new RegExp(`create table public\\.${table} \\(`));
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security;[\\s\\S]*alter table public\\.${table} force row level security;`));
  }
  assert.match(sql,/revoke all on public\.user_onboarding_progress,public\.lead_undo_actions from public,anon,authenticated/);
});

test("B4-02 team metrics, goals and financial access are server calculated",()=>{
  assert.match(sql,/get_team_operations/);
  assert.match(sql,/current_membership_role\(target_organization\) not in \('owner','manager'\)/);
  assert.match(sql,/commission_received/);
  assert.match(sql,/get_goal_progress/);
  assert.match(sql,/follow_ups/);
  assert.match(ui,/Operação por corretor/);
  assert.match(ui,/Metas do período/);
});

test("B4-03 distribution defaults manual, locks concurrency and validates eligible members",()=>{
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/m\.status='active' and m\.role in \('manager','agent'\)/);
  assert.match(sql,/settings is null or not settings\.enabled or settings\.mode='manual'/);
  assert.match(ui,/A automação só funciona após ativação explícita/);
});

test("B4-04 onboarding is resumable, skippable and persisted",()=>{
  assert.match(sql,/save_onboarding_progress/);
  assert.match(sql,/skipped_at/);
  assert.match(sql,/completed_at/);
  assert.match(ui,/Pular por enquanto/);
  assert.match(ui,/Abrir primeiros passos/);
});

test("B4-05 CSV import validates, reports duplicates and never overwrites",()=>{
  assert.match(sql,/jsonb_array_length\(target_rows\)>250/);
  assert.match(sql,/LEAD_IMPORT_SIZE_INVALID/);
  assert.match(sql,/code','DUPLICATE'/);
  assert.doesNotMatch(sql,/on conflict[\s\S]{0,80}leads/i);
  assert.match(ui,/Registros existentes não são sobrescritos/);
});

test("B4-06 duplicate review is non-destructive and undo is bounded",()=>{
  assert.match(sql,/review_duplicate_leads/);
  assert.match(sql,/expires_at timestamptz not null default \(now\(\)\+interval '10 minutes'\)/);
  assert.match(sql,/actor_id=auth\.uid\(\)/);
  assert.match(ui,/Nenhum registro é excluído ou mesclado automaticamente/);
});

test("B4-07 organization branding rejects arbitrary CSS and webhook starts disabled",()=>{
  assert.match(ui,/Não é permitido inserir CSS ou HTML/);
  assert.match(sql,/values\(target_organization,trim\(target_name\),target_url,target_events,encode[\s\S]+,false,auth\.uid\(\)\)/);
  assert.match(sql,/target_url !~ '\^https:\/\//);
  assert.match(ui,/segredo exibido uma única vez/i);
});

test("B4-08 comparison and simulator use real values and explicit rate",()=>{
  const context=vm.createContext({console,Date,Math,Number,String,Array,Object,Set,Map,TextEncoder,crypto:globalThis.crypto});
  vm.runInContext(operations,context);
  const compared=context.compareProperties([{codigo:"VCI000006",titulo:"Teste",preco:550000,areaTotal:53.97}]);
  assert.ok(compared[0].pricePerSquareMeter>0);
  assert.throws(()=>context.simulateFinancing({price:550000,downPayment:50000,months:360}),/taxa válidos/);
  assert.match(ui,/Estimativa|estimada/);
});

test("B4-09 safe offline shell contains code only, never CRM responses",()=>{
  assert.match(sw,/vc-imob-shell-mobile-fields-20260916b/);
  assert.match(sw,/team-operations\.js/);
  assert.match(sw,/if \(!isSafeStaticRequest\(request, url\)\) return/);
  assert.doesNotMatch(sw,/\/rest\/v1|\/auth\/v1/);
});

test("B4-10 script loads after its dependencies and before app bootstrap",()=>{
  assert.ok(html.indexOf("premium.js")<html.indexOf("team-operations.js"));
  assert.ok(html.indexOf("team-operations.js")<html.indexOf("app.js"));
});

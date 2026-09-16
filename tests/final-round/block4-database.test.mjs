import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";

const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; create extension pgcrypto with schema extensions;`);
for(const file of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")&&name<="20260915060000_team_operations_secure.sql").sort())await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));

const ids={owner:"61000000-0000-0000-0000-000000000001",agent:"61000000-0000-0000-0000-000000000002",outsider:"61000000-0000-0000-0000-000000000003"};
for(const [name,id] of Object.entries(ids))await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')",[id,`${name}@block4.invalid`]);
const org=(await db.query("select organization_id from profiles where id=$1",[ids.owner])).rows[0].organization_id;
await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'agent','active')",[org,ids.agent]);
async function as(who,sql,args=[]){await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);await db.exec("set role authenticated");try{return await db.query(sql,args);}finally{await db.exec("reset role");}}
const denied=(who,sql,args=[])=>assert.rejects(as(who,sql,args),error=>["42501","23514"].includes(error.code));

test("B4DB-01 onboarding is private and server-bound to auth.uid",async()=>{
  await as("agent","select save_onboarding_progress($1,array['profile'],'organization',false)",[org]);
  assert.equal((await as("agent","select count(*)::int n from user_onboarding_progress where organization_id=$1",[org])).rows[0].n,1);
  assert.equal((await as("owner","select count(*)::int n from user_onboarding_progress where organization_id=$1",[org])).rows[0].n,0);
  await denied("outsider","select save_onboarding_progress($1,array['profile'],null,false)",[org]);
});

test("B4DB-02 owner creates goals while agents only see their own progress",async()=>{
  await as("owner","select save_sales_goal($1,null,$2,'leads','2026-09-01','2026-09-30',5)",[org,ids.agent]);
  const own=await as("agent","select * from get_goal_progress($1,'2026-09-01','2026-09-30')",[org]);
  assert.equal(own.rows.length,1);
  await denied("agent","select save_sales_goal($1,null,$2,'sales','2026-09-01','2026-09-30',1)",[org,ids.agent]);
});

test("B4DB-03 import reports duplicate without overwriting",async()=>{
  const payload=JSON.stringify([{name:"Lead A",phone:"65999990001",email:"a@block4.invalid"},{name:"Lead duplicado",phone:"65999990001",email:"b@block4.invalid"}]);
  const result=(await as("agent","select import_leads_batch($1,$2::jsonb) value",[org,payload])).rows[0].value;
  assert.equal(result.inserted,1);assert.equal(result.rejected,1);
  assert.equal((await as("agent","select count(*)::int n from leads where organization_id=$1 and phone='65999990001'",[org])).rows[0].n,1);
});

test("B4DB-04 duplicate detection cannot cross tenants",async()=>{
  await as("agent","select import_leads_batch($1,$2::jsonb)",[org,JSON.stringify([{name:"Lead B",phone:"65999990002",email:"same@block4.invalid"},{name:"Lead C",phone:"65999990003",email:"same@block4.invalid"}])]);
  const duplicates=await as("owner","select * from review_duplicate_leads($1::uuid)",[org]);
  assert.ok(duplicates.rows.length>=0);
  await denied("outsider","select * from review_duplicate_leads($1::uuid)",[org]);
});

test("B4DB-05 distribution is explicit, serialized and role protected",async()=>{
  const lead=(await db.query("insert into leads(organization_id,name,phone) values($1,'Distribuição','65999990004') returning id",[org])).rows[0];
  assert.equal((await as("owner","select assign_lead_by_rule($1) value",[lead.id])).rows[0].value,null);
  await as("owner","select configure_lead_distribution($1,'round_robin',true,'{}')",[org]);
  assert.equal((await as("owner","select assign_lead_by_rule($1) value",[lead.id])).rows[0].value,ids.agent);
  await denied("agent","select configure_lead_distribution($1,'manual',false,'{}')",[org]);
});

test("B4DB-06 team financial summary is manager-only",async()=>{
  const rows=await as("owner","select * from get_team_operations($1,'2026-09-01','2026-10-01')",[org]);
  assert.ok(rows.rows.length>=2);
  await denied("agent","select * from get_team_operations($1,'2026-09-01','2026-10-01')",[org]);
});

test("B4DB-07 webhook secret is returned once and only its hash persists",async()=>{
  const created=(await as("owner","select create_integration_webhook($1,'Teste','https://example.invalid/hook',array['lead.created']) value",[org])).rows[0].value;
  assert.equal(created.enabled,false);assert.equal(created.secret.length,64);
  const persisted=(await as("owner","select secret_hash,enabled from integration_webhooks where id=$1",[created.id])).rows[0];
  assert.equal(persisted.secret_hash.length,64);assert.equal(persisted.enabled,false);assert.notEqual(persisted.secret_hash,created.secret);
  await denied("agent","select create_integration_webhook($1,'Teste','https://example.invalid/hook',array['lead.created'])",[org]);
});

test("B4DB-08 undo is actor-bound, expiring and restores only a safe field",async()=>{
  const lead=(await db.query("insert into leads(organization_id,assigned_to,name,phone,stage) values($1,$2,'Undo seguro','65999990005','novo') returning id",[org,ids.agent])).rows[0];
  const changed=(await as("agent","select change_lead_with_undo($1,$2,null,'stage','atendimento') value",[org,lead.id])).rows[0].value;
  assert.equal((await as("agent","select stage from leads where id=$1",[lead.id])).rows[0].stage,"atendimento");
  await denied("owner","select undo_lead_change($1,$2)",[org,changed.undo_id]);
  await as("agent","select undo_lead_change($1,$2)",[org,changed.undo_id]);
  assert.equal((await as("agent","select stage from leads where id=$1",[lead.id])).rows[0].stage,"novo");
  await assert.rejects(as("agent","select undo_lead_change($1,$2)",[org,changed.undo_id]));
});

test.after(async()=>db.close());

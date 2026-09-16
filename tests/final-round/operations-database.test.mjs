import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const pkg = process.env.PGLITE_PACKAGE;
if (!pkg) throw new Error("PGLITE_PACKAGE required");
const { PGlite } = await import(pathToFileURL(resolve(pkg, "dist/index.js")));
const { pgcrypto } = await import(pathToFileURL(resolve(pkg, "dist/contrib/pgcrypto.js")));
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; create extension pgcrypto with schema extensions;`);
for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql") && name <= "20260915000000_final_beta_operations.sql").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

const ids = { owner:"51000000-0000-0000-0000-000000000001", agent:"51000000-0000-0000-0000-000000000002", outsider:"51000000-0000-0000-0000-000000000003" };
for (const [name,id] of Object.entries(ids)) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')",[id,`${name}@ops.invalid`]);
const org = (await db.query("select organization_id from profiles where id=$1",[ids.owner])).rows[0].organization_id;
await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'agent','active')",[org,ids.agent]);
async function as(who,sql,args=[]){ await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]); await db.exec("set role authenticated"); try{return await db.query(sql,args);}finally{await db.exec("reset role");} }
const denied=(who,sql,args=[])=>assert.rejects(as(who,sql,args),error=>error.code==="42501"||error.code==="23514");

test("OPSDB01 owner records owner and acquisition while outsider cannot read them",async()=>{
 const owner=(await as("owner","insert into property_owners(organization_id,full_name,phone,created_by) values($1,'Proprietário teste','65999999999',$2) returning id",[org,ids.owner])).rows[0];
 await as("owner","insert into property_acquisitions(organization_id,owner_id,assigned_to,title,created_by) values($1,$2,$3,'Captação teste',$4)",[org,owner.id,ids.agent,ids.owner]);
 assert.equal((await as("agent","select count(*)::int n from property_acquisitions where organization_id=$1",[org])).rows[0].n,1);
 assert.equal((await as("outsider","select * from property_acquisitions where organization_id=$1",[org])).rows.length,0);
 assert.equal((await as("agent","update property_acquisitions set stage='acquired' where organization_id=$1 returning id",[org])).rows.length,0);
});

test("OPSDB02 automatic assignment requires explicit manager configuration",async()=>{
 const lead=(await db.query("insert into leads(organization_id,name,phone) values($1,'Lead distribuição','65999999998') returning id",[org])).rows[0];
 assert.equal((await as("owner","select assign_lead_by_rule($1) value",[lead.id])).rows[0].value,null);
 await as("owner","select configure_lead_distribution($1,'smallest_portfolio',true,'{}')",[org]);
 assert.equal((await as("owner","select assign_lead_by_rule($1) value",[lead.id])).rows[0].value,ids.agent);
 await denied("agent","select configure_lead_distribution($1,'manual',false,'{}')",[org]);
});

test("OPSDB03 dashboard preferences are private per user and validated",async()=>{
 await as("agent","select save_dashboard_preferences($1,array['my_day','agenda'],array['agenda','my_day'])",[org]);
 assert.equal((await as("agent","select count(*)::int n from user_dashboard_preferences where user_id=$1",[ids.agent])).rows[0].n,1);
 assert.equal((await as("owner","select * from user_dashboard_preferences where user_id=$1",[ids.agent])).rows.length,0);
 await assert.rejects(as("agent","select save_dashboard_preferences($1,array['invalid'],array['invalid'])",[org]),/Invalid dashboard preferences/);
});

test("OPSDB04 branding and webhooks remain owner-only",async()=>{
 const updated=(await as("owner","select (update_organization_branding($1,$2::jsonb)).trade_name value",[org,JSON.stringify({trade_name:"Imobiliária teste",brand_primary_color:"#112233"})])).rows[0].value;
 assert.equal(updated,"Imobiliária teste");
 await denied("agent","select update_organization_branding($1,'{}')",[org]);
 await as("owner","insert into integration_webhooks(organization_id,name,endpoint_url,events,secret_hash,created_by) values($1,'CRM seguro','https://example.invalid/hook',array['lead.created'],$2,$3)",[org,"a".repeat(64),ids.owner]);
 assert.equal((await as("agent","select * from integration_webhooks where organization_id=$1",[org])).rows.length,0);
});

test("OPSDB05 foreign references cannot be attached to another tenant",async()=>{
 const foreignOrg=(await db.query("select organization_id from profiles where id=$1",[ids.outsider])).rows[0].organization_id;
 const foreignOwner=(await as("outsider","insert into property_owners(organization_id,full_name,email,created_by) values($1,'Outro proprietário','owner@foreign.invalid',$2) returning id",[foreignOrg,ids.outsider])).rows[0];
 await assert.rejects(as("owner","insert into property_acquisitions(organization_id,owner_id,title,created_by) values($1,$2,'Referência indevida',$3)",[org,foreignOwner.id,ids.owner]),/Cross-tenant acquisition reference denied/);
 await assert.rejects(as("owner","insert into sales_goals(organization_id,user_id,metric,period_start,period_end,target_value,created_by) values($1,$2,'sales','2026-09-01','2026-09-30',1,$3)",[org,ids.outsider,ids.owner]),/Cross-tenant goal reference denied/);
});

test.after(async()=>db.close());

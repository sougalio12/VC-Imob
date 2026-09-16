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
for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql") && name <= "20260915050000_capture_marketing_secure.sql").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

const ids = { owner:"55000000-0000-0000-0000-000000000001", manager:"55000000-0000-0000-0000-000000000002", agent:"55000000-0000-0000-0000-000000000003", outsider:"55000000-0000-0000-0000-000000000004" };
for (const [name,id] of Object.entries(ids)) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')",[id,`${name}@capture.invalid`]);
const org = (await db.query("select organization_id from profiles where id=$1",[ids.owner])).rows[0].organization_id;
const outsiderOrg = (await db.query("select organization_id from profiles where id=$1",[ids.outsider])).rows[0].organization_id;
await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'manager','active'),($1,$3,'agent','active')",[org,ids.manager,ids.agent]);
async function as(who,sql,args=[]){ await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]); await db.exec("set role authenticated"); try{return await db.query(sql,args);}finally{await db.exec("reset role");} }
const denied=(who,sql,args=[])=>assert.rejects(as(who,sql,args),error=>["42501","23514"].includes(error.code));
let propertyOwner, acquisition, campaign, lead;

test("CAPDB01 agent creates only self-assigned owner and acquisition", async () => {
  propertyOwner=(await as("agent","select (save_property_owner($1,null,$2::jsonb)).*",[org,JSON.stringify({full_name:"Proprietário sintético",phone:"+55 (65) 99999-9901",email:"owner@capture.invalid",notes:"Teste",assigned_to:ids.owner,status:"active"})])).rows[0];
  assert.equal(propertyOwner.assigned_to,ids.agent);
  assert.equal((await as("agent","select count(*)::int n from property_owners where id=$1",[propertyOwner.id])).rows[0].n,1);
  acquisition=(await as("agent","select (save_property_acquisition($1,null,$2::jsonb)).*",[org,JSON.stringify({owner_id:propertyOwner.id,assigned_to:ids.manager,title:"Apartamento em captação",property_type:"Apartamento",neighborhood:"Centro",estimated_value:500000,stage:"qualification",loss_reason:null,next_action_at:"2026-09-20T14:00:00Z",notes:"Sem dados sensíveis"})])).rows[0];
  assert.equal(acquisition.assigned_to,ids.agent);
  assert.equal((await as("outsider","select count(*)::int n from property_acquisitions where id=$1",[acquisition.id])).rows[0].n,0);
});

test("CAPDB02 activity and history are scoped to the assigned capture", async () => {
  const activity=(await as("agent","select (save_acquisition_activity($1,null,$2::jsonb)).*",[acquisition.id,JSON.stringify({assigned_to:ids.manager,kind:"technical_visit",title:"Visita técnica",scheduled_at:"2026-09-21T14:00:00Z",status:"scheduled",notes:"Agendada"})])).rows[0];
  assert.equal(activity.assigned_to,ids.agent);
  assert.ok((await as("agent","select count(*)::int n from property_acquisition_history where acquisition_id=$1",[acquisition.id])).rows[0].n>=1);
  assert.equal((await as("outsider","select count(*)::int n from property_acquisition_activities where id=$1",[activity.id])).rows[0].n,0);
});

test("CAPDB03 agent cannot convert; owner conversion is idempotent and creates an unpublished draft", async () => {
  const payload=JSON.stringify({code:"VCI999991",title:"Imóvel captado",slug:"imovel-captado-teste",purpose:"venda",city:"Lucas do Rio Verde",state:"MT"});
  await denied("agent","select (convert_acquisition_to_property($1,$2::jsonb)).id",[acquisition.id,payload]);
  const first=(await as("owner","select (convert_acquisition_to_property($1,$2::jsonb)).*",[acquisition.id,payload])).rows[0];
  const second=(await as("owner","select (convert_acquisition_to_property($1,$2::jsonb)).*",[acquisition.id,payload])).rows[0];
  assert.equal(first.id,second.id); assert.equal(first.status,"draft"); assert.equal(first.is_published,false);
  assert.equal((await as("owner","select property_id from property_acquisitions where id=$1",[acquisition.id])).rows[0].property_id,first.id);
});

test("CAPDB04 campaign references cannot cross tenants and attribution is lead-scoped", async () => {
  const foreignProperty=(await as("outsider","select (save_crm_property($1,null,null,$2::jsonb)).id",[outsiderOrg,JSON.stringify({code:"VCI999992",title:"Outro tenant",slug:"outro-tenant",purpose:"venda",status:"draft",is_published:false})])).rows[0].id;
  await denied("owner","select save_marketing_campaign($1,null,$2::jsonb)",[org,JSON.stringify({name:"Campanha inválida",source:"site",property_id:foreignProperty,status:"active"})]);
  campaign=(await as("owner","select (save_marketing_campaign($1,null,$2::jsonb)).*",[org,JSON.stringify({name:"Campanha setembro",source:"Instagram",medium:"Social",campaign:"Beta 2026",cost:null,status:"active"})])).rows[0];
  lead=(await db.query("insert into leads(organization_id,name,phone,stage,assigned_to) values($1,'Lead atribuído','6599999902','novo',$2) returning *",[org,ids.agent])).rows[0];
  const saved=(await as("agent","select (attribute_lead_marketing($1,$2::jsonb)).*",[lead.id,JSON.stringify({source:"Instagram",medium:"Social",campaign:"Beta 2026",content:null,term:null,landing_page:"https://valdineycapistranoimoveis.com.br/imovel.html",marketing_campaign_id:campaign.id})])).rows[0];
  assert.equal(saved.utm_source,"instagram"); assert.equal(saved.marketing_campaign_id,campaign.id);
  await denied("outsider","select attribute_lead_marketing($1,$2::jsonb)",[lead.id,JSON.stringify({source:"google"})]);
});

test("CAPDB05 ROI distinguishes unknown values and does not multiply equal sales", async () => {
  let row=(await as("owner","select * from get_marketing_roi($1) where campaign_id=$2",[org,campaign.id])).rows[0];
  assert.equal(row.cost,null); assert.equal(row.cpl,null); assert.equal(row.roi,null); assert.equal(Number(row.leads),1);
  await as("owner","select save_marketing_campaign($1,$2,$3::jsonb)",[org,campaign.id,JSON.stringify({name:"Campanha setembro",source:"instagram",medium:"social",campaign:"beta-2026",cost:1000,status:"active"})]);
  const propertyId=(await db.query("select id from properties where organization_id=$1 limit 1",[org])).rows[0].id;
  await db.query("insert into appointments(organization_id,lead_id,assigned_to,kind,scheduled_at,status,completed_at) values($1,$2,$3,'visita',now(),'concluido',now())",[org,lead.id,ids.agent]);
  await db.query("insert into proposals(organization_id,lead_id,property_id,assigned_to,proposed_price,final_price,status) values($1,$2,$3,$4,500000,500000,'accepted'),($1,$2,$3,$4,500000,500000,'accepted')",[org,lead.id,propertyId,ids.agent]);
  row=(await as("owner","select * from get_marketing_roi($1) where campaign_id=$2",[org,campaign.id])).rows[0];
  assert.equal(Number(row.sales),2); assert.equal(Number(row.revenue),1000000); assert.equal(Number(row.cpl),1000); assert.equal(Number(row.cac),500); assert.equal(Number(row.roi),99900);
  assert.equal((await as("agent","select count(*)::int n from get_marketing_roi($1)",[org])).rows[0].n,0);
});

test("CAPDB06 direct writes and forged organization references remain denied", async () => {
  await denied("owner","insert into property_owners(organization_id,full_name,email) values($1,'Direto','direct@invalid.test')",[org]);
  await denied("agent","update marketing_campaigns set cost=0 where id=$1",[campaign.id]);
  await denied("owner","select save_property_acquisition($1,null,$2::jsonb)",[org,JSON.stringify({owner_id:propertyOwner.id,assigned_to:ids.outsider,title:"Referência forjada",stage:"new_contact"})]);
});

test.after(async()=>db.close());

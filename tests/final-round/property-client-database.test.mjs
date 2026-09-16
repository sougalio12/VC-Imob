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
for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

const owner = "52000000-0000-0000-0000-000000000001", outsider = "52000000-0000-0000-0000-000000000002";
for (const [id,email] of [[owner,"owner@selection.invalid"],[outsider,"outsider@selection.invalid"]]) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')",[id,email]);
const org = (await db.query("select organization_id from profiles where id=$1",[owner])).rows[0].organization_id;
async function authenticated(user,sql,args=[]){await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("set role authenticated");try{return await db.query(sql,args);}finally{await db.exec("reset role");}}
async function anonymous(sql,args=[]){await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec("set role anon");try{return await db.query(sql,args);}finally{await db.exec("reset role");}}

test("CLIENTDB01 publication requirements are enforced by the backend", async () => {
  const incomplete = {code:"VCI900001",title:"Imóvel incompleto",purpose:"venda",property_type:"Apartamento",price:500000,status:"available",city:"Lucas do Rio Verde",is_published:true};
  await assert.rejects(authenticated(owner,"select save_crm_property_with_media($1,null,null,$2::jsonb,'[]'::jsonb)",[org,JSON.stringify(incomplete)]),/CRM_PROPERTY_PUBLICATION_INCOMPLETE/);
});

let propertyId, secondPropertyId, leadId, token, selectionId;
test("CLIENTDB02 owner creates an ordered private selection and token sees only selected published properties", async () => {
  const payload = {code:"VCI900002",title:"Imóvel de validação",slug:"vci900002-imovel-validacao",purpose:"venda",property_type:"Apartamento",price:500000,status:"available",city:"Lucas do Rio Verde",is_published:true};
  const media = [{storage_path:"assets/images/teste.jpg",sort_order:0,is_cover:true,alt_text:"Foto de validação",media_kind:"photo"}];
  propertyId=(await authenticated(owner,"select (save_crm_property_with_media($1,null,null,$2::jsonb,$3::jsonb)).id id",[org,JSON.stringify(payload),JSON.stringify(media)])).rows[0].id;
  const secondPayload = {...payload,code:"VCI900003",slug:"vci900003-imovel-validacao",title:"Segundo imóvel"};
  secondPropertyId=(await authenticated(owner,"select (save_crm_property_with_media($1,null,null,$2::jsonb,$3::jsonb)).id id",[org,JSON.stringify(secondPayload),JSON.stringify(media)])).rows[0].id;
  leadId=(await authenticated(owner,"select (save_crm_lead($1,null,null,$2::jsonb)).id id",[org,JSON.stringify({name:"Cliente seleção",phone:"65999990000",origin:"manual",stage:"novo"})])).rows[0].id;
  const created=(await authenticated(owner,"select create_client_selection($1,$2,'Seleção segura','Mensagem',array[$3,$4]::uuid[],null) result",[org,leadId,secondPropertyId,propertyId])).rows[0].result;
  token=created.token; selectionId=created.id;
  assert.match(token,/^[a-f0-9]{64}$/);
  const publicSelection=(await anonymous("select get_client_selection($1) result",[token])).rows[0].result;
  assert.equal(publicSelection.properties.length,2);
  assert.deepEqual(publicSelection.properties.map(item=>item.codigo),["VCI900003","VCI900002"]);
});

test("CLIENTDB03 feedback and favorites are limited to the token selection", async () => {
  await anonymous("select submit_client_feedback($1,$2,'liked','Gostei da localização')",[token,propertyId]);
  await anonymous("select set_client_favorite($1,$2,true)",[token,propertyId]);
  const feedback=(await authenticated(owner,"select reaction,is_favorite,comment from client_feedback where selection_id=$1",[selectionId])).rows[0];
  assert.deepEqual(feedback,{reaction:"liked",is_favorite:true,comment:"Gostei da localização"});
  assert.equal((await authenticated(outsider,"select * from client_feedback where selection_id=$1",[selectionId])).rows.length,0);
  const outsiderOrg=(await authenticated(outsider,"select organization_id from profiles where id=$1",[outsider])).rows[0].organization_id;
  await assert.rejects(authenticated(outsider,"select create_client_selection($1,$2,'Inválida',null,array[$3]::uuid[],null)",[outsiderOrg,leadId,propertyId]),/Lead access denied/);
});

test("CLIENTDB04 revoked token stops portal access", async () => {
  await authenticated(owner,"select revoke_client_selection($1,$2)",[org,selectionId]);
  assert.equal((await anonymous("select get_client_selection($1) result",[token])).rows[0].result,null);
});

test("CLIENTDB05 structured post-visit feedback stays lead and tenant scoped", async () => {
  const appointment=(await authenticated(owner,"select (save_crm_activity($1::uuid,null::uuid,$2::uuid,$3::uuid,'visita','Visita de validação',now(),2::smallint,null::text)).id id",[org,leadId,owner])).rows[0].id;
  await authenticated(owner,"select set_crm_activity_status($1,$2,'concluido')",[org,appointment]);
  const saved=(await authenticated(owner,"select (save_post_visit_feedback($1,$2,$3,'liked',array['preço'],'boa localização',true,'esta semana','preparar proposta')).*",[org,appointment,propertyId])).rows[0];
  assert.equal(saved.outcome,"liked");
  assert.equal(saved.proposal_intent,true);
  assert.equal(saved.next_step,"preparar proposta");
  assert.equal((await authenticated(outsider,"select * from post_visit_feedback where appointment_id=$1",[appointment])).rows.length,0);
});

test.after(async()=>db.close());

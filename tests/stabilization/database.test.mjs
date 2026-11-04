import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema extensions;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',invited_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;create extension pgcrypto with schema extensions;`);
for(const file of readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
let serial=0;
const nextId=()=>`88000000-0000-0000-0000-${String(++serial).padStart(12,'0')}`;
async function user(metadata={},appMetadata={},invited=null){const id=nextId();await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,invited_at) values($1,$2,$3,$4,$5)',[id,`${id}@test.invalid`,metadata,appMetadata,invited]);return id;}
const consent={legal_accepted:true,terms_version:'2026-09-12',privacy_version:'2026-09-12',full_name:'Cliente Teste',phone:'65999990000'};
const owner=await user({}, {vcimob_provisioning:'administrative'}),other=await user({}, {vcimob_provisioning:'administrative'});
const org=(await db.query('select organization_id from profiles where id=$1',[owner])).rows[0].organization_id;
const foreign=(await db.query('select organization_id from profiles where id=$1',[other])).rows[0].organization_id;
await db.query("insert into organization_sites(organization_id,hostname,status) values($1,'preview.test','active')",[org]);
await db.query("insert into properties(organization_id,code,title,slug,status,is_published,created_by) values($1,'VCI000001','Título verdadeiro','one','available',true,$2),($1,'VCI000002','Reservado','two','reserved',true,$2),($1,'VCI000003','Rascunho','three','draft',false,$2)",[org,owner]);
await db.query("insert into properties(organization_id,code,title,slug,status,is_published,created_by) values($1,'VCI000001','Outro tenant','one','available',true,$2),($1,'VCI000004','Somente outro tenant','four','available',true,$2)",[foreign,other]);
async function as(role,sql,args=[]){await db.exec(`set role ${role}`);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const capture=(code,phone='65999990000')=>as('service_role','select * from capture_published_site_lead($1,$2,$3,$4,$5)',[org,'Interessado',phone,'',code]);
test('omitting or forging the public_signup flag never bypasses required consent',async()=>{
  for(const metadata of [{},{public_signup:false},{public_signup:'false'},{public_signup:false,vcimob_provisioning:'administrative'},{...consent,legal_accepted:false},{...consent,terms_version:'invented'},{...consent,privacy_version:'invented'}])await assert.rejects(user(metadata),e=>e.code==='22023');
});
test('public signup persists current server-recognized versions regardless of legacy flag',async()=>{
  for(const flag of [undefined,false,true]){const id=await user({...consent,...(flag===undefined?{}:{public_signup:flag})});const row=(await db.query('select terms_version,privacy_version from account_consents where user_id=$1',[id])).rows[0];assert.deepEqual(row,{terms_version:'2026-09-12',privacy_version:'2026-09-12'});assert.equal((await db.query('select count(*)::int n from trial_claims where user_id=$1',[id])).rows[0].n,1);}
});
test('trusted Admin API and Auth invitation provisioning remain available without fabricated consent',async()=>{
  for(const id of [owner,await user({}, {},new Date().toISOString())]){assert.equal((await db.query('select count(*)::int n from profiles where id=$1',[id])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from account_consents where user_id=$1',[id])).rows[0].n,0);}
});
test('failed consent insert rolls back organization and profile creation',async()=>{
  const before=(await db.query('select count(*)::int n from organizations')).rows[0].n;await assert.rejects(user({public_signup:false}));assert.equal((await db.query('select count(*)::int n from organizations')).rows[0].n,before);
});
test('catalog and capture share publication rules; titles and tenant are authoritative',async()=>{
  const catalog=(await as('anon',"select list_public_properties('preview.test') property")).rows.map(row=>row.property);
  assert.deepEqual(catalog.map(row=>row.codigo).sort(),['VCI000001','VCI000002']);
  for(const code of ['VCI000001','VCI000002'])assert.equal((await capture(code)).rows.length,1);
  const lead=(await db.query('select organization_id,property_title from leads where organization_id=$1',[org])).rows[0];assert.equal(lead.organization_id,org);assert.equal(lead.property_title,'Reservado');
  assert.equal((await db.query('select count(*)::int n from leads where organization_id=$1',[foreign])).rows[0].n,0);
});
test('draft, missing and foreign-only property codes create no leads',async()=>{
  const before=(await db.query('select count(*)::int n from leads')).rows[0].n;
  for(const code of ['VCI000003','VCI000004','VCI999999'])assert.equal((await capture(code,'65999990001')).rows.length,0);
  assert.equal((await db.query('select count(*)::int n from leads')).rows[0].n,before);
});
test('unpublishing removes a property from both catalog and capture immediately',async()=>{
  await db.query("update properties set is_published=false,status='inactive' where organization_id=$1 and code='VCI000001'",[org]);
  assert.equal((await capture('VCI000001','65999990002')).rows.length,0);
  assert.equal((await as('anon',"select list_public_properties('preview.test') property")).rows.some(row=>row.property.codigo==='VCI000001'),false);
});
test('anonymous and authenticated clients cannot choose an organization through capture RPC',async()=>{
  for(const role of ['anon','authenticated'])await assert.rejects(as(role,'select * from capture_published_site_lead($1,$2,$3,$4,$5)',[org,'Test','65999990000','','VCI000002']),e=>e.code==='42501');
});
test.after(()=>db.close());

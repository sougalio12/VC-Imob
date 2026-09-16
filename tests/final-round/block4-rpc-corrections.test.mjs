import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";

const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema extensions;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  create extension pgcrypto with schema extensions;`);
for(const file of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort())
  await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));

const ids={owner:"67000000-0000-0000-0000-000000000001",agent:"67000000-0000-0000-0000-000000000002",outsider:"67000000-0000-0000-0000-000000000003"};
for(const [name,id] of Object.entries(ids))
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"public_signup\":false}')",[id,`${name}@rpc-fix.invalid`]);
const org=(await db.query("select organization_id from profiles where id=$1",[ids.owner])).rows[0].organization_id;
await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'agent','active')",[org,ids.agent]);
await db.query("update subscriptions set plan_id=(select id from plans where code='equipe'),provider='internal',status='active',is_current=true,metadata=coalesce(metadata,'{}')||'{\"billing_exempt\":true}'::jsonb where organization_id=$1",[org]);

async function as(who,sql,args=[]){
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);
  await db.exec("set role authenticated");
  try{return await db.query(sql,args);}finally{await db.exec("reset role");}
}
const rejected=(who,sql,args=[],codes=["42501","22023","40001"])=>
  assert.rejects(as(who,sql,args),error=>codes.includes(error.code));

test("FIX-01 undo supports only real lead fields and rejects legacy temperature",async()=>{
  const fields=(await db.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='lead_undo_actions_field_name_check'")).rows[0].definition;
  assert.match(fields,/stage/);assert.match(fields,/assigned_to/);assert.doesNotMatch(fields,/temperature/);
  const lead=(await db.query("insert into leads(organization_id,assigned_to,name,phone) values($1,$2,'Lead real','65999991001') returning id",[org,ids.agent])).rows[0];
  await rejected("agent","select change_lead_with_undo($1,$2,null,'temperature','hot')",[org,lead.id],["22023"]);
});

test("FIX-02 stage undo is actor-bound, auditable and concurrency-safe",async()=>{
  const lead=(await db.query("insert into leads(organization_id,assigned_to,name,phone,stage) values($1,$2,'Undo stage','65999991002','novo') returning id",[org,ids.agent])).rows[0];
  const changed=(await as("agent","select change_lead_with_undo($1,$2,null,'stage','atendimento') value",[org,lead.id])).rows[0].value;
  assert.equal((await db.query("select stage from leads where id=$1",[lead.id])).rows[0].stage,"atendimento");
  await db.query("update leads set stage='visita' where id=$1",[lead.id]);
  await rejected("agent","select undo_lead_change($1,$2)",[org,changed.undo_id],["40001"]);
  assert.equal((await db.query("select consumed_at is null pending from lead_undo_actions where id=$1",[changed.undo_id])).rows[0].pending,true);
  await db.query("update leads set stage='atendimento' where id=$1",[lead.id]);
  await as("agent","select undo_lead_change($1,$2)",[org,changed.undo_id]);
  assert.equal((await db.query("select stage from leads where id=$1",[lead.id])).rows[0].stage,"novo");
  assert.equal((await db.query("select count(*)::int n from audit_events where entity_id=$1 and action in ('lead_change_with_undo','lead_change_undone')",[lead.id])).rows[0].n,2);
});

test("FIX-03 assignment undo remains manager-only and tenant-scoped",async()=>{
  const lead=(await db.query("insert into leads(organization_id,name,phone) values($1,'Undo assignment','65999991003') returning id",[org])).rows[0];
  await rejected("agent","select change_lead_with_undo($1,$2,null,'assigned_to',$3)",[org,lead.id,ids.agent],["42501"]);
  const changed=(await as("owner","select change_lead_with_undo($1,$2,null,'assigned_to',$3) value",[org,lead.id,ids.agent])).rows[0].value;
  assert.equal((await db.query("select assigned_to from leads where id=$1",[lead.id])).rows[0].assigned_to,ids.agent);
  await rejected("outsider","select undo_lead_change($1,$2)",[org,changed.undo_id],["42501"]);
  await as("owner","select undo_lead_change($1,$2)",[org,changed.undo_id]);
  assert.equal((await db.query("select assigned_to from leads where id=$1",[lead.id])).rows[0].assigned_to,null);
});

test("FIX-04 assistant confirmation calls the current activity RPC signature",async()=>{
  const lead=(await db.query("insert into leads(organization_id,assigned_to,name,phone) values($1,$2,'Assistente','65999991004') returning id",[org,ids.agent])).rows[0];
  const payload=JSON.stringify({lead_id:lead.id,kind:"retorno",title:"Retorno confirmado",scheduled_at:"2026-09-16T15:00:00Z",priority:2,notes:"Criado após preview"});
  const preview=(await as("agent","select (prepare_assistant_action($1,'create_activity',$2::jsonb)).id id",[org,payload])).rows[0];
  await rejected("owner","select confirm_assistant_action($1)",[preview.id],["22023"]);
  const confirmed=(await as("agent","select confirm_assistant_action($1) value",[preview.id])).rows[0].value;
  const activity=(await db.query("select organization_id,lead_id,assigned_to,kind,title,priority from appointments where id=$1",[confirmed.entity_id])).rows[0];
  assert.deepEqual(activity,{organization_id:org,lead_id:lead.id,assigned_to:ids.agent,kind:"retorno",title:"Retorno confirmado",priority:2});
  assert.equal((await db.query("select status from assistant_action_previews where id=$1",[preview.id])).rows[0].status,"confirmed");
  assert.equal((await db.query("select count(*)::int n from audit_events where entity_id=$1 and action='assistant_action_confirmed'",[preview.id])).rows[0].n,1);
  await rejected("agent","select confirm_assistant_action($1)",[preview.id],["22023"]);
});

test("FIX-05 expired previews and anonymous calls fail closed",async()=>{
  const lead=(await db.query("insert into leads(organization_id,assigned_to,name,phone) values($1,$2,'Preview vencido','65999991005') returning id",[org,ids.agent])).rows[0];
  const payload=JSON.stringify({lead_id:lead.id,kind:"tarefa",title:"Não criar",scheduled_at:"2026-09-16T16:00:00Z",priority:1});
  const preview=(await as("agent","select (prepare_assistant_action($1,'create_activity',$2::jsonb)).id id",[org,payload])).rows[0];
  await db.query("update assistant_action_previews set expires_at=now()-interval '1 second' where id=$1",[preview.id]);
  await rejected("agent","select confirm_assistant_action($1)",[preview.id],["22023"]);
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon");
  try{
    await assert.rejects(db.query("select change_lead_with_undo(null,null,null,'stage','novo')"),error=>error.code==="42501");
    await assert.rejects(db.query("select confirm_assistant_action(null)"),error=>error.code==="42501");
  }finally{await db.exec("reset role");}
});

test.after(async()=>db.close());

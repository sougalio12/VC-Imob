import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packagePath = process.env.PGLITE_PACKAGE;
if (!packagePath) throw new Error("PGLITE_PACKAGE required");
const { PGlite } = await import(pathToFileURL(resolve(packagePath, "dist/index.js")));
const { pgcrypto } = await import(pathToFileURL(resolve(packagePath, "dist/contrib/pgcrypto.js")));
const db = new PGlite({ extensions: { pgcrypto } });

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create schema extensions;
  create table auth.users(
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create extension pgcrypto with schema extensions;
`);

for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}

const ids = {
  owner: "42000000-0000-0000-0000-000000000001",
  manager: "42000000-0000-0000-0000-000000000002",
  agent: "42000000-0000-0000-0000-000000000003",
  outsider: "42000000-0000-0000-0000-000000000004"
};
for (const [name, id] of Object.entries(ids)) {
  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data)
     values($1,$2,'{"public_signup":false,"full_name":"Test user"}')`,
    [id, `${name}@crud-security.invalid`]
  );
}

const organization = (await db.query("select organization_id from profiles where id=$1", [ids.owner])).rows[0].organization_id;
const foreignOrganization = (await db.query("select organization_id from profiles where id=$1", [ids.outsider])).rows[0].organization_id;
await db.query(
  `insert into organization_members(organization_id,user_id,role,status)
   values($1,$2,'manager','active'),($1,$3,'agent','active')`,
  [organization, ids.manager, ids.agent]
);

async function as(who, sql, parameters = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[who] || ""]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, parameters);
  } finally {
    await db.exec("reset role");
  }
}

function denied(who, sql, parameters = [], codes = ["42501"]) {
  return assert.rejects(as(who, sql, parameters), error => codes.includes(error.code));
}

async function saveProperty(who, org, id, expected, payload) {
  return (await as(
    who,
    "select * from public.save_crm_property($1,$2,$3,$4::jsonb)",
    [org, id, expected, JSON.stringify(payload)]
  )).rows[0];
}

async function saveLead(who, org, id, expected, payload) {
  return (await as(
    who,
    "select * from public.save_crm_lead($1,$2,$3,$4::jsonb)",
    [org, id, expected, JSON.stringify(payload)]
  )).rows[0];
}

test("CRUD01 owner creates and updates a property without writable organization_id", async () => {
  const property = await saveProperty("owner", organization, null, null, {
    code: "VCI999981", title: "Imóvel seguro", slug: "imovel-seguro", status: "draft"
  });
  assert.equal(property.organization_id, organization);
  const updated = await saveProperty("owner", organization, property.id, property.updated_at, {
    title: "Imóvel seguro atualizado", status: "available", is_published: true, price: 550000
  });
  assert.equal(updated.title, "Imóvel seguro atualizado");
  assert.equal(updated.price, "550000.00");
  assert.equal(updated.is_published, true);

  // Regression for the beta failure: organization_id remains non-writable rather
  // than solving the client bug by granting a tenant-changing column.
  await denied(
    "owner",
    "update public.properties set organization_id=$1 where id=$2",
    [foreignOrganization, property.id]
  );
});

test("CRUD02 manager can manage own-tenant property; agent cannot", async () => {
  const property = await saveProperty("manager", organization, null, null, {
    code: "VCI999982", title: "Imóvel da equipe", slug: "imovel-equipe"
  });
  assert.equal(property.organization_id, organization);
  const updated = await saveProperty("manager", organization, property.id, property.updated_at, { title: "Editado pelo gerente" });
  assert.equal(updated.title, "Editado pelo gerente");
  await denied("agent", "select public.save_crm_property($1,$2,null,$3::jsonb)", [organization, property.id, '{"title":"Escalada"}']);
});

test("CRUD03 property RPC fails closed across tenants and rejects injected fields", async () => {
  await denied("outsider", "select public.save_crm_property($1,null,null,$2::jsonb)", [organization, '{"code":"VCI999983","title":"X","slug":"x"}']);
  await denied("owner", "select public.save_crm_property($1,null,null,$2::jsonb)", [foreignOrganization, '{"code":"VCI999984","title":"X","slug":"x"}']);
  await denied(
    "owner",
    "select public.save_crm_property($1,null,null,$2::jsonb)",
    [organization, JSON.stringify({ code: "VCI999985", title: "X", slug: "x", organization_id: foreignOrganization })],
    ["22023"]
  );
});

test("CRUD04 property optimistic concurrency prevents silent overwrite", async () => {
  const property = await saveProperty("owner", organization, null, null, {
    code: "VCI999986", title: "Concorrência", slug: "concorrencia"
  });
  await denied(
    "owner",
    "select public.save_crm_property($1,$2,$3,$4::jsonb)",
    [organization, property.id, "2000-01-01T00:00:00Z", '{"title":"Sobrescrita"}'],
    ["40001"]
  );
  assert.equal((await as("owner", "select title from properties where id=$1", [property.id])).rows[0].title, "Concorrência");
});

test("CRUD05 lead create/update normalizes phone and persists preferences atomically", async () => {
  const lead = await saveLead("owner", organization, null, null, {
    name: "Lead seguro",
    phone: "+55 (65) 99999-9999",
    stage: "novo",
    preference_min_price: 400000,
    preference_max_price: 600000,
    preference_features: ["Piscina"]
  });
  assert.equal(lead.phone, "65999999999");
  assert.equal(lead.assigned_to, ids.owner);
  const updated = await saveLead("owner", organization, lead.id, lead.updated_at, {
    stage: "atendimento",
    property_code: "VCI000006",
    property_title: "Apartamento no Residencial Vida Azaléias",
    preference_city: "Lucas do Rio Verde",
    preference_min_bedrooms: 2
  });
  assert.equal(updated.stage, "atendimento");
  assert.equal(updated.preference_city, "Lucas do Rio Verde");
  assert.equal(updated.preference_min_bedrooms, 2);
});

test("CRUD06 agent can create/update only own assigned lead", async () => {
  const ownLead = await saveLead("agent", organization, null, null, {
    name: "Carteira do corretor", whatsapp: "(65) 99999-8888", stage: "novo"
  });
  assert.equal(ownLead.assigned_to, ids.agent);
  const updated = await saveLead("agent", organization, ownLead.id, ownLead.updated_at, {
    stage: "visita", preference_notes: "Busca objetiva"
  });
  assert.equal(updated.stage, "visita");

  const ownerLead = await saveLead("owner", organization, null, null, {
    name: "Carteira do proprietário", phone: "65999997777", stage: "novo"
  });
  await denied("agent", "select public.save_crm_lead($1,$2,null,$3::jsonb)", [organization, ownerLead.id, '{"stage":"perdido"}']);
});

test("CRUD07 lead RPC blocks tenant injection, cross-tenant access and bad input", async () => {
  await denied("outsider", "select public.save_crm_lead($1,null,null,$2::jsonb)", [organization, '{"name":"X","phone":"65999999999"}']);
  await denied("owner", "select public.save_crm_lead($1,null,null,$2::jsonb)", [foreignOrganization, '{"name":"X","phone":"65999999999"}']);
  await denied(
    "owner",
    "select public.save_crm_lead($1,null,null,$2::jsonb)",
    [organization, JSON.stringify({ name: "X", phone: "65999999999", assigned_to: ids.outsider })],
    ["22023"]
  );
  await denied("owner", "select public.save_crm_lead($1,null,null,$2::jsonb)", [organization, '{"name":"X","phone":"123"}'], ["22023"]);
  await denied("owner", "select public.save_crm_lead($1,null,null,$2::jsonb)", [organization, '{"name":"X","phone":"65999999999","email":"invalido"}'], ["22023"]);
});

test("CRUD08 lead concurrency and assignment protections remain effective", async () => {
  const lead = await saveLead("manager", organization, null, null, {
    name: "Lead concorrente", phone: "65988887777", stage: "novo"
  });
  await denied(
    "manager",
    "select public.save_crm_lead($1,$2,$3,$4::jsonb)",
    [organization, lead.id, "2000-01-01T00:00:00Z", '{"stage":"negociacao"}'],
    ["40001"]
  );
  await as("manager", "select public.assign_lead($1,$2,$3)", [organization, lead.id, ids.agent]);
  assert.equal((await as("agent", "select assigned_to from leads where id=$1", [lead.id])).rows[0].assigned_to, ids.agent);
  await denied("agent", "select public.assign_lead($1,$2,$3)", [organization, lead.id, ids.agent]);
});

test("CRUD09 interests and deletion stay lead-scoped", async () => {
  const ownLead = await saveLead("agent", organization, null, null, {
    name: "Lead com interesse", phone: "65977776666", stage: "novo"
  });
  const interest = (await as(
    "agent",
    "insert into lead_interests(organization_id,lead_id,property_code,source) values($1,$2,'VCI000006','crm') returning id",
    [organization, ownLead.id]
  )).rows[0];
  assert.ok(interest.id);
  await denied(
    "outsider",
    "insert into lead_interests(organization_id,lead_id,property_code,source) values($1,$2,'VCI000006','crm')",
    [organization, ownLead.id]
  );
  assert.equal((await as("agent", "delete from leads where id=$1 returning id", [ownLead.id])).rows.length, 0);
  await as("owner", "delete from leads where id=$1", [ownLead.id]);
  assert.equal((await as("owner", "select id from leads where id=$1", [ownLead.id])).rows.length, 0);
});

test("CRUD10 function privileges are minimal", async () => {
  const rows = (await db.query(`
    select routine_name, grantee, privilege_type
    from information_schema.routine_privileges
    where routine_schema='public'
      and routine_name in ('save_crm_property','save_crm_property_with_media','save_crm_lead','normalize_crm_phone')
    order by routine_name,grantee
  `)).rows;
  assert.ok(rows.some(row => row.routine_name === "save_crm_property" && row.grantee === "authenticated"));
  assert.ok(rows.some(row => row.routine_name === "save_crm_property_with_media" && row.grantee === "authenticated"));
  assert.ok(rows.some(row => row.routine_name === "save_crm_lead" && row.grantee === "authenticated"));
  assert.equal(rows.some(row => ["PUBLIC", "anon"].includes(row.grantee)), false);
  assert.equal(rows.some(row => row.routine_name === "normalize_crm_phone" && row.grantee === "authenticated"), false);
});

test("CRUD11 property and media mutation rolls back as one unit", async () => {
  const property = await saveProperty("owner", organization, null, null, {
    code: "VCI999987", title: "Transação", slug: "transacao", status: "draft"
  });
  await assert.rejects(
    as(
      "owner",
      "select * from public.save_crm_property_with_media($1,$2,$3,$4::jsonb,$5::jsonb)",
      [organization, property.id, property.updated_at, '{"title":"Não deve persistir"}', '[{"storage_path":""}]']
    ),
    error => error.code === "22023"
  );
  assert.equal((await as("owner", "select title from properties where id=$1", [property.id])).rows[0].title, "Transação");
});

test.after(async () => db.close());

import process from "node:process";

const PRODUCTION_PROJECT_REF = "isbkhhobutbdtdtpaavn";
const confirmation = process.env.PHASE_C_CONFIRM;
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.PHASE_C_TEST_PASSWORD;

const isLocalRun = confirmation === "RUN_ON_LOCAL_ONLY";
const isStagingRun = confirmation === "RUN_ON_STAGING_ONLY";

if (!isLocalRun && !isStagingRun) throw new Error("Set PHASE_C_CONFIRM for an explicitly approved local or staging run");
if (!supabaseUrl || !anonKey || !serviceKey || !password) throw new Error("Missing required test environment variables");
if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) throw new Error("Refusing to run against the VC Imob production project");
if (isLocalRun && !["http://127.0.0.1:54321", "http://localhost:54321"].includes(supabaseUrl)) {
  throw new Error(`Refusing non-local URL in local mode: ${supabaseUrl}`);
}

const emails = {
  ownerA: "phase-c-owner-a@example.com",
  managerA: "phase-c-manager-a@example.com",
  agentA1: "phase-c-agent-a1@example.com",
  agentA2: "phase-c-agent-a2@example.com",
  disabledA: "phase-c-disabled-a@example.com",
  ownerB: "phase-c-owner-b@example.com"
};

let passed = 0;
const failures = [];
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, action) {
  try {
    await action();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function request(path, { key = anonKey, token = key, method = "GET", body, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function login(email) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password }
  });
  assert(result.ok, `login failed for ${email}: ${JSON.stringify(result.data)}`);
  return { token: result.data.access_token, userId: result.data.user.id, email };
}

async function memberships(session) {
  const result = await request("/rest/v1/rpc/get_my_active_memberships", {
    token: session.token,
    method: "POST",
    body: {}
  });
  assert(result.ok, `memberships failed: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function select(session, table, query) {
  const result = await request(`/rest/v1/${table}?${query}`, { token: session.token });
  assert(result.ok, `${table} select failed: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function insert(session, table, row) {
  return request(`/rest/v1/${table}`, {
    token: session.token,
    method: "POST",
    prefer: "return=representation",
    body: [row]
  });
}

async function patch(session, table, query, values) {
  return request(`/rest/v1/${table}?${query}`, {
    token: session.token,
    method: "PATCH",
    prefer: "return=representation",
    body: values
  });
}

async function remove(session, table, query) {
  return request(`/rest/v1/${table}?${query}`, {
    token: session.token,
    method: "DELETE",
    prefer: "return=representation"
  });
}

async function setMembershipStatus(organizationId, userId, status) {
  const result = await request("/rest/v1/rpc/phase_c_test_set_membership_status", {
    key: serviceKey,
    token: serviceKey,
    method: "POST",
    body: { target_organization: organizationId, target_user: userId, target_status: status }
  });
  assert(result.ok, `admin membership update failed: ${JSON.stringify(result.data)}`);
}

const sessions = Object.fromEntries(await Promise.all(
  Object.entries(emails).map(async ([role, email]) => [role, await login(email)])
));
const orgA = (await memberships(sessions.ownerA))[0]?.organization_id;
const orgB = (await memberships(sessions.ownerB))[0]?.organization_id;
assert(orgA && orgB && orgA !== orgB, "test organizations are missing or equal");

const leadBase = (name, phone, organizationId, assignedTo) => ({
  organization_id: organizationId,
  assigned_to: assignedTo,
  name,
  phone,
  whatsapp: phone,
  origin: "phase-c-test",
  stage: "novo",
  entered_at: new Date().toISOString()
});

let leadA1;
let leadA2;
let leadB;

await test("owner A creates lead assigned to agent A1", async () => {
  const result = await insert(sessions.ownerA, "leads", leadBase(`Phase C A1 ${unique}`, `65001${Date.now()}`.slice(-11), orgA, sessions.agentA1.userId));
  assert(result.ok && result.data?.[0]?.id, JSON.stringify(result.data));
  leadA1 = result.data[0];
});

await test("manager creates lead assigned to agent A2", async () => {
  const result = await insert(sessions.managerA, "leads", leadBase(`Phase C A2 ${unique}`, `65002${Date.now()}`.slice(-11), orgA, sessions.agentA2.userId));
  assert(result.ok && result.data?.[0]?.id, JSON.stringify(result.data));
  leadA2 = result.data[0];
});

await test("owner B creates isolated lead", async () => {
  const result = await insert(sessions.ownerB, "leads", leadBase(`Phase C B ${unique}`, `65003${Date.now()}`.slice(-11), orgB, sessions.ownerB.userId));
  assert(result.ok && result.data?.[0]?.id, JSON.stringify(result.data));
  leadB = result.data[0];
});

await test("owner and manager see all tenant A test leads", async () => {
  const filter = `organization_id=eq.${orgA}&origin=eq.phase-c-test&select=id`;
  const [ownerRows, managerRows] = await Promise.all([select(sessions.ownerA, "leads", filter), select(sessions.managerA, "leads", filter)]);
  assert(ownerRows.some(row => row.id === leadA1.id) && ownerRows.some(row => row.id === leadA2.id), "owner missing tenant leads");
  assert(managerRows.some(row => row.id === leadA1.id) && managerRows.some(row => row.id === leadA2.id), "manager missing tenant leads");
});

await test("agents see only their assigned leads", async () => {
  const filter = `organization_id=eq.${orgA}&origin=eq.phase-c-test&select=id`;
  const [a1, a2] = await Promise.all([select(sessions.agentA1, "leads", filter), select(sessions.agentA2, "leads", filter)]);
  assert(a1.some(row => row.id === leadA1.id) && !a1.some(row => row.id === leadA2.id), "agent A1 isolation failed");
  assert(a2.some(row => row.id === leadA2.id) && !a2.some(row => row.id === leadA1.id), "agent A2 isolation failed");
});

await test("cross-tenant reads and inserts are blocked", async () => {
  const [ownerAOnB, agentA1OnB] = await Promise.all([
    select(sessions.ownerA, "leads", `id=eq.${leadB.id}&select=id`),
    select(sessions.agentA1, "leads", `id=eq.${leadB.id}&select=id`)
  ]);
  assert(ownerAOnB.length === 0 && agentA1OnB.length === 0, "cross-tenant lead became visible");
  const attempted = await insert(sessions.agentA1, "leads", leadBase(`Cross tenant ${unique}`, `65004${Date.now()}`.slice(-11), orgB, sessions.agentA1.userId));
  assert(!attempted.ok, "cross-tenant insert unexpectedly succeeded");
});

await test("agent cannot delete own lead", async () => {
  await remove(sessions.agentA1, "leads", `id=eq.${leadA1.id}`);
  const rows = await select(sessions.ownerA, "leads", `id=eq.${leadA1.id}&select=id`);
  assert(rows.length === 1, "agent deleted a lead");
});

await test("allowed INSERT and UPDATE continue working", async () => {
  const own = await insert(sessions.agentA1, "leads", leadBase(`Agent insert ${unique}`, `65005${Date.now()}`.slice(-11), orgA, sessions.agentA1.userId));
  assert(own.ok && own.data?.[0]?.id, `agent insert failed: ${JSON.stringify(own.data)}`);
  const updated = await patch(sessions.agentA1, "leads", `id=eq.${leadA1.id}`, { stage: "atendimento" });
  assert(updated.ok && updated.data?.[0]?.stage === "atendimento", `agent update failed: ${JSON.stringify(updated.data)}`);
  const managerUpdated = await patch(sessions.managerA, "leads", `id=eq.${leadA2.id}`, { stage: "visita" });
  assert(managerUpdated.ok && managerUpdated.data?.[0]?.stage === "visita", "manager update failed");
});

let noteId;
await test("notes follow parent lead access", async () => {
  const created = await insert(sessions.agentA1, "lead_notes", {
    organization_id: orgA,
    lead_id: leadA1.id,
    author_id: sessions.agentA1.userId,
    content: `Phase C note ${unique}`
  });
  assert(created.ok && created.data?.[0]?.id, `note insert failed: ${JSON.stringify(created.data)}`);
  noteId = created.data[0].id;
  const [visible, hidden] = await Promise.all([
    select(sessions.agentA1, "lead_notes", `id=eq.${noteId}&select=id`),
    select(sessions.agentA2, "lead_notes", `id=eq.${noteId}&select=id`)
  ]);
  assert(visible.length === 1 && hidden.length === 0, "note access does not follow lead");
  const forbidden = await insert(sessions.agentA2, "lead_notes", {
    organization_id: orgA, lead_id: leadA1.id, author_id: sessions.agentA2.userId, content: "forbidden"
  });
  assert(!forbidden.ok, "agent inserted note on inaccessible lead");
});

await test("disabled membership loses access immediately with same JWT", async () => {
  await setMembershipStatus(orgA, sessions.disabledA.userId, "active");
  const created = await insert(sessions.ownerA, "leads", leadBase(`Disabled transition ${unique}`, `65006${Date.now()}`.slice(-11), orgA, sessions.disabledA.userId));
  assert(created.ok && created.data?.[0]?.id, "failed to create disabled-transition lead");
  const before = await select(sessions.disabledA, "leads", `id=eq.${created.data[0].id}&select=id`);
  assert(before.length === 1, "active test member could not see assigned lead");
  await setMembershipStatus(orgA, sessions.disabledA.userId, "disabled");
  const after = await select(sessions.disabledA, "leads", `id=eq.${created.data[0].id}&select=id`);
  assert(after.length === 0, "disabled member retained access with existing JWT");
});

await test("database capture and deduplication remain functional", async () => {
  const phone = `659${String(Date.now()).slice(-8)}`;
  const body = {
    target_organization: orgA,
    target_name: `Phase C Site ${unique}`,
    target_phone: phone,
    target_email: `phase-c-${unique}@example.com`,
    target_property_code: `TEST-${String(Date.now()).slice(-6)}`,
    target_property_title: "Phase C Test Property"
  };
  const first = await request("/rest/v1/rpc/capture_site_lead", { key: serviceKey, token: serviceKey, method: "POST", body });
  const second = await request("/rest/v1/rpc/capture_site_lead", { key: serviceKey, token: serviceKey, method: "POST", body });
  assert(first.ok && first.data?.[0]?.created === true, `first capture failed: ${JSON.stringify(first.data)}`);
  assert(second.ok && second.data?.[0]?.created === false, `dedup failed: ${JSON.stringify(second.data)}`);
  assert(first.data[0].lead_id === second.data[0].lead_id, "dedup returned a different lead");
  const notes = await select(sessions.ownerA, "lead_notes", `lead_id=eq.${first.data[0].lead_id}&select=id`);
  assert(notes.length >= 1, "deduplication note was not created");
});

if (process.env.PHASE_C_SITE_LEAD_URL) {
  await test("public Edge Function capture remains functional", async () => {
    const origin = process.env.PHASE_C_SITE_ORIGIN;
    const propertyCode = process.env.PHASE_C_PROPERTY_CODE;
    assert(origin && propertyCode, "set PHASE_C_SITE_ORIGIN and PHASE_C_PROPERTY_CODE");
    const response = await fetch(process.env.PHASE_C_SITE_LEAD_URL, {
      method: "POST",
      headers: { apikey: anonKey, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Phase C Edge ${unique}`,
        phone: `659${String(Date.now() + 1).slice(-8)}`,
        email: `phase-c-edge-${unique}@example.com`,
        propertyCode
      })
    });
    const data = await response.json();
    assert(response.ok && data.ok === true, `Edge capture failed: ${response.status} ${JSON.stringify(data)}`);
  });
} else {
  console.log("SKIP public Edge Function test (PHASE_C_SITE_LEAD_URL not set)");
}

console.log(`\n${passed} tests passed; ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

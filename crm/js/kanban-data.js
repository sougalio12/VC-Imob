const KANBAN_FIELDS = "id,organization_id,assigned_to,responsible_name,name,phone,whatsapp,email,origin,property_code,property_title,desired_region,budget,notes,stage,next_follow_up,visit_date,created_at,updated_at";
let demoKanbanActivity = [];
async function getKanbanAccess() {
  if (isDemoMode()) return { role: "owner", status: "active" };
  try { return await callCrmRpc("kanban_access", { target_organization: await getActiveOrganizationId() }); }
  catch { return null; } // Fail closed until the F.1 migration is deployed.
}
async function getKanbanLeads() {
  if (isDemoMode()) return getLeads();
  const organization = await getActiveOrganizationId();
  const leads = []; let cursor = "";
  // Keyset paging avoids PostgREST's silent default row cap and offset drift.
  while (true) {
    const page = await supabaseRequest(`/rest/v1/leads?organization_id=eq.${encodeURIComponent(organization)}&select=${KANBAN_FIELDS}&order=id.asc&limit=500${cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(page)) throw new Error("Resposta inválida ao carregar o funil.");
    if (!page.length) break;
    const next = page.at(-1).id;
    if (next === cursor) throw new Error("Não foi possível concluir a paginação.");
    leads.push(...page); cursor = next;
    // Request until empty: a server may impose a cap below 500.
  }
  return leads.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a.id.localeCompare(b.id));
}
async function getKanbanMembers() {
  return isDemoMode() ? [{ user_id: "demo-owner", full_name: "Valdiney Capistrano", status: "active", role: "owner" }, { user_id: "demo-agent", full_name: "Corretor demonstração", status: "active", role: "agent" }] : getTeamMembers();
}
async function moveKanbanLead(lead, stage) {
  if (!CRM_STAGES.some(([value]) => value === stage)) throw new Error("Etapa inválida.");
  if (isDemoMode()) {
    const saved = await updateLead(lead.id, { stage });
    demoKanbanActivity.unshift({ entity_id: lead.id, action: "lead_stage_changed", metadata: { previous_stage: lead.stage, new_stage: stage }, created_at: new Date().toISOString() }); return saved;
  }
  if (!lead.updated_at) throw new Error("Atualize o funil antes de mover este lead.");
  const organization = await getActiveOrganizationId();
  const rows = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}&organization_id=eq.${encodeURIComponent(organization)}&updated_at=eq.${encodeURIComponent(lead.updated_at)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ stage })
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Conflito de edição ou acesso alterado. Atualize o funil.");
  return rows[0];
}
async function assignKanbanLead(id, user) {
  if (!isDemoMode()) { const result = await assignLead(id, user); return Array.isArray(result) ? result[0] : result; }
  const member = (await getKanbanMembers()).find(item => item.user_id === user && item.status === "active");
  if (user && !member) throw new Error("Membro indisponível.");
  const previous = demoLeads.find(item => item.id === id); if (!previous) throw new Error("Lead indisponível.");
  const old = previous.assigned_to || null; previous.assigned_to = user || null; previous.updated_at = new Date().toISOString();
  demoKanbanActivity.unshift({ entity_id: id, action: "lead_transferred", metadata: { previous_assigned_to: old, new_assigned_to: user || null }, created_at: new Date().toISOString() }); return { ...previous };
}
async function getKanbanActivity(id) {
  if (isDemoMode()) return demoKanbanActivity.filter(event => event.entity_id === id);
  return callCrmRpc("list_lead_activity", { target_lead: id, result_limit: 100 });
}

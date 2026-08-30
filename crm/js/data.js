const CRM_STAGES = [
  ["novo", "Novo"],
  ["atendimento", "Em atendimento"],
  ["visita", "Visita"],
  ["negociacao", "Negociação"],
  ["fechado", "Fechado"],
  ["perdido", "Perdido"]
];

let crmProperties = [];
let crmOrganizationContext = null;

async function loadProperties() {
  if (crmProperties.length) return crmProperties;

  const response = await fetch(CRM_CONFIG.propertiesPath, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar os imóveis do site.");

  const data = await response.json();
  crmProperties = Array.isArray(data) ? data : [];
  return crmProperties;
}

async function loadCrmProfile() {
  if (isDemoMode()) return { full_name: "Valdiney Capistrano", organization_id: "demo" };
  return (await initializeOrganizationContext()).profile;
}

async function initializeOrganizationContext() {
  if (isDemoMode()) {
    crmOrganizationContext = {
      profile: { full_name: "Valdiney Capistrano", organization_id: "demo" },
      memberships: [{ organization_id: "demo", organization_name: "Modo demonstração", role: "owner", status: "active" }],
      activeOrganizationId: "demo",
      activeMembership: { organization_id: "demo", organization_name: "Modo demonstração", role: "owner", status: "active" }
    };
    return crmOrganizationContext;
  }

  if (crmOrganizationContext) return crmOrganizationContext;

  const [profile, memberships] = await Promise.all([getCurrentProfile(), getMyActiveMemberships()]);
  if (!profile) throw new Error("Perfil administrativo não encontrado.");
  if (!memberships.length) throw new Error("Sua conta não possui uma organização ativa. Entre em contato com o administrador.");

  const legacyMatch = memberships.find(membership => membership.organization_id === profile.organization_id);
  if (!legacyMatch && memberships.length > 1) {
    throw new Error("Sua conta possui mais de uma organização ativa. A seleção de organização ainda não está disponível.");
  }

  const activeMembership = legacyMatch || memberships[0];
  crmOrganizationContext = {
    profile,
    memberships,
    activeOrganizationId: activeMembership.organization_id,
    activeMembership
  };
  return crmOrganizationContext;
}

async function getActiveOrganization() {
  return initializeOrganizationContext();
}

async function getActiveOrganizationId() {
  return (await initializeOrganizationContext()).activeOrganizationId;
}

async function getActiveMembership() {
  return (await initializeOrganizationContext()).activeMembership;
}

async function callCrmRpc(name, body) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body || {}) });
}

async function getTeamMembers() { return callCrmRpc("list_team_members", { target_organization: await getActiveOrganizationId() }); }
async function getPendingInvitations() { return callCrmRpc("list_pending_invitations", { target_organization: await getActiveOrganizationId() }); }
async function inviteTeamMember(email, role) { return callCrmRpc("invite_member", { target_organization: await getActiveOrganizationId(), target_email: email, target_role: role }); }
async function revokeTeamInvitation(id) { return callCrmRpc("revoke_invitation", { target_organization: await getActiveOrganizationId(), target_invitation: id }); }
async function changeTeamMemberRole(userId, role) { return callCrmRpc("change_member_role", { target_organization: await getActiveOrganizationId(), target_user: userId, target_role: role }); }
async function setTeamMemberEnabled(userId, enabled) { return callCrmRpc(enabled ? "enable_member" : "disable_member", { target_organization: await getActiveOrganizationId(), target_user: userId }); }
async function removeTeamMember(userId) { return callCrmRpc("remove_member", { target_organization: await getActiveOrganizationId(), target_user: userId }); }
async function assignLead(leadId, userId) { return callCrmRpc("assign_lead", { target_organization: await getActiveOrganizationId(), target_lead: leadId, target_user: userId || null }); }
async function acceptTeamInvitation(token) { return callCrmRpc("accept_invitation", { invitation_token: token }); }
async function getBillingOverview() {
  if (isDemoMode()) return { subscription: { plan_code: "equipe", plan_name: "EQUIPE", status: "active", is_entitled: true }, entitlements: [{ entitlement_key: "team.members", enabled: true, limit_value: 30, used_value: 4 }], plans: [{ plan_code: "start", plan_name: "START", monthly_price_cents: 3990, currency: "BRL", trial_days: 7, team_member_limit: 1 }, { plan_code: "pro", plan_name: "PRO", monthly_price_cents: 7990, currency: "BRL", trial_days: 14, team_member_limit: 1 }, { plan_code: "equipe", plan_name: "EQUIPE", monthly_price_cents: 14990, currency: "BRL", trial_days: 14, team_member_limit: 30 }] };
  const organization = await getActiveOrganizationId();
  const [subscriptions, entitlements, plans] = await Promise.all([callCrmRpc("get_my_subscription", { target_organization: organization }), callCrmRpc("get_my_entitlements", { target_organization: organization }), callCrmRpc("list_available_plans", { target_organization: organization })]);
  return { subscription: subscriptions?.[0] || null, entitlements: entitlements || [], plans: plans || [] };
}

function resetOrganizationContext() {
  crmOrganizationContext = null;
  clearOrganizationContext();
}

async function getLeads() {
  if (isDemoMode()) return demoLeads.map(item => ({ ...item }));
  const organizationId = await getActiveOrganizationId();
  const data = await supabaseRequest(`/rest/v1/leads?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=created_at.desc`);
  return Array.isArray(data) ? data : [];
}

async function createLead(payload) {
  validateLead(payload);

  if (isDemoMode()) {
    const lead = { id: `demo-${crypto.randomUUID()}`, ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), entered_at: payload.entered_at || new Date().toISOString() };
    demoLeads.unshift(lead);
    return lead;
  }

  const organizationId = await getActiveOrganizationId();
  const result = await supabaseRequest("/rest/v1/leads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ ...payload, organization_id: organizationId, assigned_to: getStoredSession()?.user?.id }])
  });
  return result?.[0];
}

async function updateLead(id, payload, expectedUpdatedAt) {
  validateLead(payload, true);

  if (isDemoMode()) {
    const index = demoLeads.findIndex(item => item.id === id);
    if (index < 0) throw new Error("Lead não encontrado.");
    demoLeads[index] = { ...demoLeads[index], ...payload, updated_at: new Date().toISOString() };
    return demoLeads[index];
  }

  const organizationId = await getActiveOrganizationId();
  const result = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}${expectedUpdatedAt ? `&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}` : ""}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
  if (!Array.isArray(result) || result.length !== 1) throw new Error("O lead foi alterado ou seu acesso mudou. Atualize antes de tentar novamente.");
  return result[0];
}

async function deleteLead(id) {
  if (isDemoMode()) {
    demoLeads = demoLeads.filter(item => item.id !== id);
    return;
  }
  const organizationId = await getActiveOrganizationId();
  await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "DELETE" });
}

async function getLeadNotes(leadId) {
  if (isDemoMode()) {
    return demoLeadNotes
      .filter(note => note.lead_id === leadId)
      .sort((first, second) => new Date(second.created_at) - new Date(first.created_at))
      .map(note => ({ ...note }));
  }

  const organizationId = await getActiveOrganizationId();
  const data = await supabaseRequest(
    `/rest/v1/lead_notes?lead_id=eq.${encodeURIComponent(leadId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=created_at.desc`
  );
  return Array.isArray(data) ? data : [];
}

async function saveLeadNote(leadId, content) {
  const note = String(content || "").trim();
  if (!note) throw new Error("Escreva uma observação antes de salvar.");

  if (isDemoMode()) {
    const created = { id: `note-${crypto.randomUUID()}`, lead_id: leadId, content: note, created_at: new Date().toISOString() };
    demoLeadNotes.unshift(created);
    return created;
  }

  const organizationId = await getActiveOrganizationId();
  return supabaseRequest("/rest/v1/lead_notes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ lead_id: leadId, organization_id: organizationId, author_id: (await getValidSession())?.user?.id, content: note }])
  });
}

function validateLead(payload, partial = false) {
  if (!partial && !String(payload.name || "").trim()) throw new Error("Informe o nome do lead.");
  if (!partial && !String(payload.phone || payload.whatsapp || "").trim()) throw new Error("Informe um telefone ou WhatsApp.");
  if (payload.email && !/^\S+@\S+\.\S+$/.test(payload.email)) throw new Error("Informe um e-mail válido.");
  if (!CRM_STAGES.some(([value]) => value === payload.stage)) throw new Error("Etapa do funil inválida.");
}

function findPropertyByCode(code) {
  return crmProperties.find(property => property.codigo === code) || null;
}

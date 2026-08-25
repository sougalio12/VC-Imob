const CRM_STAGES = [
  ["novo", "Novo"],
  ["atendimento", "Em atendimento"],
  ["visita", "Visita"],
  ["negociacao", "Negociação"],
  ["fechado", "Fechado"],
  ["perdido", "Perdido"]
];

let crmProperties = [];
let crmProfile = null;

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
  if (crmProfile) return crmProfile;
  crmProfile = await getCurrentProfile();
  return crmProfile;
}

async function getLeads() {
  if (isDemoMode()) return demoLeads.map(item => ({ ...item }));
  const data = await supabaseRequest("/rest/v1/leads?select=*&order=created_at.desc");
  return Array.isArray(data) ? data : [];
}

async function createLead(payload) {
  validateLead(payload);

  if (isDemoMode()) {
    const lead = { id: `demo-${crypto.randomUUID()}`, ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), entered_at: payload.entered_at || new Date().toISOString() };
    demoLeads.unshift(lead);
    return lead;
  }

  const profile = await loadCrmProfile();
  if (!profile?.organization_id) throw new Error("Perfil administrativo não encontrado.");
  const result = await supabaseRequest("/rest/v1/leads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ ...payload, organization_id: profile.organization_id, assigned_to: getStoredSession()?.user?.id }])
  });
  return result?.[0];
}

async function updateLead(id, payload) {
  validateLead(payload, true);

  if (isDemoMode()) {
    const index = demoLeads.findIndex(item => item.id === id);
    if (index < 0) throw new Error("Lead não encontrado.");
    demoLeads[index] = { ...demoLeads[index], ...payload, updated_at: new Date().toISOString() };
    return demoLeads[index];
  }

  const result = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
  return result?.[0];
}

async function deleteLead(id) {
  if (isDemoMode()) {
    demoLeads = demoLeads.filter(item => item.id !== id);
    return;
  }
  await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function saveLeadNote(leadId, content) {
  const note = String(content || "").trim();
  if (!note) throw new Error("Escreva uma observação antes de salvar.");

  if (isDemoMode()) return { id: `note-${crypto.randomUUID()}`, lead_id: leadId, content: note, created_at: new Date().toISOString() };

  const profile = await loadCrmProfile();
  return supabaseRequest("/rest/v1/lead_notes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ lead_id: leadId, organization_id: profile.organization_id, author_id: (await getValidSession())?.user?.id, content: note }])
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

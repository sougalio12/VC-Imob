let demoActivities = [];
let demoInterests = [];
let demoAutomationSettings = { stale_lead_days: 7, follow_up_reminder_hours: 24, alert_unassigned: true };
let phaseFFeatureCache = null;

async function getPhaseFFeatures() {
  if (isDemoMode()) return { matching: true, multipleInterests: true, automation: true, advancedReports: true };
  if (phaseFFeatureCache) return phaseFFeatureCache;
  const organization = await getActiveOrganizationId();
  const check = key => callCrmRpc("can_use_entitlement", { target_organization: organization, target_key: key }).then(Boolean).catch(() => false);
  phaseFFeatureCache = Promise.all([
    check("crm.matching"),
    check("crm.multiple_interests"),
    check("crm.automation"),
    check("crm.advanced_reports")
  ]).then(([matching, multipleInterests, automation, advancedReports]) => ({ matching, multipleInterests, automation, advancedReports }));
  return phaseFFeatureCache;
}

async function getCrmActivities(leadId) {
  if (isDemoMode()) return demoActivities.filter(item => !leadId || item.lead_id === leadId).map(item => ({ ...item }));
  const org = await getActiveOrganizationId();
  return supabaseRequest(`/rest/v1/appointments?organization_id=eq.${encodeURIComponent(org)}${leadId ? `&lead_id=eq.${encodeURIComponent(leadId)}` : ""}&select=*&order=scheduled_at.asc`);
}
async function saveCrmActivity(input) {
  if (isDemoMode()) {
    const now = new Date().toISOString();
    const item = { id: input.id || `activity-${crypto.randomUUID()}`, organization_id: "demo", lead_id: input.lead_id, assigned_to: input.assigned_to || "demo-owner", kind: input.kind, title: input.title.trim(), scheduled_at: input.scheduled_at, priority: Number(input.priority), status: "agendado", notes: input.notes?.trim() || null, completed_at: null, canceled_at: null, created_at: now, updated_at: now };
    const index = demoActivities.findIndex(current => current.id === item.id);
    if (index < 0) demoActivities.push(item); else demoActivities[index] = { ...demoActivities[index], ...item };
    return { ...item };
  }
  return callCrmRpc("save_crm_activity", { target_organization: await getActiveOrganizationId(), target_activity: input.id || null, target_lead: input.lead_id, target_assignee: input.assigned_to || null, target_kind: input.kind, target_title: input.title, target_scheduled_at: input.scheduled_at, target_priority: Number(input.priority), target_notes: input.notes || null });
}
async function setCrmActivityStatus(id, status) {
  if (isDemoMode()) {
    const item = demoActivities.find(current => current.id === id); if (!item) throw new Error("Atividade não encontrada.");
    item.status = status; item.completed_at = status === "concluido" ? new Date().toISOString() : null; item.canceled_at = status === "cancelado" ? new Date().toISOString() : null; return { ...item };
  }
  return callCrmRpc("set_crm_activity_status", { target_organization: await getActiveOrganizationId(), target_activity: id, target_status: status });
}

async function getLeadInterestsF(leadId) {
  if (isDemoMode()) return demoInterests.filter(item => !leadId || item.lead_id === leadId).map(item => ({ ...item }));
  const org = await getActiveOrganizationId();
  return supabaseRequest(`/rest/v1/lead_interests?organization_id=eq.${encodeURIComponent(org)}${leadId ? `&lead_id=eq.${encodeURIComponent(leadId)}` : ""}&select=*&order=created_at.desc`);
}
async function addLeadInterestF(leadId, property) {
  if (isDemoMode()) { const item = { id: `interest-${crypto.randomUUID()}`, lead_id: leadId, property_code: property.codigo, property_title: property.titulo, source: "crm", created_at: new Date().toISOString() }; demoInterests.unshift(item); return item; }
  return supabaseRequest("/rest/v1/lead_interests", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ organization_id: await getActiveOrganizationId(), lead_id: leadId, property_code: property.codigo, property_title: property.titulo || "", source: "crm" }]) });
}
async function removeLeadInterestF(id) {
  if (isDemoMode()) { demoInterests = demoInterests.filter(item => item.id !== id); return; }
  const org = await getActiveOrganizationId();
  await supabaseRequest(`/rest/v1/lead_interests?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}`, { method: "DELETE" });
}

async function getAutomationSettings() {
  if (isDemoMode()) return { ...demoAutomationSettings };
  const org = await getActiveOrganizationId();
  const rows = await supabaseRequest(`/rest/v1/crm_automation_settings?organization_id=eq.${encodeURIComponent(org)}&select=*`);
  return rows?.[0] || { stale_lead_days: 7, follow_up_reminder_hours: 24, alert_unassigned: true };
}
async function saveAutomationSettings(settings) {
  if (isDemoMode()) { demoAutomationSettings = { ...demoAutomationSettings, ...settings }; return { ...demoAutomationSettings }; }
  const org = await getActiveOrganizationId();
  const rows = await supabaseRequest(`/rest/v1/crm_automation_settings?organization_id=eq.${encodeURIComponent(org)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(settings) });
  if (!rows?.length) throw new Error("Configuração não alterada."); return rows[0];
}

function parsePropertyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value || "").replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (!normalized || !/[0-9]/.test(normalized)) return null;
  const number = Number(normalized); return Number.isFinite(number) ? number : null;
}
function leadPreference(lead) {
  return { type: normalizeText(lead.preference_property_type), city: normalizeText(lead.preference_city), region: normalizeText(lead.desired_region), minPrice: parsePropertyNumber(lead.preference_min_price), maxPrice: parsePropertyNumber(lead.preference_max_price), bedrooms: parsePropertyNumber(lead.preference_min_bedrooms), area: parsePropertyNumber(lead.preference_min_area) };
}
function matchProperties(lead, properties) {
  const criteria = leadPreference(lead);
  const active = Object.values(criteria).some(value => value !== null && value !== ""); if (!active) return [];
  return properties.filter(property => property.ativo !== false).map(property => {
    const facts = { type: normalizeText(property.tipo), city: normalizeText(property.cidade), region: normalizeText(property.bairro), price: parsePropertyNumber(property.preco), bedrooms: parsePropertyNumber(property.quartos), area: parsePropertyNumber(property.areaConstruida ?? property.area) };
    if ((criteria.type && facts.type !== criteria.type) || (criteria.city && facts.city !== criteria.city) || (criteria.maxPrice != null && facts.price != null && facts.price > criteria.maxPrice) || (criteria.bedrooms != null && facts.bedrooms != null && facts.bedrooms < criteria.bedrooms) || (criteria.area != null && facts.area != null && facts.area < criteria.area)) return null;
    const checks = [[criteria.type, facts.type === criteria.type, 25, "tipo"], [criteria.city, facts.city === criteria.city, 20, "cidade"], [criteria.region, facts.region.includes(criteria.region), 15, "região"], [criteria.maxPrice != null, facts.price != null && facts.price <= criteria.maxPrice && (criteria.minPrice == null || facts.price >= criteria.minPrice), 25, "preço"], [criteria.bedrooms != null, facts.bedrooms != null && facts.bedrooms >= criteria.bedrooms, 10, "quartos"], [criteria.area != null, facts.area != null && facts.area >= criteria.area, 5, "área"]].filter(([enabled]) => enabled);
    const total = checks.reduce((sum, item) => sum + item[2], 0); const hit = checks.filter(item => item[1]);
    return { property, compatibility: total ? Math.round(hit.reduce((sum, item) => sum + item[2], 0) * 100 / total) : 0, reasons: hit.map(item => item[3]) };
  }).filter(Boolean).sort((a, b) => b.compatibility - a.compatibility || String(a.property.codigo).localeCompare(String(b.property.codigo)));
}

function scoreLead(lead, activities = [], interests = [], now = new Date()) {
  if (["fechado", "perdido"].includes(lead.stage)) return { score: 0, label: "Encerrado", reasons: ["negociação encerrada"] };
  let score = 10; const reasons = []; const created = new Date(lead.created_at); const updated = new Date(lead.updated_at);
  if (now - created <= 7 * 86400000) { score += 20; reasons.push("lead recente"); }
  if (interests.length) { score += 20; reasons.push("interesse em imóvel"); }
  const open = activities.filter(item => item.status === "agendado"), overdue = open.filter(item => new Date(item.scheduled_at) < now);
  if (overdue.length) { score += 30; reasons.push("acompanhamento vencido"); }
  if (open.some(item => new Date(item.scheduled_at) >= now)) { score += 10; reasons.push("próxima atividade agendada"); }
  if (activities.some(item => item.kind === "visita")) { score += 15; reasons.push("visita registrada"); }
  if (now - updated > 14 * 86400000) { score -= 20; reasons.push("sem atualização há mais de 14 dias"); }
  score = Math.max(0, Math.min(100, score));
  return { score, label: score >= 60 ? "Quente" : score >= 30 ? "Morno" : "Frio", reasons: reasons.length ? reasons : ["poucos sinais registrados"] };
}
function buildInternalAlerts(leads, activities, settings, now = new Date()) {
  const staleMs = Number(settings.stale_lead_days || 7) * 86400000, reminderMs = Number(settings.follow_up_reminder_hours || 24) * 3600000;
  const alerts = [];
  leads.filter(lead => !["fechado", "perdido"].includes(lead.stage)).forEach(lead => {
    const own = activities.filter(item => item.lead_id === lead.id && item.status === "agendado");
    own.filter(item => new Date(item.scheduled_at) < now).forEach(item => alerts.push({ type: "overdue", level: "high", lead, activity: item, text: `Acompanhamento vencido: ${item.title}` }));
    own.filter(item => { const at = new Date(item.scheduled_at); return at >= now && at - now <= reminderMs; }).forEach(item => alerts.push({ type: "due", level: "medium", lead, activity: item, text: `Próximo acompanhamento: ${item.title}` }));
    if (settings.alert_unassigned && !lead.assigned_to) alerts.push({ type: "unassigned", level: "medium", lead, text: "Lead novo sem responsável" });
    if (!own.length && now - new Date(lead.updated_at) >= staleMs) alerts.push({ type: "stale", level: "low", lead, text: `Lead sem atividade há ${settings.stale_lead_days} dias` });
  });
  return alerts.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.level] - ({ high: 0, medium: 1, low: 2 }[b.level])));
}

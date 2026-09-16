const VC_OPERATION_WIDGETS = ["my_day","opportunities","agenda","proposals","matching","team","site_status","results"];

function parseDelimitedCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = (source.split(/\r?\n/, 1)[0].match(/;/g) || []).length >= (source.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' && quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift().map(value => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return { headers, rows: rows.map((values, index) => ({ rowNumber: index + 2, values: Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])) })) };
}

function validateLeadImport(parsed, mapping = {}) {
  const seen = new Set();
  return parsed.rows.map(row => {
    const get = field => row.values[mapping[field] || field] || "";
    const phone = typeof normalizePhone === "function" ? normalizePhone(get("phone")) : get("phone").replace(/\D/g, "");
    const email = get("email").trim().toLowerCase();
    const errors = [];
    if (get("name").trim().length < 2) errors.push("Nome obrigatório");
    if (!phone) errors.push("Telefone obrigatório para o CRM");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido");
    if (phone && (phone.length < 10 || phone.length > 13)) errors.push("Telefone inválido");
    const key = email || phone;
    if (key && seen.has(key)) errors.push("Duplicado no arquivo"); else if (key) seen.add(key);
    const parsedBudget = typeof parseBrlNumber === "function" ? parseBrlNumber(get("budget")) : Number(get("budget"));
    return { rowNumber: row.rowNumber, valid: !errors.length, errors, record: { name: get("name").trim(), phone: phone || null, email: email || null, origin: get("origin").trim() || "importacao", budget: Number.isFinite(parsedBudget) ? String(parsedBudget) : null, notes: get("notes").trim() || null } };
  });
}

function calculateCampaignRoi({ cost, leads = 0, proposals = 0, sales = 0, revenue = 0 }) {
  const numericCost = Number(cost), numericRevenue = Number(revenue);
  return {
    leads, proposals, sales, cost: Number.isFinite(numericCost) ? numericCost : null, revenue: Number.isFinite(numericRevenue) ? numericRevenue : 0,
    cpl: numericCost > 0 && leads > 0 ? numericCost / leads : null,
    cac: numericCost > 0 && sales > 0 ? numericCost / sales : null,
    roi: numericCost > 0 ? (numericRevenue - numericCost) * 100 / numericCost : null
  };
}

function simulateFinancing({ price, downPayment, annualRate, months }) {
  const principal = Number(price) - Number(downPayment || 0), periods = Math.trunc(Number(months)), monthlyRate = Number(annualRate) / 1200;
  if (!(principal > 0) || !(periods > 0) || !(Number(annualRate) >= 0)) throw new Error("Informe preço, entrada, prazo e taxa válidos.");
  const payment = monthlyRate === 0 ? principal / periods : principal * monthlyRate * Math.pow(1 + monthlyRate, periods) / (Math.pow(1 + monthlyRate, periods) - 1);
  return { principal, payment, total: payment * periods, disclaimer: "Estimativa informativa; não é proposta bancária." };
}

function compareProperties(properties = []) {
  return properties.slice(0, 4).map(property => {
    const area = Number(property.total_area ?? property.areaTotal ?? 0), price = Number(property.price ?? property.preco ?? 0);
    return { id: property.id || property.codigo, code: property.code || property.codigo, title: property.title || property.titulo, price: price || null, area: area || null, pricePerSquareMeter: price > 0 && area > 0 ? price / area : null, bedrooms: property.bedrooms ?? property.quartos ?? null, suites: property.suites ?? null, bathrooms: property.bathrooms ?? property.banheiros ?? null, parking: property.parking_spaces ?? property.vagas ?? null, neighborhood: property.neighborhood || property.bairro || null, features: property.features || property.caracteristicas || [] };
  });
}

function buildTeamOperations({ members = [], leads = [], activities = [], proposals = [] }) {
  return members.map(member => {
    const memberLeads = leads.filter(lead => lead.assigned_to === member.user_id), ids = new Set(memberLeads.map(lead => lead.id));
    const memberActivities = activities.filter(item => item.assigned_to === member.user_id || ids.has(item.lead_id));
    const memberProposals = proposals.filter(item => item.assigned_to === member.user_id || ids.has(item.lead_id));
    const accepted = memberProposals.filter(item => item.status === "accepted");
    return { ...member, activeLeads: memberLeads.filter(item => !["fechado","perdido"].includes(item.stage)).length, overdue: memberActivities.filter(item => item.status === "agendado" && new Date(item.scheduled_at) < new Date()).length, visits: memberActivities.filter(item => item.kind === "visita" && item.status !== "cancelado").length, proposals: memberProposals.length, sales: accepted.length, vgv: accepted.reduce((sum,item) => sum + Number(item.final_price || item.proposed_price || 0),0), commission: accepted.reduce((sum,item) => sum + Number(item.commission_expected || 0),0) };
  });
}

async function loadOperationsData(table, columns = "*") {
  const membership = await getActiveMembership();
  const response = await supabaseRequest(`/rest/v1/${table}?organization_id=eq.${encodeURIComponent(membership.organization_id)}&select=${encodeURIComponent(columns)}`);
  return Array.isArray(response) ? response : (response?.data || []);
}

async function saveDashboardPreferences(visible, order) {
  const membership = await getActiveMembership();
  return callCrmRpc("save_dashboard_preferences", { target_organization: membership.organization_id, target_visible: visible.filter(value => VC_OPERATION_WIDGETS.includes(value)), target_order: order.filter(value => VC_OPERATION_WIDGETS.includes(value)) });
}

async function configureLeadDistribution(mode, enabled, rules = {}) {
  const membership = await getActiveMembership();
  return callCrmRpc("configure_lead_distribution", { target_organization: membership.organization_id, target_mode: mode, target_enabled: Boolean(enabled), target_rules: rules });
}

async function assignLeadByConfiguredRule(leadId) { return callCrmRpc("assign_lead_by_rule", { target_lead: leadId }); }

async function updateOrganizationBranding(payload) {
  const membership = await getActiveMembership();
  return callCrmRpc("update_organization_branding", { target_organization: membership.organization_id, payload });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value), digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,"0")).join("");
}

async function createIntegrationWebhook({ name, endpointUrl, events, secret }) {
  if (!/^https:\/\//i.test(endpointUrl)) throw new Error("O webhook deve usar HTTPS.");
  if (String(secret).length < 32) throw new Error("Use um segredo com pelo menos 32 caracteres.");
  const membership = await getActiveMembership(), secretHash = await sha256Hex(secret);
  return supabaseRequest("/rest/v1/integration_webhooks", { method:"POST", headers:{ Prefer:"return=representation" }, body:JSON.stringify({ organization_id:membership.organization_id,name,endpoint_url:endpointUrl,events,secret_hash:secretHash,created_by:getStoredSession()?.user?.id || null }) });
}

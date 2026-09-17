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

function documentLogoBytes(value) {
  const hex=String(value||"").replace(/^\\x/,"");
  if(!hex||hex.length%2)return new Uint8Array();
  const bytes=new Uint8Array(hex.length/2);for(let index=0;index<bytes.length;index+=1)bytes[index]=Number.parseInt(hex.slice(index*2,index*2+2),16);return bytes;
}

function documentLogoDataUrl(identity) {
  const bytes=documentLogoBytes(identity?.logo_bytes);if(!bytes.length||!identity?.logo_mime_type)return null;
  let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return `data:${identity.logo_mime_type};base64,${btoa(binary)}`;
}

async function decodeDocumentLogoDimensions(file) {
  if(typeof createImageBitmap==="function"){const bitmap=await createImageBitmap(file);try{return{width:bitmap.width,height:bitmap.height};}finally{bitmap.close();}}
  const url=URL.createObjectURL(file);try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error("O arquivo não contém uma imagem válida."));image.src=url;});}finally{URL.revokeObjectURL(url);}
}

async function validateDocumentLogoFile(file) {
  const allowed={"image/jpeg":["jpg","jpeg"],"image/png":["png"],"image/webp":["webp"]},extension=String(file?.name||"").split(".").pop().toLowerCase();
  if(!file||!allowed[file.type]?.includes(extension)||file.size<64||file.size>3*1024*1024)throw new Error("Use uma imagem JPG, PNG ou WebP válida de até 3 MB.");
  const bytes=new Uint8Array(await file.arrayBuffer()),jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,png=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value),webp=String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
  if((file.type==="image/jpeg"&&!jpeg)||(file.type==="image/png"&&!png)||(file.type==="image/webp"&&!webp))throw new Error("O conteúdo do arquivo não corresponde ao formato informado.");
  const dimensions=await decodeDocumentLogoDimensions(file);if(dimensions.width<64||dimensions.height<64||dimensions.width>4096||dimensions.height>4096)throw new Error("A logo deve ter entre 64 e 4096 pixels em cada dimensão.");
  return{bytes,...dimensions,mime:file.type};
}

function documentLogoBase64(bytes) { let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary); }

async function getCurrentDocumentIdentity() {
  const membership=await getActiveMembership(),organizations=await supabaseRequest(`/rest/v1/organizations?id=eq.${encodeURIComponent(membership.organization_id)}&select=id,name,trade_name,public_phone,public_whatsapp,creci,commercial_signature,current_document_identity_id`),organization=organizations[0];
  if(!organization?.current_document_identity_id)return{organization,identity:null};
  const identities=await supabaseRequest(`/rest/v1/organization_document_identities?id=eq.${encodeURIComponent(organization.current_document_identity_id)}&organization_id=eq.${encodeURIComponent(membership.organization_id)}&select=id,version_no,logo_bytes,logo_mime_type,logo_width,logo_height,logo_sha256,created_at`);
  return{organization,identity:identities[0]||null};
}

async function saveDocumentIdentityLogo(file) {
  const validated=await validateDocumentLogoFile(file),membership=await getActiveMembership();
  return callCrmRpc("set_organization_document_identity",{target_organization:membership.organization_id,target_logo_base64:documentLogoBase64(validated.bytes),target_logo_mime_type:validated.mime,target_logo_width:validated.width,target_logo_height:validated.height,target_remove:false});
}

async function removeDocumentIdentityLogo() {
  const membership=await getActiveMembership();return callCrmRpc("set_organization_document_identity",{target_organization:membership.organization_id,target_logo_base64:null,target_logo_mime_type:null,target_logo_width:null,target_logo_height:null,target_remove:true});
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

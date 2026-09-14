function propertyRowToLegacy(row, media = []) {
  const images = media.slice().sort((a, b) => a.sort_order - b.sort_order);
  return { id: row.id, codigo: row.code, ativo: row.status !== "inactive", publicado: row.is_published, destaque: row.featured,
    titulo: row.title, slug: row.slug, finalidade: row.purpose, tipo: row.property_type, descricao: row.description, preco: row.price,
    cidade: row.city, estado: row.state, bairro: row.neighborhood, enderecoExibir: row.public_address, areaTotal: row.total_area,
    unidadeAreaTotal: row.total_area_unit, areaConstruida: row.built_area, quartos: row.bedrooms, suites: row.suites,
    banheiros: row.bathrooms, vagas: row.parking_spaces, caracteristicas: row.features || [], status: row.status, video: row.video_url || "",
    dataPublicacao: row.publication_date || "", corretor: { nome: row.broker_name, creci: row.broker_creci }, imagens: images.map(item => item.storage_path),
    imagensAlt: images.map(item => item.alt_text || ""), legendasImagens: images.map(item => item.caption || ""), _row: row, _media: images };
}
let demoProposals=[];

async function loadManagedProperties() {
  if (isDemoMode()) return [];
  const org = await getActiveOrganizationId();
  const rows = await supabaseRequest(`/rest/v1/properties?organization_id=eq.${encodeURIComponent(org)}&select=*&order=updated_at.desc`);
  if (!rows.length) return [];
  const media = await supabaseRequest(`/rest/v1/property_media?organization_id=eq.${encodeURIComponent(org)}&select=*&order=sort_order.asc`);
  return rows.map(row => propertyRowToLegacy(row, media.filter(item => item.property_id === row.id)));
}

async function saveManagedProperty(values, existing, mediaItems = []) {
  const org = await getActiveOrganizationId();
  const payload = { code: values.code.trim().toUpperCase(), title: values.title.trim(), slug: slugify(values.slug || values.title),
    purpose: values.purpose, property_type: cleanValue(values.property_type), description: cleanValue(values.description), price: numericValue(values.price),
    city: cleanValue(values.city), state: cleanValue(values.state)?.toUpperCase(), neighborhood: cleanValue(values.neighborhood), public_address: cleanValue(values.public_address),
    total_area: numericValue(values.total_area), total_area_unit: cleanValue(values.total_area_unit) || "m²", built_area: numericValue(values.built_area),
    bedrooms: integerValue(values.bedrooms), suites: integerValue(values.suites), bathrooms: integerValue(values.bathrooms), parking_spaces: integerValue(values.parking_spaces),
    features: splitList(values.features), status: values.status, is_published: Boolean(values.is_published), featured: Boolean(values.featured),
    video_url: cleanValue(values.video_url), publication_date: values.is_published ? (values.publication_date || new Date().toISOString().slice(0, 10)) : cleanValue(values.publication_date),
    broker_name: cleanValue(values.broker_name), broker_creci: cleanValue(values.broker_creci) };
  const result = await callCrmRpc("save_crm_property_with_media", {
    target_organization: org,
    target_property: existing?.id || null,
    target_expected_updated_at: existing?.updated_at || null,
    target_payload: payload,
    target_media: mediaItems.map(item => ({ storage_path:item.storage_path,alt_text:item.alt_text||"",caption:item.caption||"",media_kind:item.media_kind||"photo" }))
  });
  return Array.isArray(result) ? result[0] : result;
}

async function replacePropertyMedia(propertyId, items) {
  return callCrmRpc("replace_property_media", { target_property: propertyId, media_items: items.map(item => ({ storage_path:item.storage_path,alt_text:item.alt_text||"",caption:item.caption||"",media_kind:item.media_kind||"photo" })) });
}

async function uploadPropertyPhoto(propertyCode, file, progress) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Use JPG, PNG ou WebP de até 15 MB.");
  const org = await getActiveOrganizationId(), session = await getValidSession(), extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${org}/${propertyCode.toLowerCase()}/${crypto.randomUUID()}.${extension}`;
  progress?.("Enviando…");
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/storage/v1/object/property-media/${path}`, { method: "POST", headers: { apikey: CRM_CONFIG.supabasePublishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": file.type, "x-upsert": "false" }, body: file });
  if (!response.ok) throw new Error("Falha no upload. Tente novamente.");
  progress?.("Concluído");
  return `${CRM_CONFIG.supabaseUrl}/storage/v1/object/public/property-media/${path}`;
}

async function getProposals(leadId) { if(isDemoMode())return demoProposals.filter(x=>!leadId||x.lead_id===leadId);const org = await getActiveOrganizationId(); return supabaseRequest(`/rest/v1/proposals?organization_id=eq.${encodeURIComponent(org)}${leadId ? `&lead_id=eq.${encodeURIComponent(leadId)}` : ""}&select=*&order=proposal_date.desc`); }
async function saveProposal(payload, id) {if(isDemoMode()){const saved={id:id||`proposal-${crypto.randomUUID()}`,proposal_date:new Date().toISOString().slice(0,10),...payload};demoProposals=id?demoProposals.map(x=>x.id===id?saved:x):[saved,...demoProposals];return saved;} const org = await getActiveOrganizationId(), session = await getValidSession(); const body = { ...payload, organization_id: org, created_by: session.user.id }; return id ? (await supabaseRequest(`/rest/v1/proposals?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }))[0] : (await supabaseRequest("/rest/v1/proposals", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([body]) }))[0]; }
async function getNotifications() {if(isDemoMode())return[]; const org = await getActiveOrganizationId(); await callCrmRpc("refresh_my_notifications", { target_organization: org }); return supabaseRequest(`/rest/v1/crm_notifications?organization_id=eq.${encodeURIComponent(org)}&select=*&order=created_at.desc&limit=100`); }
async function markNotificationRead(id) { const org = await getActiveOrganizationId(); return supabaseRequest(`/rest/v1/crm_notifications?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}`, { method: "PATCH", body: JSON.stringify({ read_at: new Date().toISOString() }) }); }
async function globalCrmSearch(query) {if(isDemoMode()){const q=normalizeText(query),[leads,properties]=await Promise.all([getLeads(),loadProperties()]);return[...leads.filter(x=>normalizeText([x.name,x.phone,x.email].join(" ")).includes(q)).map(x=>({kind:"lead",entity_id:x.id,title:x.name,subtitle:x.phone||x.email,action_view:"leads"})),...properties.filter(x=>normalizeText([x.codigo,x.titulo,x.bairro].join(" ")).includes(q)).map(x=>({kind:"property",entity_id:x.id,title:`${x.codigo} — ${x.titulo}`,subtitle:x.bairro,action_view:"properties"}))].slice(0,30);} return callCrmRpc("crm_global_search", { target_organization: await getActiveOrganizationId(), target_query: query, result_limit: 30 }); }
async function getAssistantBriefing() {if(isDemoMode()){const[a,p]=await Promise.all([getCrmActivities(),getProposals()]),now=new Date(),today=startOfToday(),tomorrow=new Date(today.getTime()+86400000);return{today_activities:a.filter(x=>new Date(x.scheduled_at)>=today&&new Date(x.scheduled_at)<tomorrow).length,tomorrow_activities:0,overdue_followups:a.filter(x=>x.status==="agendado"&&new Date(x.scheduled_at)<now).length,unassigned_leads:(await getLeads()).filter(x=>!x.assigned_to).length,stale_leads:0,open_proposals:p.filter(x=>["sent","negotiating"].includes(x.status)).length,expected_commission:0};} return callCrmRpc("get_assistant_briefing", { target_organization: await getActiveOrganizationId() }); }
async function getSiteStatus() {if(isDemoMode())return{configured:true,published_properties:(await loadProperties()).filter(x=>x.ativo!==false).length,last_site_lead_at:null,checked_at:new Date().toISOString()};return callCrmRpc("get_site_status", { target_organization: await getActiveOrganizationId() }); }
async function updateMyProfile(payload) {if(isDemoMode())return payload; const session = await getValidSession(); return (await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }))[0]; }

function cleanValue(value) { const clean = String(value ?? "").trim(); return clean || null; }
function numericValue(value) { const parsed = parseBrlNumber(value); return Number.isFinite(parsed) ? parsed : null; }
function integerValue(value) { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : null; }
function splitList(value) { return String(value || "").split(/\r?\n|,/).map(item => item.trim()).filter(Boolean); }
function slugify(value) { return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

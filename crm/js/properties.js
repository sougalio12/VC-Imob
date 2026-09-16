const PROPERTY_STATUS = { draft: "Rascunho", available: "Disponível", reserved: "Reservado", sold: "Vendido", inactive: "Inativo" };

function propertyMediaUrl(path) {
  const value = String(path || "").trim().replace(/\\/g, "/");
  if (!value) return "";
  if (/^(?:https?:|data:|blob:)/i.test(value) || value.startsWith("//") || value.startsWith("/")) return value;
  if (value.startsWith("../")) return new URL(value, window.location.href).href;
  return new URL(`../${value.replace(/^\.\//, "")}`, window.location.href).href;
}

function createPropertyThumbnail(path, alt) {
  const image = createElement("img", { src: propertyMediaUrl(path), alt, attrs: { decoding: "async" } });
  image.addEventListener("error", () => {
    image.hidden = true;
    image.after(createElement("span", { className: "media-thumbnail-error", text: "Miniatura indisponível", attrs: { role: "status" } }));
  }, { once: true });
  return image;
}

async function renderProperties(root) {
  crmProperties = [];
  const [properties, membership] = await Promise.all([loadProperties(), getActiveMembership()]);
  const canManage = ["owner", "manager"].includes(membership.role);
  root.replaceChildren();
  const toolbar = createElement("div", { className: "toolbar" }), controls = createElement("div", { className: "toolbar-controls" });
  const search = createElement("input", { className: "search-input", attrs: { type: "search", placeholder: "Código, título, bairro ou cidade", "aria-label": "Buscar imóveis" } });
  const status = createElement("select", { className: "filter-select", attrs: { "aria-label": "Filtrar status" } });
  status.append(new Option("Todos os status", ""));
  Object.entries(PROPERTY_STATUS).forEach(([value, text]) => status.append(new Option(text, value)));
  controls.append(search, status); toolbar.append(controls);
  if (canManage) {
    const add = createElement("button", { className: "crm-button crm-button-primary", text: "+ Novo imóvel", type: "button" });
    add.addEventListener("click", () => openPropertyModal(null)); toolbar.append(add);
    const selection = createElement("button", { className: "crm-button crm-button-outline", text: "Criar seleção", type: "button" });
    selection.addEventListener("click", () => openClientSelectionModal(properties)); toolbar.append(selection);
  }
  root.append(toolbar);
  const grid = createElement("section", { className: "properties-grid premium-properties" }); root.append(grid);
  function draw() {
    const query = normalizeText(search.value);
    const filtered = properties.filter(item => {
      const itemStatus = item.status || (item.ativo ? "available" : "inactive");
      return (!status.value || itemStatus === status.value) && (!query || normalizeText([item.codigo, item.titulo, item.bairro, item.cidade].join(" ")).includes(query));
    });
    grid.replaceChildren();
    if (!filtered.length) grid.append(createEmptyState("Nenhum imóvel encontrado", canManage ? "Cadastre o primeiro imóvel ou ajuste os filtros." : "Nenhum imóvel disponível."));
    else filtered.forEach(property => grid.append(createPropertyAdminCard(property, canManage)));
  }
  search.addEventListener("input", draw); status.addEventListener("change", draw); draw();
}

function createPropertyAdminCard(property, canManage) {
  const card = createElement("article", { className: "property-mini property-admin-card" }), media = createElement("div", { className: "property-admin-media" });
  const cover = property.imagens?.[0];
  media.append(cover ? createPropertyThumbnail(cover, property.imagensAlt?.[0] || property.titulo || "Imóvel") : createElement("div", { className: "property-placeholder", text: "Sem foto" }));
  media.append(createElement("span", { className: `stage stage-${property.status || "available"}`, text: PROPERTY_STATUS[property.status] || (property.ativo === false ? "Inativo" : "Disponível") }));
  const body = createElement("div", { className: "property-mini-body" });
  body.append(createElement("p", { text: property.codigo || "Sem código" }), createElement("h2", { text: property.titulo || "Imóvel sem título" }), createElement("p", { text: [property.bairro, property.cidade].filter(Boolean).join(" • ") || "Localização não informada" }), createElement("strong", { className: "property-admin-price", text: formatPrice(property.preco) }));
  const actions = createElement("div", { className: "property-admin-actions" });
  if (property._row ? property.publicado : property.ativo !== false) actions.append(createElement("a", { className: "crm-button crm-button-outline", text: "Ver no site", attrs: { href: `../imovel.html?codigo=${encodeURIComponent(property.codigo)}`, target: "_blank", rel: "noopener" } }));
  if (canManage && property._row) {
    if (property.publicado) { const qr = createElement("button", { className: "crm-button crm-button-outline", text: "QR", type: "button" }); qr.addEventListener("click", () => openPropertyQr(property)); actions.append(qr); }
    const edit = createElement("button", { className: "crm-button crm-button-outline", text: "Editar", type: "button" }); edit.addEventListener("click", () => openPropertyModal(property)); actions.append(edit);
    const details = createElement("button", { className: "crm-button crm-button-outline", text: "Desempenho", type: "button" }); details.addEventListener("click", () => openPropertyPerformance(property)); actions.append(details);
    const duplicate = createElement("button", { className: "crm-button crm-button-outline", text: "Duplicar", type: "button" }); duplicate.addEventListener("click", () => openDuplicatePropertyModal(property)); actions.append(duplicate);
  }
  body.append(actions); card.append(media, body); return card;
}

function propertyFieldset(title) {
  const fieldset = createElement("fieldset", { className: "form-section" }), grid = createElement("div", { className: "form-grid" });
  fieldset.append(createElement("legend", { text: title }), grid); return { fieldset, grid };
}

async function openPropertyModal(property) {
  const profile = await loadCrmProfile(), modal = document.getElementById("crmModal");
  const card = createElement("section", { className: "modal-card property-editor", attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "propertyEditorTitle" } });
  card.append(createElement("h2", { attrs: { id: "propertyEditorTitle" }, text: property ? `Editar ${property.codigo}` : "Cadastrar imóvel" }));
  const form = createElement("form", { className: "crm-form property-editor-form" });
  const primary = propertyFieldset("Dados principais"), location = propertyFieldset("Localização"), details = propertyFieldset("Características");
  const progress = createElement("ol", { className: "property-editor-progress", attrs: { "aria-label": "Etapas do cadastro" } });
  ["Dados", "Localização", "Características", "Fotos", "Revisão"].forEach((text, index) => progress.append(createElement("li", { text: `${index + 1}. ${text}` })));
  form.append(progress);
  const values = property?._row || {}, controls = {};
  const specs = [
    ["code", "Código VCI", "text", true, primary.grid], ["title", "Título", "text", true, primary.grid], ["slug", "Slug", "text", false, primary.grid],
    ["purpose", "Finalidade", "select", true, primary.grid], ["property_type", "Tipo", "text", false, primary.grid], ["price", "Preço", "currency", false, primary.grid], ["status", "Status", "select", true, primary.grid],
    ["city", "Cidade", "text", false, location.grid], ["state", "UF", "text", false, location.grid], ["neighborhood", "Bairro", "text", false, location.grid], ["public_address", "Localização pública", "text", false, location.grid],
    ["total_area", "Área total (m²)", "decimal", false, details.grid], ["built_area", "Área construída/privativa (m²)", "decimal", false, details.grid], ["bedrooms", "Quartos", "number", false, details.grid], ["suites", "Suítes", "number", false, details.grid], ["bathrooms", "Banheiros", "number", false, details.grid], ["parking_spaces", "Vagas", "number", false, details.grid]
  ];
  specs.forEach(([name, label, kind, required, host]) => {
    const labelElement = createElement("label", { text: label });
    const control = kind === "select" ? createElement("select", { attrs: { name } }) : createElement("input", { type: "text", attrs: { name } });
    if (required) control.required = true;
    if (name === "purpose") [["venda", "Venda"], ["locacao", "Locação"], ["venda_locacao", "Venda ou locação"]].forEach(([value, text]) => control.append(new Option(text, value)));
    if (name === "status") Object.entries(PROPERTY_STATUS).forEach(([value, text]) => control.append(new Option(text, value)));
    control.value = values[name] ?? (name === "purpose" ? "venda" : name === "status" ? "draft" : name === "state" ? "MT" : "");
    if (name === "code" && property) control.readOnly = true;
    if (kind === "currency") bindCurrencyInput(control);
    if (kind === "decimal") control.inputMode = "decimal";
    if (kind === "number") { control.inputMode = "numeric"; control.pattern = "[0-9]*"; }
    controls[name] = control; labelElement.append(control); host.append(labelElement);
  });
  form.append(primary.fieldset, location.fieldset, details.fieldset);
  const description = propertyTextArea("Descrição", "description", values.description), features = propertyTextArea("Características (uma por linha)", "features", (values.features || []).join("\n"));
  form.append(description.label, features.label);
  const flags = createElement("div", { className: "property-flags" }), published = propertyCheckbox("Publicado no site", values.is_published), featured = propertyCheckbox("Destaque", values.featured);
  flags.append(published.label, featured.label); form.append(flags);

  const mediaEditor = createElement("section", { className: "media-editor" }), mediaList = createElement("div", { className: "media-editor-list" });
  const fileInput = createElement("input", { type: "file", attrs: { accept: "image/jpeg,image/png,image/webp", multiple: "", "aria-label": "Selecionar fotos" } });
  const uploadStatus = createElement("p", { className: "muted", attrs: { role: "status", "aria-live": "polite" } });
  mediaEditor.append(createElement("h3", { text: "Fotos" }), createElement("p", { className: "muted", text: "A primeira foto é a capa. Reordene sem alterar os arquivos originais." }), mediaList, fileInput, uploadStatus); form.append(mediaEditor);
  const media = (property?._media || []).map(item => ({ ...item }));
  function drawMedia() {
    mediaList.replaceChildren();
    if (!media.length) mediaList.append(createElement("p", { className: "muted", text: "Nenhuma foto adicionada." }));
    media.forEach((item, index) => {
      const row = createElement("div", { className: "media-editor-row" });
      const up = createElement("button", { type: "button", className: "icon-button", text: "↑", disabled: index === 0, attrs: { "aria-label": `Mover foto ${index + 1} para cima` } });
      const down = createElement("button", { type: "button", className: "icon-button", text: "↓", disabled: index === media.length - 1, attrs: { "aria-label": `Mover foto ${index + 1} para baixo` } });
      const remove = createElement("button", { type: "button", className: "icon-button", text: "Remover", attrs: { "aria-label": `Remover foto ${index + 1}` } });
      up.addEventListener("click", () => { [media[index - 1], media[index]] = [media[index], media[index - 1]]; drawMedia(); });
      down.addEventListener("click", () => { [media[index + 1], media[index]] = [media[index], media[index + 1]]; drawMedia(); });
      remove.addEventListener("click", () => { media.splice(index, 1); drawMedia(); });
      row.append(createPropertyThumbnail(item.storage_path, item.alt_text || `Foto ${index + 1}`), createElement("span", { text: index === 0 ? "Capa" : `Foto ${index + 1}` }), up, down, remove); mediaList.append(row);
    });
  }
  drawMedia();
  let draftTimer;
  const draftKey = property?._row?.id || null;
  const saveDraftSoon = () => { clearTimeout(draftTimer); draftTimer = setTimeout(async () => {
    try { await savePropertyDraft(draftKey, collectPropertyDraft(form, media)); uploadStatus.textContent = "Rascunho salvo com segurança."; }
    catch { uploadStatus.textContent = "Não foi possível salvar o rascunho agora."; }
  }, 900); };
  form.addEventListener("input", saveDraftSoon); form.addEventListener("change", saveDraftSoon);
  if (!property) {
    loadPropertyDraft(null).then(draft => {
      if (!draft?.payload || !window.confirm("Continuar o cadastro anterior?")) return;
      Object.entries(draft.payload.fields || {}).forEach(([name, value]) => { if (controls[name]) controls[name].value = value ?? ""; });
      description.control.value = draft.payload.description || ""; features.control.value = draft.payload.features || "";
      published.control.checked = Boolean(draft.payload.is_published); featured.control.checked = Boolean(draft.payload.featured);
      (draft.payload.media || []).forEach(item => media.push(item)); drawMedia();
    }).catch(() => {});
  }
  fileInput.addEventListener("change", async () => {
    const code = controls.code.value.trim().toUpperCase();
    if (!/^VCI\d{6}$/.test(code)) { uploadStatus.textContent = "Informe primeiro um código VCI válido."; return; }
    fileInput.disabled = true;
    try {
      for (const file of fileInput.files) {
        const url = await uploadPropertyPhoto(code, file, text => { uploadStatus.textContent = `${file.name}: ${text}`; });
        media.push({ storage_path: url, alt_text: `${controls.title.value || "Imóvel"} — foto ${media.length + 1}`, media_kind: "photo" }); drawMedia();
      }
    } catch (error) { uploadStatus.textContent = error.message || "Não foi possível enviar a foto. Tente novamente."; }
    finally { fileInput.value = ""; fileInput.disabled = false; }
  });

  const publicationPreview = createElement("section", { className: "property-publication-preview", attrs: { hidden: "", "aria-live": "polite" } });
  const error = createElement("p", { className: "form-error", attrs: { role: "alert" } }), actions = createElement("div", { className: "modal-actions" });
  const cancel = createElement("button", { type: "button", className: "crm-button crm-button-outline", text: "Cancelar" }), save = createElement("button", { type: "submit", className: "crm-button crm-button-primary", text: "Salvar imóvel" });
  cancel.addEventListener("click", closeModal); actions.append(cancel, save); form.append(publicationPreview, error, actions);
  const resetPublicationPreview = () => { form.dataset.publicationReviewed = ""; publicationPreview.hidden = true; save.textContent = "Salvar imóvel"; };
  form.addEventListener("input", resetPublicationPreview); form.addEventListener("change", resetPublicationPreview);
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (save.disabled) return; save.disabled = true; save.textContent = "Salvando…"; error.textContent = "";
    try {
      if (published.control.checked && !["available", "reserved"].includes(controls.status.value)) throw new Error("Para publicar, escolha o status Disponível ou Reservado.");
      const payload = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
      Object.assign(payload, { description: description.control.value, features: features.control.value, is_published: published.control.checked, featured: featured.control.checked, broker_name: values.broker_name || getDisplayName(profile), broker_creci: values.broker_creci || profile.creci, publication_date: values.publication_date });
      const missing = propertyPublicationRequirements(payload, media);
      if (published.control.checked && missing.required.length) throw new Error(`Para publicar, informe: ${missing.required.join(", ")}.`);
      if (published.control.checked && form.dataset.publicationReviewed !== "yes") {
        publicationPreview.hidden = false;
        publicationPreview.replaceChildren(createElement("h3", { text: "Revisão antes de publicar" }), media[0] ? createPropertyThumbnail(media[0].storage_path, payload.title) : createElement("span"), createElement("strong", { text: payload.title }), createElement("p", { text: `${payload.code} · ${[payload.neighborhood, payload.city].filter(Boolean).join(" · ")} · ${formatPrice(parseBrlNumber(payload.price))}` }), createElement("p", { className: "muted", text: missing.recommended.length ? `Recomendado completar: ${missing.recommended.join(", ")}.` : "Campos essenciais e recomendados preenchidos." }));
        form.dataset.publicationReviewed = "yes"; save.disabled = false; save.textContent = "Confirmar e publicar"; publicationPreview.scrollIntoView({ behavior: "auto", block: "nearest" }); return;
      }
      await saveManagedProperty(payload, property?._row, media); await deletePropertyDraft(draftKey);
      crmProperties = []; closeModal(); showToast("Imóvel salvo e catálogo atualizado."); navigateCrm("properties");
    } catch (reason) { error.textContent = reason?.userMessage || reason?.message || "Não foi possível salvar o imóvel. Tente novamente."; }
    finally { save.disabled = false; save.textContent = form.dataset.publicationReviewed === "yes" && published.control.checked ? "Confirmar e publicar" : "Salvar imóvel"; }
  });
  card.append(form); modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false");
}

function collectPropertyDraft(form, media) { const data = new FormData(form), fields = {}; for (const [key, value] of data) if (typeof value === "string") fields[key] = value; return { fields, description: form.elements.description?.value || "", features: form.elements.features?.value || "", is_published: form.querySelector('.property-flags input')?.checked || false, featured: form.querySelectorAll('.property-flags input')[1]?.checked || false, media: media.map(({ storage_path, alt_text, caption, media_kind }) => ({ storage_path, alt_text, caption, media_kind })) }; }
function propertyPublicationRequirements(values, media) { const required = [], recommended = []; if (!String(values.title || "").trim()) required.push("título"); if (!/^VCI\d{6}$/.test(String(values.code || "").trim().toUpperCase())) required.push("código VCI válido"); if (!numericValue(values.price)) required.push("preço"); if (!String(values.city || "").trim()) required.push("cidade"); if (!media.length) required.push("ao menos uma foto"); if (!String(values.description || "").trim()) recommended.push("descrição"); if (!String(values.neighborhood || "").trim()) recommended.push("bairro"); return { required, recommended }; }

async function savePropertyDraft(propertyId, payload) { const org = await getActiveOrganizationId(), session = await getValidSession(); const query = `/rest/v1/property_drafts?user_id=eq.${encodeURIComponent(session.user.id)}&${propertyId ? `property_id=eq.${encodeURIComponent(propertyId)}` : "property_id=is.null"}&select=id`; const current = await supabaseRequest(query); const body = { organization_id: org, user_id: session.user.id, property_id: propertyId, payload, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }; return current[0] ? supabaseRequest(`/rest/v1/property_drafts?id=eq.${current[0].id}`, { method: "PATCH", body: JSON.stringify(body) }) : supabaseRequest("/rest/v1/property_drafts", { method: "POST", body: JSON.stringify([body]) }); }
async function loadPropertyDraft(propertyId) { if (isDemoMode()) return null; const session = await getValidSession(); const rows = await supabaseRequest(`/rest/v1/property_drafts?user_id=eq.${encodeURIComponent(session.user.id)}&${propertyId ? `property_id=eq.${encodeURIComponent(propertyId)}` : "property_id=is.null"}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`); return rows[0] || null; }
async function deletePropertyDraft(propertyId) { if (isDemoMode()) return; const session = await getValidSession(); await supabaseRequest(`/rest/v1/property_drafts?user_id=eq.${encodeURIComponent(session.user.id)}&${propertyId ? `property_id=eq.${encodeURIComponent(propertyId)}` : "property_id=is.null"}`, { method: "DELETE" }); }

async function openDuplicatePropertyModal(property) { const modal = document.getElementById("crmModal"), card = createElement("section", { className: "modal-card", attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "duplicatePropertyTitle" } }), form = createElement("form", { className: "crm-form" }), code = createElement("input", { type: "text", attrs: { required: "", pattern: "VCI[0-9]{6}", placeholder: "VCI000007" } }), title = createElement("input", { type: "text" }), error = createElement("p", { className: "form-error", attrs: { role: "alert" } }); title.value = `${property.titulo} — cópia`; card.append(createElement("h2", { id: "duplicatePropertyTitle", text: "Duplicar imóvel como rascunho" })); [["Novo código VCI", code], ["Título", title]].forEach(([text, input]) => { const label = createElement("label", { text }); label.append(input); form.append(label); }); const submit = createElement("button", { className: "crm-button crm-button-primary", type: "submit", text: "Criar rascunho" }); form.append(error, submit); form.addEventListener("submit", async event => { event.preventDefault(); submit.disabled = true; try { await callCrmRpc("duplicate_crm_property", { target_organization: await getActiveOrganizationId(), target_property: property._row.id, new_code: code.value.trim().toUpperCase(), new_title: title.value.trim() }); crmProperties = []; closeModal(); showToast("Rascunho duplicado. As imagens originais não foram alteradas."); navigateCrm("properties"); } catch (reason) { error.textContent = reason.userMessage || reason.message; } finally { submit.disabled = false; } }); card.append(form); modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); code.focus(); }

async function openPropertyPerformance(property) {
  const org = await getActiveOrganizationId(), id = property._row.id;
  const [history, interests, activities, proposals, feedback, leads] = await Promise.all([
    supabaseRequest(`/rest/v1/property_change_history?organization_id=eq.${org}&property_id=eq.${id}&select=*&order=created_at.desc`),
    getLeadInterestsF().catch(() => []), getCrmActivities().catch(() => []), getProposals().catch(() => []),
    supabaseRequest(`/rest/v1/client_feedback?organization_id=eq.${org}&property_id=eq.${id}&select=reaction,is_favorite`).catch(() => []),
    getLeads().catch(() => [])
  ]);
  const relatedInterests = interests.filter(item => item.property_code === property.codigo);
  const interestedNames = [...new Set(relatedInterests.map(item => leads.find(lead => lead.id === item.lead_id)?.name).filter(Boolean))];
  const visits = activities.filter(item => item.property_id === id && item.kind === "visita");
  const relatedProposals = proposals.filter(item => item.property_id === id);
  const conversion = visits.length ? Math.round((relatedProposals.length / visits.length) * 100) : null;
  const days = Math.max(0, crmDaysSince(property._row.publication_date || property._row.created_at));
  const modal = document.getElementById("crmModal"), card = createElement("section", { className: "modal-card", attrs: { role: "dialog", "aria-modal": "true" } });
  card.append(createElement("h2", { text: `${property.codigo} — desempenho` }), createElement("p", { text: `${days} dia(s) em carteira · ${relatedInterests.length} interesse(s) · ${visits.length} visita(s) · ${relatedProposals.length} proposta(s)` }), createElement("p", { text: conversion === null ? "Conversão visita → proposta: amostra insuficiente." : `Conversão visita → proposta: ${conversion}%.` }));
  if (feedback.length) card.append(createElement("p", { text: `Portal: ${feedback.filter(item => item.is_favorite).length} favorito(s), ${feedback.filter(item => item.reaction === "liked").length} gostei, ${feedback.filter(item => item.reaction === "disliked").length} rejeição(ões) e ${feedback.filter(item => item.reaction === "visit_requested").length} pedido(s) de visita.` }));
  if (interestedNames.length) card.append(createElement("p", { text: `Leads interessados: ${interestedNames.join(", ")}.` }));
  if (days >= 30 && !visits.length && !relatedProposals.length) card.append(createElement("p", { className: "assistant-alert", text: "Imóvel parado: publicado há 30 dias ou mais, sem visita ou proposta registrada." }));
  const list = createElement("div", { className: "property-history" });
  if (!history.length) list.append(createElement("p", { className: "muted", text: "Nenhuma alteração de preço ou status registrada ainda." }));
  history.forEach(item => list.append(createElement("p", { text: `${formatDate(item.created_at, true)} · ${item.change_kind}: ${item.old_value ?? "não informado"} → ${item.new_value ?? "não informado"}` })));
  const close = createElement("button", { type: "button", className: "crm-button crm-button-outline", text: "Fechar" }); close.addEventListener("click", closeModal); card.append(list, close); modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false");
}

async function openClientSelectionModal(properties) {
  const org = await getActiveOrganizationId();
  const [leads, existingSelections] = await Promise.all([getLeads(), supabaseRequest(`/rest/v1/client_selections?organization_id=eq.${org}&select=id,title,lead_id,expires_at,revoked_at,created_at&order=created_at.desc&limit=30`).catch(() => [])]);
  const published = properties.filter(item => item.publicado && item._row?.id), selected = [];
  const modal = document.getElementById("crmModal"), card = createElement("section", { className: "modal-card", attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "selectionTitle" } }), form = createElement("form", { className: "crm-form" });
  const lead = createElement("select", { attrs: { required: "" } }), title = createElement("input", { type: "text", attrs: { required: "", maxlength: "120" } }), note = createElement("textarea", { attrs: { maxlength: "2000" } }), expiry = createElement("select"), choices = createElement("fieldset", { className: "selection-property-list" }), order = createElement("div", { className: "selection-order", attrs: { "aria-live": "polite" } }), error = createElement("p", { className: "form-error", attrs: { role: "alert" } });
  lead.append(new Option("Selecione o cliente", "")); leads.forEach(item => lead.append(new Option(item.name, item.id))); choices.append(createElement("legend", { text: "Imóveis publicados (até 20)" }));
  [[7,"7 dias"],[30,"30 dias"],[60,"60 dias"],[90,"90 dias"]].forEach(([value,text]) => expiry.append(new Option(text,String(value)))); expiry.value = "30";
  function drawOrder() { order.replaceChildren(createElement("strong", { text: "Ordem da seleção" })); if (!selected.length) order.append(createElement("p", { className: "muted", text: "Selecione os imóveis acima." })); selected.forEach((id, index) => { const property = published.find(item => item._row.id === id), row = createElement("div", { className: "selection-order-row" }), up = createElement("button", { type: "button", text: "↑", disabled: index === 0, attrs: { "aria-label": `Mover ${property.codigo} para cima` } }), down = createElement("button", { type: "button", text: "↓", disabled: index === selected.length - 1, attrs: { "aria-label": `Mover ${property.codigo} para baixo` } }); up.addEventListener("click", () => { [selected[index - 1], selected[index]] = [selected[index], selected[index - 1]]; drawOrder(); }); down.addEventListener("click", () => { [selected[index + 1], selected[index]] = [selected[index], selected[index + 1]]; drawOrder(); }); row.append(createElement("span", { text: `${index + 1}. ${property.codigo} — ${property.titulo}` }), up, down); order.append(row); }); }
  published.forEach(property => { const label = createElement("label", { className: "checkbox-field" }), input = createElement("input", { type: "checkbox", attrs: { value: property._row.id } }); input.addEventListener("change", () => { const currentIndex = selected.indexOf(input.value); if (input.checked && currentIndex < 0 && selected.length < 20) selected.push(input.value); else if (!input.checked && currentIndex >= 0) selected.splice(currentIndex, 1); else if (input.checked && selected.length >= 20) input.checked = false; drawOrder(); }); label.append(input, document.createTextNode(`${property.codigo} — ${property.titulo}`)); choices.append(label); });
  [["Cliente", lead], ["Título da seleção", title], ["Mensagem opcional", note], ["Validade do link", expiry]].forEach(([text, input]) => { const label = createElement("label", { text }); label.append(input); form.append(label); }); form.append(choices, order); drawOrder();
  const management = createElement("section", { className: "selection-management" });
  function drawExisting() { management.replaceChildren(createElement("h3", { text: "Links recentes" })); const active = existingSelections.filter(item => !item.revoked_at && new Date(item.expires_at) > new Date()); if (!active.length) { management.append(createElement("p", { className: "muted", text: "Nenhum link ativo." })); return; } active.forEach(item => { const row = createElement("div", { className: "selection-management-row" }), revoke = createElement("button", { type: "button", className: "crm-button crm-button-outline", text: "Revogar" }); revoke.addEventListener("click", async () => { if (revoke.disabled || !window.confirm(`Revogar o link “${item.title}”?`)) return; revoke.disabled = true; try { await callCrmRpc("revoke_client_selection", { target_organization: org, target_selection: item.id }); item.revoked_at = new Date().toISOString(); drawExisting(); showToast("Link privado revogado."); } catch (reason) { showToast(crmFriendlyError(reason,"Não foi possível revogar o link."),"error"); revoke.disabled = false; } }); row.append(createElement("span", { text: `${item.title} · expira em ${formatDate(item.expires_at)}` }), revoke); management.append(row); }); }
  drawExisting();
  const submit = createElement("button", { type: "submit", className: "crm-button crm-button-primary", text: "Criar link privado" }); form.append(error, submit); form.addEventListener("submit", async event => { event.preventDefault(); if (!selected.length) { error.textContent = "Selecione ao menos um imóvel integrado ao CRM."; return; } submit.disabled = true; try { const targetExpiry = new Date(Date.now() + Number(expiry.value) * 86400000).toISOString(); const result = await callCrmRpc("create_client_selection", { target_organization: org, target_lead: lead.value, target_title: title.value, target_note: note.value, target_property_ids: selected, target_expires_at: targetExpiry }); const link = new URL("../selecao.html", location.href); link.searchParams.set("token", result.token); existingSelections.unshift({ id: result.id, title: title.value.trim(), lead_id: lead.value, expires_at: result.expires_at, revoked_at: null, created_at: new Date().toISOString() }); drawExisting(); try { await navigator.clipboard?.writeText(link.href); } catch { /* O compartilhamento continua disponível quando o clipboard é bloqueado. */ } error.className = "form-success"; error.replaceChildren(document.createTextNode("Link privado criado. "), createElement("a", { text: "Abrir seleção", attrs: { href: link.href, target: "_blank", rel: "noopener noreferrer" } }), document.createTextNode(" · "), createElement("a", { text: "Compartilhar no WhatsApp", attrs: { href: `https://wa.me/?text=${encodeURIComponent(`Preparei uma seleção de imóveis para você: ${link.href}`)}`, target: "_blank", rel: "noopener noreferrer" } })); } catch (reason) { error.textContent = reason.userMessage || reason.message; } finally { submit.disabled = false; } });
  card.append(createElement("h2", { id: "selectionTitle", text: "Seleção personalizada" }), form, management); modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false");
}

function propertyTextArea(text, name, value) { const label = createElement("label", { text }), control = createElement("textarea", { attrs: { name } }); control.value = value || ""; label.append(control); return { label, control }; }
function propertyCheckbox(text, checked) { const label = createElement("label", { className: "checkbox-field" }), control = createElement("input", { type: "checkbox" }); control.checked = Boolean(checked); label.append(control, document.createTextNode(text)); return { label, control }; }

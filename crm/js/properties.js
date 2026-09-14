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
  if (canManage && property._row) { const edit = createElement("button", { className: "crm-button crm-button-outline", text: "Editar", type: "button" }); edit.addEventListener("click", () => openPropertyModal(property)); actions.append(edit); }
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

  const error = createElement("p", { className: "form-error", attrs: { role: "alert" } }), actions = createElement("div", { className: "modal-actions" });
  const cancel = createElement("button", { type: "button", className: "crm-button crm-button-outline", text: "Cancelar" }), save = createElement("button", { type: "submit", className: "crm-button crm-button-primary", text: "Salvar imóvel" });
  cancel.addEventListener("click", closeModal); actions.append(cancel, save); form.append(error, actions);
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (save.disabled) return; save.disabled = true; save.textContent = "Salvando…"; error.textContent = "";
    try {
      if (published.control.checked && !["available", "reserved"].includes(controls.status.value)) throw new Error("Para publicar, escolha o status Disponível ou Reservado.");
      const payload = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
      Object.assign(payload, { description: description.control.value, features: features.control.value, is_published: published.control.checked, featured: featured.control.checked, broker_name: values.broker_name || getDisplayName(profile), broker_creci: values.broker_creci || profile.creci, publication_date: values.publication_date });
      await saveManagedProperty(payload, property?._row, media);
      crmProperties = []; closeModal(); showToast("Imóvel salvo e catálogo atualizado."); navigateCrm("properties");
    } catch (reason) { error.textContent = reason?.userMessage || reason?.message || "Não foi possível salvar o imóvel. Tente novamente."; }
    finally { save.disabled = false; save.textContent = "Salvar imóvel"; }
  });
  card.append(form); modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false");
}

function propertyTextArea(text, name, value) { const label = createElement("label", { text }), control = createElement("textarea", { attrs: { name } }); control.value = value || ""; label.append(control); return { label, control }; }
function propertyCheckbox(text, checked) { const label = createElement("label", { className: "checkbox-field" }), control = createElement("input", { type: "checkbox" }); control.checked = Boolean(checked); label.append(control, document.createTextNode(text)); return { label, control }; }

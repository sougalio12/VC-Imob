async function renderLeads(root) {
  const [leads, properties] = await Promise.all([getLeads(), loadProperties()]);
  root.replaceChildren();
  const toolbar = createElement("div", { className: "toolbar" });
  const controls = createElement("div", { className: "toolbar-controls" });
  const search = createElement("input", { className: "search-input", attrs: { placeholder: "Buscar por nome, telefone ou imóvel" } });
  const filter = createElement("select", { className: "filter-select" });
  filter.append(new Option("Todas as etapas", ""));
  CRM_STAGES.forEach(([value, label]) => filter.append(new Option(label, value)));
  controls.append(search, filter);
  const add = createElement("button", { className: "crm-button crm-button-primary", text: "+ Cadastrar lead", type: "button" });
  add.addEventListener("click", () => { void openLeadModal(null, properties); });
  toolbar.append(controls, add);
  root.append(toolbar);

  const tableWrap = createElement("div", { className: "lead-table-wrap" });
  root.append(tableWrap);
  const renderTable = () => {
    const query = normalizeText(search.value);
    const stage = filter.value;
    const filtered = leads.filter(lead => (!stage || lead.stage === stage) && (!query || normalizeText([lead.name, lead.phone, lead.whatsapp, lead.email, lead.property_code, lead.property_title].join(" ")).includes(query)));
    const table = createElement("table", { className: "lead-table" });
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    ["Lead", "Imóvel / região", "Etapa", "Próximo retorno", "Ações"].forEach(text => tr.append(createElement("th", { text })));
    thead.append(tr);
    table.append(thead);
    const tbody = document.createElement("tbody");
    filtered.forEach(lead => {
      const row = document.createElement("tr");
      const name = createElement("td");
      name.append(createElement("strong", { text: lead.name }), createElement("span", { text: lead.phone || lead.whatsapp || "" }));
      row.append(name, createElement("td", { text: lead.property_title || lead.desired_region || "—" }));
      const stageCell = createElement("td");
      stageCell.append(createElement("span", { className: `stage stage-${lead.stage}`, text: stageLabel(lead.stage) }));
      row.append(stageCell, createElement("td", { text: formatDate(lead.next_follow_up) }));
      const actions = createElement("td");
      const actionRow = createElement("div", { className: "table-actions" });
      const edit = createElement("button", { className: "icon-button", text: "Editar", type: "button" });
      edit.addEventListener("click", () => { void openLeadModal(lead, properties); });
      const remove = createElement("button", { className: "icon-button", text: "Excluir", type: "button" });
      remove.addEventListener("click", () => confirmDeleteLead(lead));
      actionRow.append(edit, remove);
      actions.append(actionRow);
      row.append(actions);
      tbody.append(row);
    });
    if (!filtered.length) {
      const row = document.createElement("tr");
      row.append(createElement("td", { text: "Nenhum lead encontrado.", attrs: { colspan: "5" } }));
      tbody.append(row);
    }
    table.append(tbody);
    tableWrap.replaceChildren(table);
  };
  search.addEventListener("input", renderTable);
  filter.addEventListener("change", renderTable);
  renderTable();
}

function noteOrigin(note) {
  if (note.origin) return String(note.origin);
  if (/origem:\s*site\b/i.test(note.content || "")) return "Site";
  return note.author_id ? "Atendimento" : "Manual";
}

function createLeadHistory(notes, loadingError) {
  const section = createElement("section", { className: "lead-history" });
  section.append(createElement("h3", { text: "Histórico de atendimentos" }));
  if (loadingError) {
    section.append(createElement("p", { className: "lead-history-empty", text: "Não foi possível carregar o histórico agora." }));
    return section;
  }
  if (!notes.length) {
    section.append(createElement("p", { className: "lead-history-empty", text: "Nenhum atendimento registrado ainda." }));
    return section;
  }
  const list = createElement("div", { className: "lead-history-list" });
  notes.forEach(note => {
    const item = createElement("article", { className: "lead-history-item" });
    const meta = createElement("div", { className: "lead-history-meta" });
    meta.append(createElement("strong", { text: noteOrigin(note) }), createElement("span", { text: formatDate(note.created_at, true) }));
    item.append(meta, createElement("p", { text: note.content || "Registro sem conteúdo." }));
    list.append(item);
  });
  section.append(list);
  return section;
}

async function openLeadModal(lead, properties) {
  let historyNotes = [];
  let historyLoadingError = false;
  if (lead) {
    try { historyNotes = await getLeadNotes(lead.id); } catch { historyLoadingError = true; }
  }
  const modal = document.getElementById("crmModal");
  const card = createElement("section", { className: "modal-card" });
  card.append(createElement("h2", { text: lead ? "Editar lead" : "Cadastrar lead" }));
  const form = createElement("form", { className: "crm-form" });
  const fields = [["nome", "Nome", "text", true], ["telefone", "Telefone", "tel", false], ["whatsapp", "WhatsApp", "tel", false], ["email", "E-mail", "email", false], ["origem", "Origem", "text", false], ["responsavel", "Responsável", "text", false], ["orcamento", "Orçamento/faixa", "text", false], ["regiao", "Bairro/região desejada", "text", false], ["proximo_retorno", "Próximo retorno", "datetime-local", false], ["data_visita", "Data da visita", "datetime-local", false]];
  const grid = createElement("div", { className: "form-grid" });
  fields.forEach(([name, label, type, required]) => {
    const labelEl = createElement("label", { text: label });
    const input = createElement("input", { type, attrs: { name, required: required ? "" : null } });
    if (!required) input.removeAttribute("required");
    input.value = leadValue(lead, name);
    labelEl.append(input);
    grid.append(labelEl);
  });
  form.append(grid);
  const propertyLabel = createElement("label", { text: "Imóvel de interesse" });
  const propertySelect = createElement("select", { attrs: { name: "property_code" } });
  propertySelect.append(new Option("Sem imóvel associado", ""));
  properties.forEach(property => propertySelect.append(new Option(`${property.codigo} — ${property.titulo || "Imóvel sem título"}`, property.codigo)));
  propertySelect.value = lead?.property_code || "";
  propertyLabel.append(propertySelect);
  form.append(propertyLabel);
  const stageLabelEl = createElement("label", { text: "Etapa do funil" });
  const stageSelect = createElement("select", { attrs: { name: "stage" } });
  CRM_STAGES.forEach(([value, label]) => stageSelect.append(new Option(label, value)));
  stageSelect.value = lead?.stage || "novo";
  stageLabelEl.append(stageSelect);
  form.append(stageLabelEl);
  const notesLabel = createElement("label", { text: "Observações" });
  const notes = createElement("textarea", { attrs: { name: "notes", placeholder: "Registre informações relevantes" } });
  notes.value = lead?.notes || "";
  notesLabel.append(notes);
  form.append(notesLabel);
  let noteInput = null;
  if (lead) {
    form.append(createLeadHistory(historyNotes, historyLoadingError));
    const noteLabel = createElement("label", { text: "Adicionar observação ao histórico" });
    noteInput = createElement("textarea", { attrs: { name: "new_note", placeholder: "Esta nota será registrada separadamente" } });
    noteLabel.append(noteInput);
    form.append(noteLabel);
  }
  const error = createElement("p", { className: "form-error", attrs: { role: "alert" } });
  form.append(error);
  const actions = createElement("div", { className: "modal-actions" });
  const cancel = createElement("button", { className: "crm-button crm-button-outline", text: "Cancelar", type: "button" });
  cancel.addEventListener("click", closeModal);
  const save = createElement("button", { className: "crm-button crm-button-primary", text: "Salvar lead", type: "submit" });
  actions.append(cancel, save);
  form.append(actions);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.textContent = "";
    const values = new FormData(form);
    const selected = findPropertyByCode(values.get("property_code"));
    const payload = { name: values.get("nome").trim(), phone: values.get("telefone").trim(), whatsapp: values.get("whatsapp").trim(), email: values.get("email").trim(), origin: values.get("origem").trim() || "manual", responsible_name: values.get("responsavel").trim(), property_code: values.get("property_code"), property_title: selected?.titulo || "", budget: values.get("orcamento").trim(), desired_region: values.get("regiao").trim(), notes: values.get("notes").trim(), stage: values.get("stage"), next_follow_up: values.get("proximo_retorno") || null, visit_date: values.get("data_visita") || null };
    if (!lead) payload.entered_at = new Date().toISOString();
    try {
      const saved = lead ? await updateLead(lead.id, payload) : await createLead(payload);
      if (noteInput?.value.trim()) await saveLeadNote(saved.id, noteInput.value.trim());
      closeModal(); showToast("Lead salvo com sucesso."); navigateCrm("leads");
    } catch (err) { error.textContent = err.message || "Não foi possível salvar o lead."; }
  });
  card.append(form);
  modal.replaceChildren(card);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function leadValue(lead, name) {
  if (!lead) return "";
  const map = { nome: "name", telefone: "phone", whatsapp: "whatsapp", email: "email", origem: "origin", responsavel: "responsible_name", orcamento: "budget", regiao: "desired_region", proximo_retorno: "next_follow_up", data_visita: "visit_date" };
  const value = lead[map[name]] || "";
  return name === "proximo_retorno" || name === "data_visita" ? (value ? new Date(value).toISOString().slice(0, 16) : "") : value;
}

async function confirmDeleteLead(lead) {
  if (!window.confirm(`Excluir o lead ${lead.name}? Esta ação não pode ser desfeita.`)) return;
  try { await deleteLead(lead.id); showToast("Lead excluído."); navigateCrm("leads"); }
  catch (err) { showToast(err.message || "Não foi possível excluir.", "error"); }
}

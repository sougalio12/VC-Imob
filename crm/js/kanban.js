/* F.1: one lead store; backend remains the authority for every mutation. */
function filterKanbanLeads(leads, filters = {}) {
  const query = normalizeText(filters.search), digits = query.replace(/\D/g, "");
  return leads.filter(lead => (!filters.stage || lead.stage === filters.stage) &&
    (!filters.origin || lead.origin === filters.origin) &&
    (!filters.assignee || (filters.assignee === "unassigned" ? !lead.assigned_to : lead.assigned_to === filters.assignee)) &&
    (!query || normalizeText([lead.name, lead.phone, lead.whatsapp, lead.property_code, lead.property_title].join(" ")).includes(query) ||
      (digits.length >= 3 && /^[\d\s()+.-]+$/.test(query) && [lead.phone, lead.whatsapp].some(phone => String(phone || "").replace(/\D/g, "").includes(digits)))));
}

function createKanbanStore(initial, persistStage, persistAssignment) {
  let leads = initial.map(lead => ({ ...lead }));
  const pending = new Set(), listeners = new Set();
  const emit = () => listeners.forEach(listener => listener());
  async function mutate(id, patch, persist) {
    if (pending.has(id)) throw new Error("Aguarde a operação atual deste lead.");
    const previous = leads.find(lead => lead.id === id);
    if (!previous) throw new Error("Lead não está mais disponível. Atualize o funil.");
    pending.add(id); leads = leads.map(lead => lead.id === id ? { ...lead, ...patch } : lead); emit();
    try {
      const saved = await persist(previous, patch);
      if (!saved || saved.id !== id) throw new Error("O lead foi alterado ou seu acesso mudou. Atualize o funil.");
      leads = leads.map(lead => lead.id === id ? { ...saved } : lead); return saved;
    } catch (error) { leads = leads.map(lead => lead.id === id ? previous : lead); throw error; }
    finally { pending.delete(id); emit(); }
  }
  return {
    get leads() { return leads.map(lead => ({ ...lead })); }, pending,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    replace(next) { if (pending.size) throw new Error("Aguarde as alterações em andamento."); leads = next.map(lead => ({ ...lead })); emit(); },
    move(id, stage) {
      if (!CRM_STAGES.some(([value]) => value === stage)) return Promise.reject(new Error("Etapa inválida."));
      if (leads.find(lead => lead.id === id)?.stage === stage) return Promise.resolve();
      return mutate(id, { stage }, persistStage);
    },
    assign(id, user) { return mutate(id, { assigned_to: user || null }, persistAssignment); }
  };
}

function kanbanCanOperate(membership, lead, userId) {
  return membership?.status === "active" && (["owner", "manager"].includes(membership.role) ||
    (membership.role === "agent" && lead.assigned_to === userId));
}
function kanbanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? (digits.length <= 11 ? `55${digits}` : digits) : "";
}

// Temporary document listeners support mouse/touch without disabling card scrolling.
function installKanbanDrag(handle, board, canStart, onDrop) {
  let active = false;
  handle.addEventListener("pointerdown", event => {
    if (active || event.button !== 0 || handle.disabled || !canStart()) return;
    active = true;
    const pointer = event.pointerId, start = { x: event.clientX, y: event.clientY };
    let dragging = false, target = null;
    function clean() {
      active = false;
      target?.classList.remove("is-drop-target");
      handle.classList.remove("is-dragging");
      document.removeEventListener("pointermove", track);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", clean);
      window.removeEventListener("blur", clean);
      document.removeEventListener("keydown", cancel);
    }
    function track(move) {
      if (!handle.isConnected) { clean(); return; }
      if (move.pointerId !== pointer) return;
      if (!dragging && Math.hypot(move.clientX - start.x, move.clientY - start.y) < 8) return;
      dragging = true; move.preventDefault(); handle.classList.add("is-dragging");
      const bounds = board.getBoundingClientRect();
      if (move.clientX > bounds.right - 40) board.scrollLeft += 24;
      else if (move.clientX < bounds.left + 40) board.scrollLeft -= 24;
      const next = document.elementFromPoint(move.clientX, move.clientY)?.closest(".kanban-column");
      target?.classList.remove("is-drop-target");
      target = next && board.contains(next) ? next : null;
      target?.classList.add("is-drop-target");
    }
    function release(up) {
      if (up.pointerId !== pointer) return;
      const stage = dragging && handle.isConnected ? target?.dataset.stage : null;
      clean();
      if (stage) onDrop(stage);
    }
    function cancel(key) { if (key.key === "Escape") clean(); }
    document.addEventListener("pointermove", track);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", clean);
    window.addEventListener("blur", clean);
    document.addEventListener("keydown", cancel);
  });
}

async function renderKanban(root) {
  const access = await getKanbanAccess();
  const membership = access || { role: "", status: "unavailable" };
  const userId = isDemoMode() ? "demo-owner" : getStoredSession()?.user?.id;
  const canAssign = membership.status === "active" && ["owner", "manager"].includes(membership.role);
  let [leads, members] = await Promise.all([getKanbanLeads(), canAssign ? getKanbanMembers() : Promise.resolve([])]);
  if (!root.isConnected) return;
  const store = createKanbanStore(leads, (lead, patch) => moveKanbanLead(lead, patch.stage), (lead, patch) => assignKanbanLead(lead.id, patch.assigned_to));
  const filters = { search: "", assignee: "", origin: "", stage: "" }, limits = new Map();
  const memberName = id => !id ? "Sem responsável" : members.find(member => member.user_id === id)?.full_name || (id === userId ? "Você" : "Responsável indisponível");
  root.replaceChildren(); root.classList.add("kanban-view");
  if (!access) root.append(createElement("p", { className: "kanban-deployment-notice", text: "Funil em consulta. As ações F.1 aguardam a atualização segura do banco ou a validação do seu acesso.", attrs: { role: "status" } }));
  const status = createElement("p", { className: "kanban-status", attrs: { role: "status", "aria-live": "polite" } });
  const toolbar = createElement("div", { className: "kanban-filters" }), controls = [];
  let timer, refreshing = false, pendingFocus = null;
  function filterControl(key, label, options) {
    const wrapper = createElement("label", { text: label });
    const control = createElement(options ? "select" : "input", { attrs: { "aria-label": label }, className: "filter-select" });
    if (options) options.forEach(([value, text]) => control.append(new Option(text, value)));
    else { control.type = "search"; control.placeholder = "Nome, telefone ou imóvel"; }
    control.addEventListener(options ? "change" : "input", () => {
      clearTimeout(timer);
      const update = () => { controls.forEach(([key, input]) => { filters[key] = input.value; }); draw(); };
      if (options) update(); else timer = setTimeout(update, 180);
    });
    wrapper.append(control); toolbar.append(wrapper); controls.push([key, control]);
  }
  filterControl("search", "Buscar leads");
  filterControl("assignee", "Responsável", [["", "Todos"], ["unassigned", "Sem responsável"], ...members.map(member => [member.user_id, `${member.full_name || "Membro"}${member.status === "active" ? "" : " (inativo)"}`]), ...(!canAssign ? [[userId, "Você"]] : [])]);
  filterControl("origin", "Origem", [["", "Todas"], ...[...new Set(leads.map(lead => lead.origin).filter(Boolean))].sort().map(origin => [origin, origin])]);
  filterControl("stage", "Etapa", [["", "Todas"], ...CRM_STAGES]);
  function syncFilterOptions() {
    const all = store.leads;
    const assignees = [...new Set([...members.map(member => member.user_id), ...all.map(lead => lead.assigned_to).filter(Boolean)])];
    for (const [key, options] of [["assignee", [["", "Todos"], ["unassigned", "Sem responsável"], ...assignees.map(id => [id, memberName(id)])]], ["origin", [["", "Todas"], ...[...new Set(all.map(lead => lead.origin).filter(Boolean))].sort().map(origin => [origin, origin])]]]) {
      const control = controls.find(([name]) => name === key)[1];
      if (filters[key] && !options.some(([value]) => value === filters[key])) options.push([filters[key], "Filtro anterior (sem leads)"]);
      control.replaceChildren(...options.map(([value, text]) => new Option(text, value)));
      control.value = filters[key];
    }
  }
  syncFilterOptions();
  const clear = createElement("button", { text: "Limpar filtros", type: "button", className: "crm-button crm-button-outline" });
  clear.addEventListener("click", () => { clearTimeout(timer); controls.forEach(([key, control]) => { control.value = ""; filters[key] = ""; }); draw(); });
  const refresh = createElement("button", { text: "Atualizar", type: "button", className: "crm-button crm-button-outline" });
  async function reload() {
    if (store.pending.size || refreshing) return;
    refreshing = true; refresh.disabled = true; status.textContent = "Atualizando funil…";
    try { const [fresh, team] = await Promise.all([getKanbanLeads(), canAssign ? getKanbanMembers() : Promise.resolve([])]); if (root.isConnected) { members = team; store.replace(fresh); syncFilterOptions(); } }
    catch { status.textContent = "Não foi possível atualizar. Os dados anteriores foram preservados. Tente novamente."; }
    finally { refreshing = false; refresh.disabled = false; }
  }
  refresh.addEventListener("click", reload); toolbar.append(clear, refresh);
  root.append(toolbar, createElement("p", { className: "muted", text: "Arraste pela alça ou use a etapa no card. No celular, deslize o funil horizontalmente. Atualize para consultar alterações da equipe." }), status);
  const board = createElement("section", { className: "kanban", attrs: { "aria-label": "Funil de leads", tabindex: "0" } }); root.append(board);
  async function move(id, stage) {
    const lead = store.leads.find(item => item.id === id);
    if (!lead || !kanbanCanOperate(membership, lead, userId) || refreshing) return;
    try { await store.move(id, stage); showToast("Etapa salva."); }
    catch { status.textContent = "A mudança não foi confirmada. A etapa anterior foi restaurada; atualize o funil antes de tentar novamente."; showToast("Não foi possível confirmar a mudança de etapa.", "error"); }
  }
  function draw() {
    if (!root.isConnected) return;
    const focused = document.activeElement?.dataset?.kanbanFocus || pendingFocus;
    pendingFocus = store.pending.size ? focused : null;
    const all = store.leads, filtered = filterKanbanLeads(all, filters);
    status.textContent = store.pending.size ? "Salvando alteração…" : `${filtered.length} de ${all.length} leads${!all.length ? " — nenhum lead disponível para seu acesso." : !filtered.length ? " — nenhum resultado para estes filtros." : "."}`;
    refresh.disabled = store.pending.size > 0 || refreshing; board.replaceChildren();
    // Preserve visibility of unknown legacy stages too.
    const stages = [...CRM_STAGES, ...[...new Set(all.map(lead => lead.stage))].filter(stage => !CRM_STAGES.some(([value]) => value === stage)).map(stage => [stage, `Etapa legada: ${stage}`])];
    stages.forEach(([stage, label]) => {
      if (filters.stage && filters.stage !== stage) return;
      const column = createElement("section", { className: "kanban-column", attrs: { "aria-label": label, "data-stage": stage } });
      const items = filtered.filter(lead => lead.stage === stage), heading = createElement("h2");
      heading.append(createElement("span", { text: label }), createElement("span", { className: "stage", text: String(items.length) })); column.append(heading);
      items.slice(0, limits.get(stage) || 50).forEach(lead => {
        const pending = store.pending.has(lead.id);
        const card = createElement("article", { className: `kanban-card${pending ? " is-saving" : ""}`, attrs: { "aria-label": lead.name, "aria-busy": String(pending) } });
        const top = createElement("div", { className: "kanban-card-heading" });
        const open = createElement("button", { text: lead.name, type: "button", className: "kanban-open", attrs: { "data-kanban-focus": `open-${lead.id}` }, disabled: pending });
        open.addEventListener("click", () => void openKanbanDetail(lead, { store, members, memberName, canAssign, canOperate: kanbanCanOperate(membership, lead, userId), reload, opener: open }));
        const handle = createElement("button", { text: "⠿", type: "button", className: "kanban-handle", attrs: { "aria-label": `Arrastar ${lead.name}; ou use o seletor de etapa` }, disabled: pending || !kanbanCanOperate(membership, lead, userId) });
        installKanbanDrag(handle, board, () => !refreshing && !store.pending.size, stage => void move(lead.id, stage));
        top.append(open, handle); card.append(top);
        if (lead.phone || lead.whatsapp) card.append(createElement("p", { text: lead.phone || lead.whatsapp }));
        if (lead.origin) card.append(createElement("span", { className: "kanban-origin", text: lead.origin }));
        card.append(createElement("p", { text: memberName(lead.assigned_to) }));
        if (lead.property_code || lead.property_title || lead.desired_region) card.append(createElement("p", { text: [lead.property_code, lead.property_title || lead.desired_region].filter(Boolean).join(" · ") }));
        if (lead.next_follow_up) card.append(createElement("p", { className: "kanban-followup", text: `Retorno: ${formatDate(lead.next_follow_up, true)}` }));
        else if (lead.updated_at) card.append(createElement("p", { text: `Atualizado: ${formatDate(lead.updated_at)}` }));
        const select = createElement("select", { attrs: { "aria-label": `Etapa de ${lead.name}`, "data-kanban-focus": `stage-${lead.id}` }, disabled: pending || !kanbanCanOperate(membership, lead, userId) });
        CRM_STAGES.forEach(([value, label]) => select.append(new Option(label, value))); select.value = lead.stage;
        select.addEventListener("change", () => void move(lead.id, select.value)); card.append(select); column.append(card);
      });
      if (!items.length) column.append(createElement("p", { className: "muted", text: "Nenhum lead nesta etapa" }));
      if (items.length > (limits.get(stage) || 50)) { const more = createElement("button", { text: "Mostrar mais 50", type: "button", className: "crm-button crm-button-outline" }); more.addEventListener("click", () => { limits.set(stage, (limits.get(stage) || 50) + 50); draw(); }); column.append(more); }
      board.append(column);
    });
    if (focused) [...board.querySelectorAll("[data-kanban-focus]")].find(el => el.dataset.kanbanFocus === focused)?.focus({ preventScroll: true });
  }
  store.subscribe(draw); draw();
}

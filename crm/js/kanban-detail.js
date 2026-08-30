async function openKanbanDetail(lead, context) {
  const modal = document.getElementById("crmModal");
  const card = createElement("section", { className: "modal-card kanban-detail", attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "kanbanDetailTitle" } });
  const close = createElement("button", { text: "Fechar", type: "button", className: "crm-button crm-button-outline" });
  const finish = () => {
    if (!card.isConnected) return;
    closeModal();
    const key = context.opener?.dataset.kanbanFocus;
    [...document.querySelectorAll("[data-kanban-focus]")].find(el => el.dataset.kanbanFocus === key)?.focus();
  };
  close.addEventListener("click", finish);
  card.append(createElement("h2", { text: lead.name, attrs: { id: "kanbanDetailTitle" } }), close);
  for (const [label, value] of [["Telefone", lead.phone || lead.whatsapp], ["Origem", lead.origin], ["Etapa", stageLabel(lead.stage)], ["Responsável", context.memberName(lead.assigned_to)], ["Interesse", [lead.property_code, lead.property_title || lead.desired_region].filter(Boolean).join(" · ")], ["Observações", lead.notes], ["Próximo retorno", lead.next_follow_up && formatDate(lead.next_follow_up, true)], ["Visita", lead.visit_date && formatDate(lead.visit_date, true)]]) if (value) { const line = createElement("p"); line.append(createElement("strong", { text: `${label}: ` }), document.createTextNode(value)); card.append(line); }
  const phone = kanbanPhone(lead.whatsapp || lead.phone);
  if (phone) { const actions = createElement("div", { className: "kanban-detail-actions" }); actions.append(createElement("a", { text: "WhatsApp ↗", href: `https://wa.me/${phone}`, className: "crm-button crm-button-outline", attrs: { target: "_blank", rel: "noopener noreferrer" } }), createElement("a", { text: "Ligar", href: `tel:+${phone}`, className: "crm-button crm-button-outline" })); card.append(actions); }
  const error = createElement("p", { className: "form-error", attrs: { role: "alert" } });
  let busy = false;
  if (context.canAssign) {
    const label = createElement("label", { text: "Alterar responsável" }); const select = createElement("select", { className: "filter-select", attrs: { "aria-label": "Alterar responsável" } });
    select.append(new Option("Sem responsável", "")); context.members.filter(member => member.status === "active").forEach(member => select.append(new Option(member.full_name || "Membro", member.user_id)));
    if (lead.assigned_to && !context.members.some(member => member.user_id === lead.assigned_to && member.status === "active")) { const option = new Option("Responsável atual não disponível nesta lista", lead.assigned_to); option.disabled = true; select.append(option); }
    select.value = lead.assigned_to || "";
    select.addEventListener("change", async () => { if (busy) { select.value = lead.assigned_to || ""; return; } busy = true; select.disabled = true; error.textContent = ""; try { await context.store.assign(lead.id, select.value); showToast("Responsável salvo."); finish(); } catch { select.value = lead.assigned_to || ""; error.textContent = "A atribuição não foi confirmada. Confira o acesso e atualize o funil."; } finally { busy = false; select.disabled = false; } }); label.append(select); card.append(label);
  }
  const edit = createElement("button", { text: "Editar dados do lead", type: "button", className: "crm-button crm-button-outline" });
  edit.disabled = !context.canOperate;
  edit.addEventListener("click", async () => { if (busy) return; edit.disabled = true; try { const properties = await loadProperties(); if (card.isConnected) await openLeadModal(lead, properties, context.reload); } catch { error.textContent = "Não foi possível abrir a edição."; } finally { edit.disabled = false; } }); card.append(edit);
  const history = createElement("div", { text: "Carregando histórico…", attrs: { "aria-live": "polite" } }); card.append(history);
  const form = createElement("form", { className: "crm-form" }); const label = createElement("label", { text: "Nova nota" }); const note = createElement("textarea", { attrs: { required: "", maxlength: "5000" } }); label.append(note); form.append(label);
  const save = createElement("button", { text: "Salvar nota", type: "submit", className: "crm-button crm-button-primary" }); form.append(save, error); card.append(form);
  save.disabled = !context.canOperate; note.disabled = !context.canOperate;
  async function loadHistory() {
    const [notes, activity] = await Promise.allSettled([getLeadNotes(lead.id), getKanbanActivity(lead.id)]);
    if (!card.isConnected) return;
    history.replaceChildren(createLeadHistory(notes.status === "fulfilled" ? notes.value : [], notes.status === "rejected"));
    history.append(createElement("h3", { text: "Alterações comerciais" }));
    if (activity.status === "rejected") history.append(createElement("p", { className: "muted", text: "Histórico comercial indisponível. Pode exigir a migration F.1; notas e operação do funil continuam independentes." }));
    else if (!activity.value.length) history.append(createElement("p", { className: "muted", text: "Nenhuma alteração comercial registrada." }));
    else activity.value.forEach(event => { const meta = event.metadata || {}; const message = event.action === "lead_stage_changed" ? `Etapa: ${stageLabel(meta.previous_stage)} → ${stageLabel(meta.new_stage)}` : event.action === "lead_note_created" ? "Nota adicionada" : `Responsável: ${context.memberName(meta.previous_assigned_to)} → ${context.memberName(meta.new_assigned_to)}`; history.append(createElement("p", { text: `${formatDate(event.created_at, true)} — ${message}` })); });
  }
  form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !context.canOperate || !note.value.trim()) return; busy = true; save.disabled = true; error.textContent = ""; try { await saveLeadNote(lead.id, note.value.trim()); note.value = ""; showToast("Nota salva."); await loadHistory(); } catch { error.textContent = "Não foi possível confirmar a nota. O texto foi preservado; confira o histórico antes de reenviar."; } finally { busy = false; save.disabled = !context.canOperate; } });
  card.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); finish(); } if (event.key === "Tab") { const elements = [...card.querySelectorAll("button, a, input, select, textarea")].filter(el => !el.disabled); const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
  modal.replaceChildren(card); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); close.focus(); void loadHistory();
}

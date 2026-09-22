const CRM_VIEWS = { dashboard: ["Visão geral", "Acompanhamento comercial"], leads: ["Leads", "Clientes e oportunidades"], kanban: ["Funil", "Etapas das negociações"], properties: ["Imóveis", "Catálogo integrado ao site"], acquisitions:["Captações","Proprietários e novos imóveis"], agenda: ["Agenda", "Retornos, visitas e tarefas"], matching:["Matching","Oportunidades compatíveis"],proposals:["Propostas","Negociações e resultados"],documents:["Documentos","Minutas controladas e versionadas"],reports:["Relatórios","Indicadores para decisão"],assistant:["Assistente VC","Copiloto comercial"],notifications:["Notificações","Ações que pedem atenção"],marketing:["Marketing e ROI","Origem, campanhas e resultados"],"site-status":["Status do site","Integração CRM e catálogo"],settings:["Configurações","Perfil e preferências"], team: ["Equipe", "Pessoas, acessos e responsabilidades"], billing: ["Plano / Assinatura", "Recursos, limites e situação comercial"] };
function stageLabel(value) { return CRM_STAGES.find(([stage]) => stage === value)?.[1] || value; }
function closeModal() { const modal = document.getElementById("crmModal"); modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); modal.replaceChildren(); }
function openDestructiveConfirmation({ title, message, confirmLabel = "Excluir", busyLabel = "Excluindo…", successMessage, fallbackError = "Não foi possível concluir esta ação.", onConfirm }) {
  const modal = document.getElementById("crmModal");
  const card = createElement("section", { className: "modal-card destructive-confirmation", attrs: { role: "alertdialog", "aria-modal": "true" } });
  const error = createElement("p", { className: "form-error", attrs: { role: "alert" } });
  const actions = createElement("div", { className: "modal-actions" });
  const cancel = createElement("button", { type: "button", className: "crm-button crm-button-outline", text: "Cancelar" });
  const confirm = createElement("button", { type: "button", className: "crm-button crm-button-danger", text: confirmLabel });
  cancel.addEventListener("click", closeModal);
  confirm.addEventListener("click", async () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    cancel.disabled = true;
    confirm.textContent = busyLabel;
    error.textContent = "";
    try {
      await onConfirm();
      closeModal();
      if (successMessage) showToast(successMessage);
    } catch (reason) {
      error.textContent = typeof crmFriendlyError === "function" ? crmFriendlyError(reason, fallbackError) : fallbackError;
      confirm.disabled = false;
      cancel.disabled = false;
      confirm.textContent = confirmLabel;
    }
  });
  actions.append(cancel, confirm);
  card.append(createElement("h2", { text: title }), createElement("p", { text: message }), error, actions);
  modal.replaceChildren(card);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  cancel.focus();
}
function toggleSidebar(force) { const sidebar = document.getElementById("crmSidebar"); const backdrop = document.getElementById("crmBackdrop"); const open = force ?? !sidebar.classList.contains("is-open"); sidebar.classList.toggle("is-open", open); backdrop.classList.toggle("is-open", open); }
async function renderCurrentView() {
  const view = document.body.dataset.view || "dashboard";
  // A detached mount prevents an older async render from replacing a newer view.
  const root = createElement("div", { className: `crm-view crm-view-${view}` });
  document.getElementById("crmContent").replaceChildren(root);
  root.append(createElement("p", { className: "muted", text: "Carregando…", attrs: { role: "status" } }));
  try {
    const renderers = { dashboard: renderDashboard, leads: renderLeads, kanban: renderKanban, properties: renderProperties, acquisitions:renderAcquisitions, agenda: renderAgenda, matching:renderMatchingCenter,proposals:renderProposals,documents:renderDocuments,reports:renderReports,assistant:renderAssistant,notifications:renderNotifications,marketing:renderMarketing,"site-status":renderSiteStatus,settings:renderSettings, team: renderTeam, billing: renderBilling };
    await renderers[view]?.(root); root.classList.add("is-ready");
  } catch (error) {
    const retry = createElement("button", { text: "Tentar novamente", type: "button", className: "crm-button crm-button-primary" });
    retry.addEventListener("click", renderCurrentView);
    root.replaceChildren(createEmptyState("Não foi possível carregar esta área", "Verifique sua conexão e seu acesso à organização.", retry));
  }
}
function navigateCrm(view, options = {}) { if (!CRM_VIEWS[view]) return; document.body.dataset.view = view; document.getElementById("pageTitle").textContent = CRM_VIEWS[view][0]; document.getElementById("pageEyebrow").textContent = CRM_VIEWS[view][1]; document.querySelectorAll("[data-view-link]").forEach(button => { const active = button.dataset.viewLink === view; button.classList.toggle("is-active", active); if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); }); const more = document.getElementById("mobileMoreButton"); const secondaryView = !["dashboard", "leads", "kanban", "agenda"].includes(view); more?.classList.toggle("is-active", secondaryView); if (secondaryView) more?.setAttribute("aria-current", "page"); else more?.removeAttribute("aria-current"); if (!options.preserveHistory && window.location.hash !== `#${view}`) window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${view}`); toggleSidebar(false); more?.setAttribute("aria-expanded", "false"); renderCurrentView(); }
document.addEventListener("DOMContentLoaded", async () => {
  if (!await requireCrmSession()) return;

  const invitationToken = new URLSearchParams(window.location.search).get("invitation");
  if (invitationToken) {
    try {
      await acceptTeamInvitation(invitationToken);
      window.history.replaceState({}, "", window.location.pathname);
      resetOrganizationContext();
      showToast("Convite aceito. Bem-vindo à equipe!");
    } catch (error) {
      const root = document.getElementById("crmContent");
      root.replaceChildren(createEmptyState("Convite não aceito", error.message || "O convite é inválido, expirou ou não pertence a este e-mail."));
      return;
    }
  }

  document.getElementById("logoutButton").addEventListener("click", logoutCrm);
  try {
    await initializeOrganizationContext();
  } catch (error) {
    const root = document.getElementById("crmContent");
    const logout = createElement("button", { className: "crm-button crm-button-primary", text: "Sair", type: "button" });
    logout.addEventListener("click", logoutCrm);
    root.replaceChildren(createEmptyState("Acesso à organização indisponível", error.message || "Não foi possível validar sua organização.", logout));
    return;
  }

  document.getElementById("demoBadge").hidden = !isDemoMode();
  const membership = await getActiveMembership();
  const accessState = await getMyAccessState().catch(() => ({ status: "expired", is_entitled: false }));
  if (!accessState.is_entitled && !isDemoMode()) {
    document.body.classList.add("is-restricted");
    document.querySelectorAll('[data-view-link]:not([data-view-link="billing"])').forEach(item => { item.hidden = true; });
    document.getElementById("quickLeadButton").hidden = true;
  }
  document.getElementById("teamNavigation").hidden = !["owner", "manager"].includes(membership.role);
  document.getElementById("billingNavigation").hidden = false;
  document.querySelectorAll("[data-view-link]").forEach(button => button.addEventListener("click", () => navigateCrm(button.dataset.viewLink)));
  document.getElementById("quickLeadButton").addEventListener("click", openQuickCreate);
  document.getElementById("globalSearchButton").addEventListener("click", openGlobalSearch);
  document.getElementById("notificationButton").addEventListener("click", () => navigateCrm("notifications"));
  document.getElementById("menuToggle").addEventListener("click", () => toggleSidebar());
  document.getElementById("crmBackdrop").addEventListener("click", () => toggleSidebar(false));
  document.getElementById("crmModal").addEventListener("click", event => { if (event.target.id === "crmModal") closeModal(); });
  const initialView = window.location.hash.slice(1);
  if (!accessState.is_entitled && !isDemoMode()) navigateCrm("billing", { preserveHistory: true });
  else if (CRM_VIEWS[initialView]) navigateCrm(initialView, { preserveHistory: true });
  else await renderCurrentView();
});

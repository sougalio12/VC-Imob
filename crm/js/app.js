const CRM_VIEWS = { dashboard: ["Visão geral", "Acompanhamento comercial"], leads: ["Leads", "Clientes e oportunidades"], kanban: ["Funil", "Etapas das negociações"], properties: ["Imóveis", "Catálogo do site público"], agenda: ["Agenda", "Retornos e visitas"], team: ["Equipe", "Pessoas, acessos e responsabilidades"] };
function stageLabel(value) { return CRM_STAGES.find(([stage]) => stage === value)?.[1] || value; }
function closeModal() { const modal = document.getElementById("crmModal"); modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); modal.replaceChildren(); }
function toggleSidebar(force) { const sidebar = document.getElementById("crmSidebar"); const backdrop = document.getElementById("crmBackdrop"); const open = force ?? !sidebar.classList.contains("is-open"); sidebar.classList.toggle("is-open", open); backdrop.classList.toggle("is-open", open); }
async function renderCurrentView() { const view = document.body.dataset.view || "dashboard"; const root = document.getElementById("crmContent"); root.replaceChildren(createElement("p", { className: "muted", text: "Carregando…" })); try { if (view === "dashboard") await renderDashboard(root); if (view === "leads") await renderLeads(root); if (view === "kanban") await renderKanban(root); if (view === "properties") await renderProperties(root); if (view === "agenda") await renderAgenda(root); if (view === "team") await renderTeam(root); } catch (error) { root.replaceChildren(createEmptyState("Não foi possível carregar esta área", error.message || "Verifique sua conexão e tente novamente.")); } }
function navigateCrm(view) { if (!CRM_VIEWS[view]) return; document.body.dataset.view = view; document.getElementById("pageTitle").textContent = CRM_VIEWS[view][0]; document.getElementById("pageEyebrow").textContent = CRM_VIEWS[view][1]; document.querySelectorAll("[data-view-link]").forEach(button => button.classList.toggle("is-active", button.dataset.viewLink === view)); toggleSidebar(false); renderCurrentView(); }
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
  document.getElementById("teamNavigation").hidden = !["owner", "manager"].includes(membership.role);
  document.querySelectorAll("[data-view-link]").forEach(button => button.addEventListener("click", () => navigateCrm(button.dataset.viewLink)));
  document.getElementById("quickLeadButton").addEventListener("click", async () => { try { openLeadModal(null, await loadProperties()); } catch (error) { showToast(error.message, "error"); } });
  document.getElementById("menuToggle").addEventListener("click", () => toggleSidebar());
  document.getElementById("crmBackdrop").addEventListener("click", () => toggleSidebar(false));
  document.getElementById("crmModal").addEventListener("click", event => { if (event.target.id === "crmModal") closeModal(); });
  await renderCurrentView();
});

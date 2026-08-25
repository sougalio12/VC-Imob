async function renderDashboard(root) {
  const leads = await getLeads();
  const today = startOfToday();
  const counts = Object.fromEntries(CRM_STAGES.map(([stage]) => [stage, leads.filter(lead => lead.stage === stage).length]));
  const returnsToday = leads.filter(lead => lead.next_follow_up && new Date(lead.next_follow_up).toDateString() === today.toDateString());
  const nextReturns = leads.filter(lead => lead.next_follow_up && new Date(lead.next_follow_up) >= today).sort((a, b) => new Date(a.next_follow_up) - new Date(b.next_follow_up)).slice(0, 5);

  root.replaceChildren();
  const metrics = createElement("section", { className: "metric-grid" });
  [["Leads novos", counts.novo], ["Em atendimento", counts.atendimento], ["Visitas agendadas", counts.visita], ["Em negociação", counts.negociacao], ["Fechados", counts.fechado], ["Retornos de hoje", returnsToday.length]].forEach(([label, value]) => {
    const card = createElement("article", { className: "metric-card" }); card.append(createElement("span", { text: label }), createElement("strong", { text: String(value) })); metrics.append(card);
  });
  root.append(metrics);

  const grid = createElement("section", { className: "crm-grid" });
  grid.append(createLeadPanel("Próximos retornos", nextReturns, "agenda"), createLeadPanel("Últimos leads", leads.slice(0, 5), "leads"));
  root.append(grid);
}

function createLeadPanel(title, leads, destination) {
  const panel = createElement("section", { className: "crm-panel" });
  const heading = createElement("div", { className: "panel-heading" });
  const link = createElement("a", { text: "Ver todos", href: `#${destination}` });
  link.addEventListener("click", event => { event.preventDefault(); navigateCrm(destination); });
  heading.append(createElement("h2", { text: title }), link); panel.append(heading);
  if (!leads.length) { panel.append(createElement("p", { className: "muted", text: "Nenhum item para exibir." })); return panel; }
  leads.forEach(lead => { const row = createElement("div", { className: "lead-row" }); const info = createElement("div"); info.append(createElement("strong", { text: lead.name }), createElement("span", { text: lead.property_title || lead.desired_region || "Sem imóvel associado" })); row.append(info, createElement("span", { className: `stage stage-${lead.stage}`, text: stageLabel(lead.stage) })); panel.append(row); });
  return panel;
}

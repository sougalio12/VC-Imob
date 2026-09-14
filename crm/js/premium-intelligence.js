const CRM_DAY_MS = 86_400_000;

function crmDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function crmDayStart(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function crmDaysSince(value, now = new Date()) {
  const date = crmDate(value);
  return date ? Math.max(0, Math.floor((now - date) / CRM_DAY_MS)) : null;
}

function isOpenProposal(proposal) {
  return ["draft", "sent", "negotiating"].includes(proposal?.status);
}

function leadNextBestAction(lead, activities = [], proposals = [], matches = [], now = new Date()) {
  const openActivities = activities
    .filter(item => item.lead_id === lead.id && item.status === "agendado")
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const overdue = openActivities.find(item => crmDate(item.scheduled_at) < now);
  if (overdue) return { action: "Retomar contato hoje", reason: `O ${activityKindLabel(overdue.kind).toLowerCase()} está atrasado.`, view: "agenda", weight: 100 };

  const openProposal = proposals
    .filter(item => item.lead_id === lead.id && isOpenProposal(item))
    .sort((a, b) => new Date(b.updated_at || b.proposal_date) - new Date(a.updated_at || a.proposal_date))[0];
  if (openProposal) {
    const idleDays = crmDaysSince(openProposal.updated_at || openProposal.proposal_date, now);
    return { action: idleDays >= 3 ? "Atualizar a negociação hoje" : "Acompanhar a proposta", reason: idleDays >= 3 ? `A proposta está sem atualização há ${idleDays} dias.` : "Existe uma proposta em andamento.", view: "proposals", weight: idleDays >= 3 ? 95 : 82 };
  }

  const today = crmDayStart(now), tomorrow = new Date(today.getTime() + CRM_DAY_MS);
  const visitToday = openActivities.find(item => item.kind === "visita" && crmDate(item.scheduled_at) >= today && crmDate(item.scheduled_at) < tomorrow);
  if (visitToday) return { action: "Preparar a visita", reason: `Visita marcada para ${formatDate(visitToday.scheduled_at, true)}.`, view: "agenda", weight: 90 };

  if (openActivities[0]) return { action: "Cumprir o próximo passo agendado", reason: `${activityKindLabel(openActivities[0].kind)} em ${formatDate(openActivities[0].scheduled_at, true)}.`, view: "agenda", weight: 60 };
  if (!lead.assigned_to) return { action: "Definir um responsável", reason: "O lead ainda está sem responsável.", view: "leads", weight: 58 };
  if (matches.length) return { action: "Apresentar um imóvel compatível", reason: `${matches[0].property.codigo} possui ${matches[0].compatibility}% de compatibilidade.`, view: "matching", weight: 56 };

  const idleDays = crmDaysSince(lead.updated_at || lead.created_at, now);
  if (idleDays !== null && idleDays >= 7) return { action: "Retomar contato", reason: `O lead está sem atualização há ${idleDays} dias.`, view: "leads", weight: Math.min(80, 45 + idleDays) };
  return { action: "Definir o próximo passo", reason: "Não existe atividade futura registrada.", view: "agenda", weight: 38 };
}

function buildOperationalOpportunities({ leads = [], activities = [], proposals = [], interests = [], properties = [] }, now = new Date()) {
  return leads
    .filter(lead => !["fechado", "perdido"].includes(lead.stage))
    .map(lead => {
      const leadActivities = activities.filter(item => item.lead_id === lead.id);
      const leadInterests = interests.filter(item => item.lead_id === lead.id);
      const matches = typeof matchProperties === "function" ? matchProperties(lead, properties).filter(match => match.compatibility >= 50).slice(0, 3) : [];
      const next = leadNextBestAction(lead, leadActivities, proposals, matches, now);
      const score = typeof scoreLead === "function" ? scoreLead(lead, leadActivities, leadInterests, now) : { score: 0, label: "Não calculado" };
      const priority = next.weight >= 80 ? "Alta" : next.weight >= 50 ? "Média" : "Baixa";
      return { lead, priority, weight: next.weight, action: next.action, reason: next.reason, view: next.view, score, matches };
    })
    .sort((a, b) => b.weight - a.weight || b.score.score - a.score.score || String(a.lead.name).localeCompare(String(b.lead.name), "pt-BR"));
}

function buildMyDay({ leads = [], activities = [], proposals = [], interests = [], properties = [] }, now = new Date()) {
  const today = crmDayStart(now), tomorrow = new Date(today.getTime() + CRM_DAY_MS), afterTomorrow = new Date(tomorrow.getTime() + CRM_DAY_MS);
  const open = activities.filter(item => item.status === "agendado");
  const todayItems = open.filter(item => { const date = crmDate(item.scheduled_at); return date && date >= today && date < tomorrow; });
  const tomorrowItems = open.filter(item => { const date = crmDate(item.scheduled_at); return date && date >= tomorrow && date < afterTomorrow; });
  const opportunities = buildOperationalOpportunities({ leads, activities, proposals, interests, properties }, now);
  return {
    visits: todayItems.filter(item => item.kind === "visita").length,
    followUps: todayItems.filter(item => item.kind === "retorno").length,
    tasks: todayItems.filter(item => item.kind === "tarefa").length,
    overdue: open.filter(item => crmDate(item.scheduled_at) < now).length,
    tomorrow: tomorrowItems.length,
    openProposals: proposals.filter(isOpenProposal).length,
    opportunities
  };
}

function crmRecordDate(record, preferred) {
  return crmDate(record?.[preferred] || record?.created_at || record?.updated_at);
}

function filterPeriod(items, start, end, preferred) {
  return items.filter(item => { const date = crmRecordDate(item, preferred); return date && date >= start && date < end; });
}

function calculateCommercialPeriod({ leads = [], activities = [], proposals = [] }, start, end) {
  const periodLeads = filterPeriod(leads, start, end, "created_at");
  const periodActivities = filterPeriod(activities, start, end, "scheduled_at");
  const periodProposals = filterPeriod(proposals, start, end, "proposal_date");
  const closed = periodLeads.filter(item => item.stage === "fechado");
  const accepted = periodProposals.filter(item => item.status === "accepted");
  return {
    leads: periodLeads.length,
    closed: closed.length,
    conversion: periodLeads.length ? closed.length * 100 / periodLeads.length : null,
    visits: periodActivities.filter(item => item.kind === "visita" && item.status !== "cancelado").length,
    followUps: periodActivities.filter(item => item.kind === "retorno" && item.status !== "cancelado").length,
    proposals: periodProposals.length,
    vgv: accepted.reduce((sum, item) => sum + Number(item.final_price || item.proposed_price || 0), 0),
    expectedCommission: accepted.reduce((sum, item) => sum + Number(item.commission_expected || 0), 0)
  };
}

function compareMetric(current, previous, { percentValue = false } = {}) {
  if (current == null || previous == null) return { text: "Amostra insuficiente", trend: "neutral" };
  if (previous === 0) return current === 0 ? { text: "Sem variação", trend: "neutral" } : { text: "Sem base anterior", trend: "neutral" };
  const delta = percentValue ? current - previous : (current - previous) * 100 / Math.abs(previous);
  const rounded = Math.round(delta * 10) / 10;
  return { text: `${rounded > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(rounded)}${percentValue ? " p.p." : "%"}`, trend: rounded > 0 ? "up" : rounded < 0 ? "down" : "neutral", delta: rounded };
}

function buildPeriodComparison(data, days = 30, now = new Date()) {
  const end = new Date(now), currentStart = new Date(end.getTime() - days * CRM_DAY_MS), previousStart = new Date(currentStart.getTime() - days * CRM_DAY_MS);
  const current = calculateCommercialPeriod(data, currentStart, end), previous = calculateCommercialPeriod(data, previousStart, currentStart);
  return { days, current, previous, changes: {
    leads: compareMetric(current.leads, previous.leads),
    closed: compareMetric(current.closed, previous.closed),
    conversion: compareMetric(current.conversion, previous.conversion, { percentValue: true }),
    visits: compareMetric(current.visits, previous.visits),
    proposals: compareMetric(current.proposals, previous.proposals),
    vgv: compareMetric(current.vgv, previous.vgv)
  } };
}

function buildDemandRadar(leads = [], properties = []) {
  const demand = new Map();
  leads.filter(lead => !["fechado", "perdido"].includes(lead.stage)).forEach(lead => {
    const typeLabel = String(lead.preference_property_type || "").trim(), regionLabel = String(lead.desired_region || lead.preference_city || "").trim();
    if (!typeLabel && !regionLabel) return;
    const type = normalizeText(typeLabel), region = normalizeText(regionLabel), key = `${type}|${region}`;
    const current = demand.get(key) || { label: [typeLabel, regionLabel].filter(Boolean).join(" · "), type, region, count: 0, leadIds: [] };
    current.count += 1; current.leadIds.push(lead.id); demand.set(key, current);
  });
  return [...demand.values()].map(item => {
    const matchingStock = properties.filter(property => {
      const type = normalizeText(property.tipo), place = normalizeText([property.bairro, property.cidade].join(" "));
      return (!item.type || type.includes(item.type) || item.type.includes(type)) && (!item.region || place.includes(item.region));
    }).length;
    return { ...item, matchingStock };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

function safeCsvCell(value) {
  let text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function recordsToCsv(columns, rows) {
  const header = columns.map(column => safeCsvCell(column.label)).join(";");
  const body = rows.map(row => columns.map(column => safeCsvCell(typeof column.value === "function" ? column.value(row) : row[column.value])).join(";")).join("\r\n");
  return `\uFEFF${header}${body ? `\r\n${body}` : ""}`;
}

function downloadCsvFile(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

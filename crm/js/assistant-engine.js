const ASSISTANT_MAX_INPUT = 500;

function buildWhatsAppLink(phone, message = "") {
  const digits = normalizePhone(phone);
  const international = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${international}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

function assistantCleanText(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ASSISTANT_MAX_INPUT);
}

function assistantLocalDate(text, now = new Date()) {
  const source = normalizeText(text), date = new Date(now); date.setSeconds(0, 0);
  if (source.includes("amanha")) date.setDate(date.getDate() + 1);
  const iso = source.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (iso) date.setFullYear(iso[3] ? Number(iso[3].length === 2 ? `20${iso[3]}` : iso[3]) : date.getFullYear(), Number(iso[2]) - 1, Number(iso[1]));
  const time = source.match(/(?:as|às)?\s*(\d{1,2})(?::|h)(\d{2})?/);
  if (time) date.setHours(Number(time[1]), Number(time[2] || 0), 0, 0); else date.setHours(9, 0, 0, 0);
  return date;
}

function parseAssistantCommand(raw, { leads = [], properties = [], now = new Date() } = {}) {
  const text = assistantCleanText(raw), normalized = normalizeText(text);
  if (!text) return { kind: "unknown", confidence: 0, error: "Digite um comando." };
  if (/\b(apague|delete|exclua|mude.*plano|billing|entitlement|permissao|proprietario)\b/.test(normalized)) return { kind: "blocked", confidence: 1, error: "Esse tipo de ação não pode ser executado pelo Assistente VC." };
  if (/\b(mostre|liste|quais|quem|quanto|como)\b/.test(normalized)) return { kind: "query", confidence: .9, query: text, mutating: false };
  const lead = leads.find(item => normalized.includes(normalizeText(item.name))) || null;
  const property = properties.find(item => normalized.includes(normalizeText(item.codigo)) || normalized.includes(normalizeText(item.titulo))) || null;
  if (/\b(crie|cadastre|registre)\s+(?:um\s+)?lead\b/.test(normalized)) {
    const nameMatch = text.match(/(?:crie|cadastre|registre)\s+(?:um\s+)?lead\s+(.+?)(?=\s+(?:com\s+)?(?:telefone|fone|whatsapp|e-?mail)\b|$)/i);
    const phoneMatch = text.match(/(?:telefone|fone|whatsapp)\s*(?:é|:)?\s*([+\d(][\d\s().-]{8,})/i);
    const emailMatch = text.match(/(?:e-?mail)\s*(?:é|:)?\s*([^\s,;]+@[^\s,;]+)/i);
    const name = assistantCleanText(nameMatch?.[1]), phone = normalizePhone(phoneMatch?.[1]);
    if (name.length < 2 || !/^\d{10,11}$/.test(phone)) return { kind: "create_lead", confidence: .5, error: "Informe o nome e um telefone brasileiro válido para preparar o lead." };
    return { kind: "create_lead", confidence: .94, mutating: true, label: `Novo lead ${name} · ${formatPhone(phone)}`, payload: { name, phone, whatsapp: phone, email: emailMatch?.[1] || null, origin: "manual", stage: "novo" } };
  }
  if (/\b(agende|marque|crie).*(visita|retorno|follow.?up|tarefa)\b/.test(normalized)) {
    const kind = normalized.includes("visita") ? "visita" : /retorno|follow/.test(normalized) ? "retorno" : "tarefa";
    if (!lead) return { kind: "create_activity", confidence: .55, error: "Escolha um lead antes de preparar a atividade." };
    return { kind: "create_activity", confidence: .95, mutating: true, label: `${activityKindLabel(kind)} para ${lead.name}`, payload: { lead_id: lead.id, kind, title: `${activityKindLabel(kind)} — ${lead.name}`, scheduled_at: assistantLocalDate(text, now).toISOString(), priority: 2, notes: `Solicitado pelo usuário: ${text}` } };
  }
  if (/\b(crie|registre).*(proposta)\b/.test(normalized)) {
    const amount = parseBrlNumber(text.match(/(?:r\$\s*)?[\d.]+(?:,\d{1,2})?/i)?.[0] || "");
    if (!lead || !Number.isFinite(amount) || amount <= 0) return { kind: "create_proposal", confidence: .5, error: "Informe um lead e um valor válido para preparar a proposta." };
    return { kind: "create_proposal", confidence: .92, mutating: true, label: `Proposta para ${lead.name}`, payload: { lead_id: lead.id, property_id: property?._row?.id || property?.id || null, proposed_price: amount, proposal_date: now.toISOString().slice(0,10), notes: `Solicitado pelo usuário: ${text}` } };
  }
  return { kind: "unknown", confidence: .2, error: "Não consegui interpretar com segurança. Tente pedir uma visita, retorno, tarefa ou proposta mencionando o lead." };
}

function buildLeadCommercialSummary(lead, { activities = [], interests = [], proposals = [], memory = [], properties = [] } = {}, now = new Date()) {
  const ownActivities = activities.filter(item => item.lead_id === lead.id), ownProposals = proposals.filter(item => item.lead_id === lead.id);
  const next = leadNextBestAction(lead, ownActivities, ownProposals, matchProperties(lead, properties), now);
  const last = ownActivities.slice().sort((a,b)=>new Date(b.updated_at||b.created_at||b.scheduled_at)-new Date(a.updated_at||a.created_at||a.scheduled_at))[0];
  return { name: lead.name, stage: stageLabel(lead.stage), budget: lead.budget || null, region: lead.desired_region || lead.preference_city || null,
    interests: interests.filter(item=>item.lead_id===lead.id).length, visits: ownActivities.filter(item=>item.kind==="visita").length,
    proposals: ownProposals.length, openProposals: ownProposals.filter(isOpenProposal).length, lastContact: last?.updated_at||last?.created_at||last?.scheduled_at||null,
    objections: memory.filter(item=>item.memory_kind==="objection"&&!item.archived_at).map(item=>item.content), nextAction: next };
}

function assistantMessageTemplate(kind, { lead, property, nextAction } = {}) {
  const name = assistantCleanText(lead?.name).split(" ")[0] || "cliente", title = property ? `${property.codigo} — ${property.titulo}` : "o imóvel selecionado";
  const templates = {
    first_contact:`Olá, ${name}! Sou corretor(a) da VC Imob. Recebi seu contato e gostaria de entender melhor o imóvel que você procura. Podemos conversar?`,
    follow_up:`Olá, ${name}! Retomando nosso contato sobre ${title}. Posso ajudar com alguma informação ou organizar o próximo passo?`,
    post_visit:`Olá, ${name}! Obrigado pela visita. O que você achou do imóvel? Seus pontos positivos e dúvidas vão me ajudar a selecionar as melhores opções.`,
    recovery:`Olá, ${name}! Surgiram novas oportunidades que podem combinar com o que você procura. Posso preparar uma seleção atualizada para você?`,
    property:`Olá, ${name}! Separei ${title}, que pode combinar com suas preferências. Confira os detalhes e me diga o que achou.`,
    negotiation:`Olá, ${name}! Estou acompanhando sua negociação e fico à disposição para alinharmos ${nextAction || "os próximos passos"}.`,
    thanks:`Olá, ${name}! Obrigado pelo retorno e pela confiança. Quando precisar, estou à disposição.`
  };
  return templates[kind] || templates.follow_up;
}

function buildPropertyAdDraft(property) {
  const facts = [property.tipo, property.bairro || property.cidade].filter(Boolean).join(" em "), details = [];
  if (property.quartos != null) details.push(`${property.quartos} quarto(s)`); if (property.banheiros != null) details.push(`${property.banheiros} banheiro(s)`);
  if (property.areaConstruida || property.areaTotal) details.push(`${property.areaConstruida || property.areaTotal} m²`);
  return { title: property.titulo || [facts, property.codigo].filter(Boolean).join(" — "), summary: [facts, details.join(", ")].filter(Boolean).join(". "), highlights: (property.caracteristicas||[]).slice(0,6), whatsapp: `Conheça ${property.codigo} — ${property.titulo}. ${property.preco ? `Valor: ${formatPrice(property.preco)}.` : ""}`.trim() };
}

function buildPortfolioIntelligence(leads = [], properties = []) {
  const demand = buildDemandRadar(leads, properties);
  return demand.map(item => ({ ...item, signal: item.count >= 2 && item.matchingStock === 0 ? "demanda_sem_estoque" : item.matchingStock > item.count * 3 ? "estoque_acima_demanda" : "equilibrado",
    insight: item.count >= 2 && item.matchingStock === 0 ? `${item.count} clientes procuram ${item.label}, sem estoque compatível.` : item.matchingStock > item.count * 3 ? `${item.matchingStock} imóveis atendem apenas ${item.count} demanda(s) registrada(s).` : `Demanda e estoque registrados para ${item.label}.` }));
}

function buildFinancialPipeline(proposals = [], now = new Date()) {
  const month = now.getMonth(), year = now.getFullYear(), accepted = proposals.filter(item=>item.status==="accepted"), open = proposals.filter(isOpenProposal);
  const money = (items,key) => items.reduce((sum,item)=>sum+Number(item[key]||0),0);
  return { openCount:open.length, negotiationValue:open.reduce((sum,item)=>sum+Number(item.counter_price||item.proposed_price||0),0), closedCount:accepted.length,
    vgv:accepted.reduce((sum,item)=>sum+Number(item.final_price||item.proposed_price||0),0), expectedCommission:money(accepted,"commission_expected"), receivedCommission:money(accepted,"commission_received"),
    pendingCommission:Math.max(0,money(accepted,"commission_expected")-money(accepted,"commission_received")), monthlyForecast:accepted.filter(item=>{const d=new Date(item.closed_at||item.proposal_date);return d.getMonth()===month&&d.getFullYear()===year;}).reduce((sum,item)=>sum+Number(item.commission_expected||0),0) };
}

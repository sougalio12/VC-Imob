const BILLING_STATUS_LABELS = { trialing: "Período de teste", active: "Ativa", past_due: "Pagamento pendente", grace_period: "Período de tolerância", canceled: "Cancelada no fim do período", expired: "Expirada", refunded: "Reembolsada", revoked: "Revogada" };
function billingDate(value) { return value ? formatDate(value, true) : "Sem data definida"; }
function billingMoney(cents, currency) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format((cents || 0) / 100); }
function appendAccountActions(root, membership) {
  const account = createElement("section", { className: "crm-panel account-actions" });
  account.append(createElement("h2", { text: "Conta e privacidade" }), createElement("p", { className: "muted", text: "Você pode solicitar o encerramento da conta. Dados comerciais permanecem protegidos pela organização e owners únicos passam por revisão." }));
  const links = createElement("p");
  links.innerHTML = '<a href="./privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> · <a href="./termos.html" target="_blank" rel="noopener">Termos de Uso</a> · <a href="./exclusao-de-conta.html" target="_blank" rel="noopener">Como funciona a exclusão</a>';
  const request = createElement("button", { className: "crm-button crm-button-outline", text: "Solicitar exclusão da conta", type: "button" });
  request.addEventListener("click", async () => {
    if (!window.confirm("Deseja iniciar a solicitação de exclusão? Esta ação pode desativar seu acesso à organização.")) return;
    request.disabled = true;
    try { const result = await requestMyAccountDeletion(); showToast(result?.request_scope === "organization" ? "Solicitação de encerramento enviada para revisão." : "Solicitação de exclusão registrada."); if (result?.access_revoked) await logoutCrm(); }
    catch (error) { showToast(error.message || "Não foi possível registrar a solicitação.", "error"); request.disabled = false; }
  });
  account.append(links, request);
  if (membership.role === "owner") account.append(createElement("p", { className: "muted", text: "Um owner único não é removido automaticamente: isso evita deixar a organização sem responsável." }));
  root.append(account);
}
async function renderBilling(root) {
  const membership = await getActiveMembership();
  if (!["owner", "manager"].includes(membership.role)) { root.replaceChildren(createEmptyState("Conta", "A assinatura é administrada pelo owner ou manager da organização.")); appendAccountActions(root, membership); return; }
  const { subscription, entitlements, plans } = await getBillingOverview();
  if (!subscription) { root.replaceChildren(createEmptyState("Assinatura indisponível", "Não encontramos uma assinatura atual para esta organização.")); appendAccountActions(root, membership); return; }
  root.replaceChildren();
  if (!subscription.is_entitled) root.append(createElement("section", { className: "restricted-banner", text: "O acesso comercial está pausado. Seus dados permanecem preservados; escolha um plano para reativar o CRM." }));
  root.append(createElement("p", { className: "muted", text: "Enquanto os provedores comerciais não estiverem configurados, nenhuma cobrança é iniciada nesta tela." }));
  const summary = createElement("section", { className: "billing-summary" }); const main = createElement("article", { className: "crm-panel" });
  main.append(createElement("span", { className: subscription.is_entitled ? "billing-status" : "billing-status is-danger", text: BILLING_STATUS_LABELS[subscription.status] || subscription.status }), createElement("h2", { text: `Plano ${subscription.plan_name}` }));
  const end = subscription.status === "trialing" ? subscription.trial_ends_at : subscription.current_period_ends_at;
  main.append(createElement("p", { className: "muted", text: subscription.status === "trialing" ? `Seu trial de 7 dias termina em ${billingDate(end)}.` : `Período atual até ${billingDate(end)}.` }));
  if (subscription.cancel_at_period_end) main.append(createElement("p", { className: "billing-status is-warning", text: "Cancelamento programado para o fim do período" }));
  const seats = entitlements.find(item => item.entitlement_key === "team.members"); const usage = createElement("article", { className: "crm-panel" }); usage.append(createElement("h2", { text: "Uso da equipe" }), createElement("strong", { className: "plan-price", text: `${seats?.used_value || 0} / ${seats?.limit_value ?? "∞"}` }), createElement("p", { className: "muted", text: "Membros ativos e desativados ocupam vagas." })); summary.append(main, usage); root.append(summary);
  const toggle = createElement("div", { className: "billing-cycle", attrs: { role: "group", "aria-label": "Período de cobrança" } });
  const monthly = createElement("button", { className: "crm-button crm-button-outline", text: "Mensal", type: "button", attrs: { "aria-pressed": "true" } }); const annual = createElement("button", { className: "crm-button crm-button-outline", text: "Anual", type: "button", attrs: { "aria-pressed": "false" } }); toggle.append(monthly, annual); root.append(toggle);
  annual.hidden = !plans.every(plan => Number.isInteger(plan.annual_price_cents));
  const grid = createElement("section", { className: "plan-grid", attrs: { "aria-label": "Planos disponíveis" } }); root.append(grid);
  const paintPlans = interval => { grid.replaceChildren(); plans.forEach(plan => { const cents = interval === "year" ? plan.annual_price_cents : plan.monthly_price_cents; const card = createElement("article", { className: `plan-card${plan.plan_code === subscription.plan_code ? " is-current" : ""}` }); card.append(createElement("h2", { text: plan.plan_name }), createElement("p", { className: "plan-price", text: `${billingMoney(cents, plan.currency)}/${interval === "year" ? "ano" : "mês"}` })); if (interval === "year") card.append(createElement("p", { className: "plan-saving", text: "2 meses grátis no anual" })); if (subscription.status === "trialing") card.append(createElement("p", { className: "muted", text: "7 dias grátis. A cobrança só começa após contratação confirmada no canal escolhido." })); const list = document.createElement("ul"); list.append(createElement("li", { text: `${plan.team_member_limit ?? "Ilimitadas"} vaga(s) de equipe` }), createElement("li", { text: "Dados preservados em mudanças de plano" })); card.append(list); const action = createElement("button", { className: "crm-button crm-button-primary", text: plan.plan_code === subscription.plan_code ? "Plano atual" : "Escolher plano", type: "button", disabled: plan.plan_code === subscription.plan_code }); action.addEventListener("click", () => beginSubscriptionCheckout({ plan: plan.plan_code, interval, localizedPrice: billingMoney(cents, plan.currency) })); card.append(action); grid.append(card); }); };
  monthly.addEventListener("click", () => { monthly.setAttribute("aria-pressed", "true"); annual.setAttribute("aria-pressed", "false"); paintPlans("month"); }); annual.addEventListener("click", () => { monthly.setAttribute("aria-pressed", "false"); annual.setAttribute("aria-pressed", "true"); paintPlans("year"); }); paintPlans("month");
  const restore = createElement("button", { className: "crm-button crm-button-outline", text: "Restaurar compras", type: "button" }); restore.addEventListener("click", restoreSubscriptionPurchases); root.append(restore); appendAccountActions(root, membership);
}

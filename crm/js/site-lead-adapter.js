/*
  Adaptador preparado para o futuro formulário do site público.
  Não é carregado no site nesta fase; o botão de WhatsApp atual permanece inalterado.
*/
async function registerSiteLead({ name, phone, email, propertyCode, propertyTitle }) {
  const payload = {
    name: String(name || "").trim(),
    phone: String(phone || "").trim(),
    whatsapp: String(phone || "").trim(),
    email: String(email || "").trim(),
    origin: "site",
    property_code: String(propertyCode || "").trim(),
    property_title: String(propertyTitle || "").trim(),
    budget: "",
    desired_region: "",
    notes: "Lead recebido pelo site público.",
    stage: "novo",
    entered_at: new Date().toISOString(),
    next_follow_up: null,
    visit_date: null
  };

  validateLead(payload);

  if (!isSupabaseConfigured()) throw new Error("Integração de leads aguardando configuração do Supabase.");

  // A função Edge deve validar captcha/rate limit e gravar com segredo apenas no servidor.
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/functions/v1/site-lead`, {
    method: "POST",
    headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error("Não foi possível registrar o interesse no momento.");
  return response.json();
}

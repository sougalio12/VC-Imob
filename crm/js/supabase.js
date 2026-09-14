function getStoredSession() {
  try {
    return JSON.parse(sessionStorage.getItem("vc-imob-session") || "null");
  }
  catch {
    return null;
  }
}

function storeSession(session) {
  sessionStorage.setItem("vc-imob-session", JSON.stringify(session));
}

function clearStoredSession() {
  sessionStorage.removeItem("vc-imob-session");
}

function clearOrganizationContext() {
  sessionStorage.removeItem("vc-imob-organization-context");
}

async function refreshStoredSession(session) {
  if (!session?.refresh_token || !isSupabaseConfigured()) return null;

  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: CRM_CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${CRM_CONFIG.supabasePublishableKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) {
    clearStoredSession();
    return null;
  }

  const refreshed = await response.json();
  storeSession(refreshed);
  return refreshed;
}

async function getValidSession() {
  const session = getStoredSession();
  if (!session?.access_token) return null;

  const expiresAt = Number(session.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt - Date.now() > 60000) return session;

  return refreshStoredSession(session);
}

async function supabaseRequest(path, options = {}) {
  if (!isSupabaseConfigured()) throw new Error("Supabase ainda não foi configurado.");

  const session = await getValidSession();
  const headers = {
    apikey: CRM_CONFIG.supabasePublishableKey,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const response = await fetch(`${CRM_CONFIG.supabaseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;

  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const rawMessage = data?.message || data?.error_description || "Não foi possível concluir a operação.";
    const message = friendlySupabaseError({ path, method: options.method || "GET", status: response.status, code: data?.code, rawMessage });
    console.error("CRM request failed", { operation: `${options.method || "GET"} ${String(path).split("?")[0]}`, status: response.status, code: data?.code || "unknown", timestamp: new Date().toISOString() });
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.code = data?.code || null;
    throw requestError;
  }

  return data;
}

function friendlySupabaseError({ path, method, status, code, rawMessage }) {
  const exact = { "Team member limit reached": "O limite de pessoas do seu plano foi atingido. Consulte Plano / Assinatura para ver as opções.", "Acesso comercial negado": "Sua conta não tem acesso a este recurso no plano atual.", "Acesso ao plano negado": "Somente proprietários e gerentes podem consultar a assinatura." };
  if (exact[rawMessage]) return exact[rawMessage];
  if (status === 401) return "Sua sessão expirou. Entre novamente para continuar.";
  if (status === 403 || code === "42501" || /permission denied|access denied|acesso negado/i.test(rawMessage)) return "Você não possui permissão para realizar esta ação.";
  if (code === "40001" || /CRM_(?:PROPERTY|LEAD)_CONFLICT/.test(rawMessage)) return "Este registro foi atualizado em outra sessão. Recarregue os dados antes de salvar novamente.";
  if (code === "23505") return "Já existe um registro com estes dados.";
  if (code === "23503") return "Este registro está vinculado a outro item e não pode ser alterado dessa forma.";
  if (code === "23514" || code === "22023") return "Revise os campos informados e tente novamente.";
  if (/\/properties|save_crm_property/.test(path)) return "Não foi possível salvar o imóvel. Tente novamente.";
  if (/\/leads|save_crm_lead/.test(path)) return "Não foi possível salvar o lead. Revise os dados e tente novamente.";
  if (/\/proposals/.test(path)) return "Não foi possível salvar a proposta. Tente novamente.";
  if (/appointment|activity/i.test(path)) return "Não foi possível salvar a atividade. Tente novamente.";
  return method === "GET" ? "Não foi possível carregar os dados agora. Tente novamente." : "Não foi possível concluir a operação. Tente novamente.";
}

async function signInWithPassword(email, password) {
  const result = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRM_CONFIG.supabasePublishableKey}` },
    body: JSON.stringify({ email, password })
  });

  storeSession(result);
  return result;
}

async function signUpPublicAccount(payload) {
  if (!isSupabaseConfigured()) throw new Error("Cadastro temporariamente indisponível.");
  const capability = await fetch(`${CRM_CONFIG.supabaseUrl}/rest/v1/rpc/public_signup_available`, {
    method: "POST", headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" }, body: "{}"
  });
  if (!capability.ok || await capability.json().catch(() => false) !== true) throw new Error("O cadastro está aguardando uma atualização segura do serviço. Tente novamente mais tarde.");
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      data: {
        public_signup: true,
        full_name: payload.fullName,
        phone: payload.phone,
        creci: payload.creci || null,
        company_name: payload.companyName || null,
        legal_accepted: true,
        terms_version: "2026-09-12",
        privacy_version: "2026-09-12"
      }
    })
  });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { result = null; }
  if (!response.ok) {
    const detail = String(result?.msg || result?.message || "");
    if (/already registered|already exists|user exists/i.test(detail)) throw new Error("Já existe uma conta com este e-mail.");
    if (response.status === 429) throw new Error("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
    throw new Error("Não foi possível criar sua conta. Revise os dados e tente novamente.");
  }
  if (result?.access_token) storeSession(result);
  return result;
}

async function signOutFromSupabase() {
  const session = await getValidSession();
  if (isSupabaseConfigured() && session?.access_token) {
    try { await supabaseRequest("/auth/v1/logout", { method: "POST" }); } catch { /* sessão local ainda será removida */ }
  }
  clearStoredSession();
  clearOrganizationContext();
}

async function getCurrentProfile() {
  const session = await getValidSession();
  if (!session?.user?.id) return null;

  const result = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=*`);
  return result?.[0] || null;
}

async function getMyActiveMemberships() {
  const result = await supabaseRequest("/rest/v1/rpc/get_my_active_memberships", {
    method: "POST",
    body: JSON.stringify({})
  });

  return Array.isArray(result) ? result : [];
}

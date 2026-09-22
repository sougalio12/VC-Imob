function getStoredSession() {
  try {
    const persistent = localStorage.getItem("vc-imob-session");
    if (persistent) return JSON.parse(persistent);

    // One-time migration for a session created before persistent auth was enabled.
    const legacy = sessionStorage.getItem("vc-imob-session");
    if (!legacy) return null;
    localStorage.setItem("vc-imob-session", legacy);
    sessionStorage.removeItem("vc-imob-session");
    return JSON.parse(legacy);
  }
  catch {
    return null;
  }
}

function storeSession(session) {
  localStorage.setItem("vc-imob-session", JSON.stringify(session));
  sessionStorage.removeItem("vc-imob-session");
}

function clearStoredSession() {
  localStorage.removeItem("vc-imob-session");
  sessionStorage.removeItem("vc-imob-session");
}

function clearOrganizationContext() {
  sessionStorage.removeItem("vc-imob-organization-context");
}

async function refreshStoredSession(session) {
  if (!session?.refresh_token || !isSupabaseConfigured()) {
    clearStoredSession();
    return null;
  }

  try {
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
      if ([400, 401, 403].includes(response.status)) clearStoredSession();
      return [400, 401, 403].includes(response.status) ? null : session;
    }

    const refreshed = await response.json();
    if (!refreshed?.access_token || !refreshed?.refresh_token) {
      clearStoredSession();
      return null;
    }
    storeSession(refreshed);
    return refreshed;
  } catch {
    // A temporary network failure must not erase a refresh token that can be retried later.
    return session;
  }
}

async function getValidSession(options = {}) {
  const session = getStoredSession();
  if (!session?.access_token) return null;

  const expiresAt = Number(session.expires_at || 0) * 1000;
  if (expiresAt && expiresAt - Date.now() <= 60000) return refreshStoredSession(session);
  if (!options.verify) return session;

  try {
    const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: CRM_CONFIG.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` }
    });
    if (response.ok) {
      const user = await response.json();
      const verified = { ...session, user: user || session.user };
      storeSession(verified);
      return verified;
    }
    if (response.status === 401 || response.status === 403) return refreshStoredSession(session);
    return session;
  } catch {
    // Offline/transient network errors must not destroy an otherwise unexpired local session.
    return session;
  }
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
  if (!isSupabaseConfigured()) throw new Error("Login temporariamente indisponível.");
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: CRM_CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${CRM_CONFIG.supabasePublishableKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
    if (response.status === 400 || response.status === 401) throw new Error("E-mail ou senha incorretos.");
    throw new Error("Não foi possível entrar agora. Tente novamente.");
  }
  if (!result?.access_token || !result?.refresh_token || !result?.user?.id) throw new Error("Não foi possível validar a sessão. Tente novamente.");

  storeSession(result);
  clearOrganizationContext();
  return result;
}

async function signUpPublicAccount(payload) {
  if (!isSupabaseConfigured()) throw new Error("Cadastro temporariamente indisponível.");
  const capability = await fetch(`${CRM_CONFIG.supabaseUrl}/rest/v1/rpc/public_signup_available`, {
    method: "POST", headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" }, body: "{}"
  });
  if (!capability.ok || await capability.json().catch(() => false) !== true) throw new Error("O cadastro está aguardando uma atualização segura do serviço. Tente novamente mais tarde.");
  const redirectTo = getAuthConfirmationRedirectUrl();
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
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

function getAuthConfirmationRedirectUrl() {
  const official = "https://valdineycapistranoimoveis.com.br/crm/confirm.html";
  if (typeof window === "undefined") return official;
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return new URL("./confirm.html", window.location.href).href;
  return official;
}

async function resendSignupConfirmation(email) {
  if (!isSupabaseConfigured()) throw new Error("Confirmação temporariamente indisponível.");
  const redirectTo = getAuthConfirmationRedirectUrl();
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "signup", email: String(email || "").trim().toLowerCase() })
  });
  if (response.status === 429) throw new Error("Aguarde alguns minutos antes de solicitar outro e-mail.");
  if (!response.ok) throw new Error("Não foi possível reenviar agora. Aguarde e tente novamente.");
  return true;
}

async function consumeAuthConfirmationRedirect() {
  if (typeof window === "undefined") return { status: "unavailable" };
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const errorCode = params.get("error_code") || params.get("error");
  if (errorCode) {
    window.history.replaceState({}, document.title, window.location.pathname);
    return { status: "error", message: "O link de confirmação expirou ou já foi utilizado. Solicite um novo e-mail no cadastro." };
  }
  const accessToken = params.get("access_token"), refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return { status: "confirmed", session: false };
  const response = await fetch(`${CRM_CONFIG.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: CRM_CONFIG.supabasePublishableKey, Authorization: `Bearer ${accessToken}` }
  });
  window.history.replaceState({}, document.title, window.location.pathname);
  if (!response.ok) return { status: "error", message: "Seu e-mail foi confirmado, mas a sessão não pôde ser iniciada. Entre com seu e-mail e senha." };
  const user = await response.json();
  const expiresIn = Number(params.get("expires_in") || 3600);
  storeSession({ access_token: accessToken, refresh_token: refreshToken, token_type: params.get("token_type") || "bearer", expires_in: expiresIn, expires_at: Math.floor(Date.now()/1000)+expiresIn, user });
  clearOrganizationContext();
  return { status: "confirmed", session: true };
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

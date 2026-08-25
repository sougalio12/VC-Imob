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
    const message = data?.message || data?.error_description || "Não foi possível concluir a operação.";
    throw new Error(message);
  }

  return data;
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

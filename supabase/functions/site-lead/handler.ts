type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };
type Dependencies = {
  env: (name: string) => string | undefined;
  createClient: (url: string, key: string, options: { auth: { persistSession: boolean } }) => RpcClient;
};

export function createSiteLeadHandler({ env, createClient }: Dependencies) {
  const MAX_BODY_BYTES = 10_000;
  const MAX_REQUESTS_PER_HOUR = 5;
  const PROPERTY_CODE_PATTERN = /^[A-Za-z0-9-]{3,32}$/;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function corsHeaders(origin: string | null) {
    const allowedOrigins = (env("SITE_LEAD_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const normalizedOrigin = origin?.replace(/\/$/, "") || "";

    if (!normalizedOrigin || !allowedOrigins.includes(normalizedOrigin)) return null;

    return {
      "Access-Control-Allow-Origin": normalizedOrigin,
      "Access-Control-Allow-Headers": "apikey, authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin"
    };
  }

  function response(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
    });
  }

  function cleanText(value: unknown, maxLength: number) {
    return String(value ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function normalizePhone(value: unknown) {
    return String(value ?? "").replace(/\D/g, "").slice(0, 15);
  }

  function attributionValue(value: unknown) {
    const normalized = cleanText(value, 100).toLowerCase();
    return /^[a-z0-9._~-]+$/.test(normalized) ? normalized : null;
  }

  function landingPage(value: unknown, allowedOrigin: string) {
    try {
      const parsed = new URL(cleanText(value, 500));
      return parsed.origin === allowedOrigin
        ? `${parsed.origin}${parsed.pathname}`
        : null;
    } catch { return null; }
  }

  function clientIp(request: Request) {
    return (request.headers.get("x-forwarded-for") || "unknown")
      .split(",")[0]
      .trim()
      .slice(0, 128);
  }

  async function rateKey(request: Request) {
    const salt = env("SITE_LEAD_RATE_LIMIT_SALT");
    if (!salt) throw new Error("Rate-limit configuration missing.");
    const source = new TextEncoder().encode(`${clientIp(request)}:${salt}`);
    const hash = await crypto.subtle.digest("SHA-256", source);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return async (request: Request) => {
    const headers = corsHeaders(request.headers.get("origin"));
    if (!headers) return new Response(null, { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, headers);

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) return response({ error: "Solicitação inválida." }, 413, headers);

    let payload: Record<string, unknown>;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return response({ error: "Solicitação inválida." }, 413, headers);
      payload = JSON.parse(body);
    } catch {
      return response({ error: "Solicitação inválida." }, 400, headers);
    }

    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return response({ error: "Solicitação inválida." }, 400, headers);
    }

    if (cleanText(payload.website, 120)) return response({ ok: true }, 200, headers);

    const name = cleanText(payload.name, 120);
    const phone = normalizePhone(payload.phone);
    const email = cleanText(payload.email, 254).toLowerCase();
    const propertyCode = cleanText(payload.propertyCode, 32).toUpperCase();

    if (name.length < 2 || phone.length < 8 || !PROPERTY_CODE_PATTERN.test(propertyCode)) {
      return response({ error: "Confira os dados informados." }, 422, headers);
    }
    if (email && !EMAIL_PATTERN.test(email)) return response({ error: "Informe um e-mail válido." }, 422, headers);

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const organizationId = env("SITE_LEAD_ORGANIZATION_ID");
    if (!supabaseUrl || !serviceRoleKey || !organizationId || !env("SITE_LEAD_RATE_LIMIT_SALT")) {
      console.error("site-lead is missing required server configuration");
      return response({ error: "Serviço indisponível." }, 503, headers);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: allowed, error: rateLimitError } = await admin.rpc("consume_site_lead_rate_limit", {
      target_key: await rateKey(request),
      max_requests: MAX_REQUESTS_PER_HOUR,
      window_seconds: 3600
    });
    if (rateLimitError || !allowed) return response({ error: "Tente novamente mais tarde." }, 429, headers);

    const requestOrigin = request.headers.get("origin")?.replace(/\/$/, "") || "";
    const { data: captureResult, error: captureError } = await admin.rpc("capture_published_site_lead", {
      target_organization: organizationId,
      target_name: name,
      target_phone: phone,
      target_email: email,
      target_property_code: propertyCode,
      target_source: attributionValue(payload.source),
      target_medium: attributionValue(payload.medium),
      target_campaign: attributionValue(payload.campaign),
      target_content: attributionValue(payload.content),
      target_term: attributionValue(payload.term),
      target_landing_page: landingPage(payload.landingPage, requestOrigin)
    });

    if (!captureError && Array.isArray(captureResult) && captureResult.length === 0) return response({ error: "Imóvel não disponível." }, 404, headers);
    if (captureError || !Array.isArray(captureResult) || !(captureResult[0] as { lead_id?: string })?.lead_id) {
      console.error("site-lead capture failed", captureError?.code);
      return response({ error: "Não foi possível registrar o interesse." }, 503, headers);
    }

    return response({ ok: true, created: (captureResult[0] as { created?: boolean }).created === true }, (captureResult[0] as { created?: boolean }).created ? 201 : 200, headers);
  };
}

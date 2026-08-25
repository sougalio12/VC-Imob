import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BODY_BYTES = 10_000;
const MAX_REQUESTS_PER_HOUR = 5;
const PROPERTY_CODE_PATTERN = /^[A-Za-z0-9-]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string | null) {
  const allowedOrigins = (Deno.env.get("SITE_LEAD_ALLOWED_ORIGINS") || "")
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

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 128);
}

async function rateKey(request: Request) {
  const salt = Deno.env.get("SITE_LEAD_RATE_LIMIT_SALT");
  if (!salt) throw new Error("Rate-limit configuration missing.");
  const source = new TextEncoder().encode(`${clientIp(request)}:${salt}`);
  const hash = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (request) => {
  const headers = corsHeaders(request.headers.get("origin"));
  if (!headers) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, headers);

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) return response({ error: "Solicitação inválida." }, 413, headers);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const organizationId = Deno.env.get("SITE_LEAD_ORGANIZATION_ID");
  const siteUrl = Deno.env.get("SITE_PUBLIC_URL")?.replace(/\/$/, "");
  if (!supabaseUrl || !serviceRoleKey || !organizationId || !siteUrl) {
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

  let properties: Array<Record<string, unknown>>;
  try {
    const propertyResponse = await fetch(`${siteUrl}/data/imoveis.json`, { headers: { Accept: "application/json" } });
    if (!propertyResponse.ok) throw new Error("Property catalog unavailable");
    properties = await propertyResponse.json();
  } catch {
    return response({ error: "Não foi possível confirmar o imóvel." }, 503, headers);
  }

  const property = properties.find((item) =>
    String(item.codigo || "").toUpperCase() === propertyCode && item.ativo === true
  );
  const propertyTitle = cleanText(property?.titulo, 180);
  if (!property || !propertyTitle) return response({ error: "Imóvel não disponível." }, 404, headers);

  const { error: insertError } = await admin.from("leads").insert({
    organization_id: organizationId,
    name,
    phone,
    whatsapp: phone,
    email: email || null,
    origin: "site",
    property_code: propertyCode,
    property_title: propertyTitle,
    notes: "Lead recebido pelo site público.",
    stage: "novo",
    entered_at: new Date().toISOString()
  });

  if (insertError) {
    console.error("site-lead insert failed", insertError.code);
    return response({ error: "Não foi possível registrar o interesse." }, 503, headers);
  }

  return response({ ok: true }, 201, headers);
});

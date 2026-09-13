import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BODY_BYTES = 32_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["apple", "google", "web"]);
const STATUSES = new Set(["active", "past_due", "grace_period", "canceled", "expired", "refunded", "revoked"]);

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function clean(value: unknown, max = 180) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max); }
function safeEqual(first: string, second: string) {
  const a = new TextEncoder().encode(first); const b = new TextEncoder().encode(second); if (a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]; return difference === 0;
}

serve(async request => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "Payload inválido." }, 413);
  const enabled = Deno.env.get("BILLING_PROVIDER_EVENTS_ENABLED") === "true";
  const ingressSecret = Deno.env.get("BILLING_PROVIDER_INGRESS_SECRET") || "";
  if (!enabled || !ingressSecret) return json({ error: "Integração de billing ainda não configurada." }, 503);
  const supplied = request.headers.get("x-vcimob-billing-secret") || "";
  if (!safeEqual(supplied, ingressSecret)) return json({ error: "Não autorizado." }, 401);

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return json({ error: "Payload inválido." }, 400); }
  const provider = clean(payload.provider, 16); const status = clean(payload.status, 24); const organization = clean(payload.organization_id, 40);
  const interval = clean(payload.billing_interval, 8); const eventId = clean(payload.event_id); const eventType = clean(payload.event_type);
  if (!PROVIDERS.has(provider) || !STATUSES.has(status) || !UUID.test(organization) || !["month", "year"].includes(interval) || !eventId || !eventType) return json({ error: "Evento normalizado inválido." }, 400);

  // Este endpoint recebe somente eventos já verificados pelo adapter do provedor.
  // A verificação Apple JWS / Google Developer API deve ser ligada antes de habilitá-lo.
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Backend incompleto." }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("apply_verified_billing_event", {
    target_provider: provider, target_event_id: eventId, target_event_type: eventType, target_organization: organization,
    target_plan_code: clean(payload.plan_code, 16), target_billing_interval: interval, target_status: status,
    event_occurred_at: clean(payload.occurred_at, 40), period_starts_at: payload.period_starts_at || null,
    period_ends_at: payload.period_ends_at || null, cancel_at_end: payload.cancel_at_period_end === true,
    target_provider_customer_id: clean(payload.provider_customer_id) || null,
    target_provider_subscription_id: clean(payload.provider_subscription_id) || null,
    event_metadata: { source: "verified_provider_adapter", provider }
  });
  if (error) return json({ error: "Evento não aplicado." }, 422);
  return json({ ok: true, result: data?.[0]?.result || "applied" }, 200);
});

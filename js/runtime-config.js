(function () {
  "use strict";
  const PRODUCTION_HOST = "isbkhhobutbdtdtpaavn.supabase.co";
  const OFFICIAL_HOSTS = ["valdineycapistranoimoveis.com.br", "www.valdineycapistranoimoveis.com.br"];

  function resolveConfig(input, location, native = false) {
    const environment = input?.environment || "development";
    if (!["development", "staging", "production"].includes(environment)) throw new Error("Ambiente inválido.");
    const url = input?.supabaseUrl ? new URL(input.supabaseUrl) : null;
    const site = input?.siteOrigin ? new URL(input.siteOrigin) : null;
    const local = host => ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (site && (site.username || site.password || site.search || site.hash || site.pathname !== "/" || !["http:", "https:"].includes(site.protocol))) throw new Error("Origem inválida.");
    if (environment === "development" && site && (!local(site.hostname) || site.protocol !== "http:")) throw new Error("Callback de desenvolvimento deve ser local.");
    if (url && (url.username || url.password || url.search || url.hash || url.pathname !== "/")) throw new Error("URL Supabase inválida.");
    if (environment !== "production" && url?.hostname === PRODUCTION_HOST) throw new Error("Produção bloqueada neste ambiente.");
    if (environment === "development" && url && (!local(url.hostname) || url.protocol !== "http:")) throw new Error("Desenvolvimento exige Supabase local.");
    if (environment === "staging" && url && (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))) throw new Error("Staging exige projeto Supabase separado.");
    if (environment !== "production" && site && OFFICIAL_HOSTS.includes(site.hostname)) throw new Error("Callback de produção bloqueado.");
    if (environment === "production" && (url?.hostname !== PRODUCTION_HOST || url.protocol !== "https:" || !site || !OFFICIAL_HOSTS.includes(site.hostname) || site.protocol !== "https:")) throw new Error("Configuração de produção inválida.");
    // Even an accidentally copied production artifact cannot connect from a preview/local browser.
    if (environment === "production" && !native && !OFFICIAL_HOSTS.includes(location.hostname)) throw new Error("Artefato de produção bloqueado fora do domínio oficial.");
    if (environment === "staging" && site && location.origin !== site.origin) throw new Error("Origem de staging diferente da configurada.");
    const key = String(input?.supabasePublishableKey || "");
    if (key && !key.startsWith("sb_publishable_")) {
      // Supabase local also supports legacy anon JWTs, never service-role JWTs.
      let role;
      try { role = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch {}
      if (role !== "anon") throw new Error("Use somente uma chave pública/anon.");
    }
    return Object.freeze({ environment, supabaseUrl: key && url ? url.origin : "", supabasePublishableKey: key,
      authRedirectUrl: site ? `${site.origin}/crm/confirm.html` : "" });
  }

  window.resolveVcImobConfig = resolveConfig;
  try {
    window.VC_IMOB_CONFIG = resolveConfig(window.VC_IMOB_ENV, window.location, Boolean(window.Capacitor?.isNativePlatform?.()));
  } catch {
    window.VC_IMOB_CONFIG = Object.freeze({ environment: "disabled", supabaseUrl: "", supabasePublishableKey: "", authRedirectUrl: "" });
    console.error("Configuração do ambiente inválida; acesso ao backend bloqueado.");
  }
})();

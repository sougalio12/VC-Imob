(function () {
  "use strict";

  const CACHE_KEY = "vcimob-public-catalog-v1";
  const MAX_STALE_MS = 24 * 60 * 60 * 1000;

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => row && typeof row === "object" && "list_public_properties" in row ? row.list_public_properties : row).filter(Boolean);
  }

  async function loadPublishedProperties(fallbackPath) {
    const config = typeof PUBLIC_LEAD_CONFIG === "object" ? PUBLIC_LEAD_CONFIG : null;
    if (config?.supabaseUrl && config?.publishableKey) {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/list_public_properties`, {
          method: "POST",
          headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
          body: JSON.stringify({ target_hostname: window.location.hostname || "valdineycapistranoimoveis.com.br" })
        });
        if (!response.ok) throw new Error(`Catálogo remoto indisponível (${response.status}).`);
        const properties = normalizeRows(await response.json());
        if (properties.length) {
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), properties })); } catch {}
          return properties;
        }
      } catch (error) {
        console.warn("Catálogo publicado temporariamente indisponível; usando contingência.", error);
      }
    }

    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.savedAt > Date.now() - MAX_STALE_MS && Array.isArray(cached.properties) && cached.properties.length) return cached.properties;
    } catch {}

    const response = await fetch(fallbackPath || "./data/imoveis.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar os imóveis.");
    return response.json();
  }

  window.loadPublishedProperties = loadPublishedProperties;
})();

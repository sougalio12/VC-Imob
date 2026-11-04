(function () {
  "use strict";

  // Include the backend and hostname so environments/tenants never share a cache.
  const config = typeof PUBLIC_LEAD_CONFIG === "object" ? PUBLIC_LEAD_CONFIG : null;
  const CACHE_KEY = `vcimob-public-catalog-v2:${config?.supabaseUrl || "static"}:${window.location.hostname}`;
  const MAX_STALE_MS = 24 * 60 * 60 * 1000;
  let latestCatalog = null;

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) throw new Error("Resposta inválida do catálogo.");
    return rows.map(row => row && typeof row === "object" && "list_public_properties" in row ? row.list_public_properties : row).filter(Boolean);
  }

  async function loadPublishedProperties(fallbackPath) {
    if (config?.supabaseUrl && config?.publishableKey) {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/list_public_properties`, {
          method: "POST",
          headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
          body: JSON.stringify({ target_hostname: window.location.hostname || "valdineycapistranoimoveis.com.br" })
        });
        if (!response.ok) throw new Error(`Catálogo remoto indisponível (${response.status}).`);
        const properties = normalizeRows(await response.json());
        latestCatalog = { savedAt: Date.now(), properties };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(latestCatalog)); } catch {
          try { localStorage.removeItem(CACHE_KEY); } catch {}
        }
        return properties;
      } catch (error) {
        console.warn("Catálogo publicado temporariamente indisponível; usando contingência.", error);
      }
    }

    try {
      const cached = latestCatalog || JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.savedAt > Date.now() - MAX_STALE_MS && Array.isArray(cached.properties)) return cached.properties;
    } catch {}

    const response = await fetch(fallbackPath || "./data/imoveis.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar os imóveis.");
    return response.json();
  }

  window.loadPublishedProperties = loadPublishedProperties;
})();

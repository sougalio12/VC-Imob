import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const script = readFileSync("js/public-catalog.js", "utf8");
const property = { codigo: "TEST-ONLY", ativo: true };
async function load(remote, cached = null, host = "localhost") {
  const calls = [];
  const data = new Map(
    cached ? [["vcimob-public-catalog-v1", JSON.stringify(cached)]] : [],
  );
  const window = { location: { hostname: host }, dispatchEvent() {} };
  const context = vm.createContext({
    window,
    URL,
    AbortSignal,
    CustomEvent: class {},
    console: { warn() {} },
    PUBLIC_LEAD_CONFIG: {
      supabaseUrl: "https://example.invalid",
      publishableKey: "test",
    },
    SITE_CONFIG: {
      site: { dominio: "https://valdineycapistranoimoveis.com.br" },
    },
    localStorage: {
      getItem: (k) => data.get(k),
      setItem: (k, v) => data.set(k, v),
    },
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("/rpc/")) {
        if (remote instanceof Error) throw remote;
        return { ok: true, json: async () => remote };
      }
      return { ok: true, json: async () => [property] };
    },
  });
  vm.runInContext(script, context);
  return {
    rows: await window.loadPublishedProperties(),
    source: window.vcCatalogSource,
    calls,
  };
}
test("authoritative empty RPC does not resurrect stale cache or JSON", async () => {
  const x = await load([], { savedAt: Date.now(), properties: [property] });
  assert.equal(x.rows.length, 0);
  assert.equal(x.calls.length, 1);
  assert.equal(x.source, "rpc");
});
test("RPC wrappers normalize without losing modality or prices", async () => {
  const x = await load([
    {
      list_public_properties: {
        ...property,
        finalidade: "locacao",
        preco: 2300,
      },
    },
  ]);
  assert.equal(x.rows[0].preco, 2300);
  assert.equal(x.rows[0].finalidade, "locacao");
});
test("errors use fresh cache and expose contingency status", async () => {
  const x = await load(new Error("offline"), {
    savedAt: Date.now(),
    properties: [property],
  });
  assert.equal(x.rows[0].codigo, property.codigo);
  assert.equal(x.source, "cache");
});
test("expired cache falls back to JSON with contingency status", async () => {
  const x = await load(new Error("offline"), { savedAt: 0, properties: [] });
  assert.equal(x.source, "json");
  assert.equal(x.calls.length, 2);
});
test("official preview uses canonical tenant without database changes", async () => {
  const x = await load(
    [],
    null,
    "feat-vc-imob-2-minimal-warm.valdiney-im-veis.pages.dev",
  );
  assert.equal(
    JSON.parse(x.calls[0].opts.body).target_hostname,
    "valdineycapistranoimoveis.com.br",
  );
});
test("malformed successful response uses contingency instead of hiding catalog", async () => {
  const x = await load({ error: "invalid" });
  assert.equal(x.source, "json");
});

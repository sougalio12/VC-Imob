import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseFeed, plainText } from "../scripts/update-news.mjs";

test("feed parser strips arbitrary HTML and rejects malicious links", () => {
  const source = { name: "Fonte oficial", category: "Economia" };
  const xml = `<rss><channel>
    <item><title>Crédito imobiliário cresce</title><description><![CDATA[<script>alert(1)</script><b>Resumo real</b>]]></description><source>Órgão público</source><pubDate>Fri, 09 Oct 2026 12:00:00 GMT</pubDate><link>https://example.gov.br/noticia</link></item>
    <item><title>Financiamento falso</title><pubDate>Fri, 09 Oct 2026 12:00:00 GMT</pubDate><link>javascript:alert(1)</link></item>
  </channel></rss>`;
  const items = parseFeed(xml, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].resumo, "alert(1) Resumo real");
  assert.equal(items[0].fonte, "Órgão público");
  assert.ok(!/[<>]/.test(plainText("<img src=x onerror=alert(1)>", 30)));
});

test("aggregated public feed resolves the original HTTPS source", () => {
  const original = "https%3A%2F%2Fwww.gov.br%2Fcidades%2Fpt-br%2Fnoticias%2Fhabitacao-segura";
  const xml = `<rss><channel><item><title>Financiamento habitacional seguro</title><description>Crédito para casa própria</description><News:Source>Ministério das Cidades</News:Source><pubDate>Fri, 09 Oct 2026 12:00:00 GMT</pubDate><link>http://www.bing.com/news/apiclick.aspx?url=${original}&amp;c=1</link></item></channel></rss>`;
  const [item] = parseFeed(xml, { name: "Fontes públicas", category: "Habitação" });
  assert.equal(item.url, "https://www.gov.br/cidades/pt-br/noticias/habitacao-segura");
  assert.equal(item.fonte, "Ministério das Cidades");
});

test("shared property helper always uses the canonical public URL", async () => {
  let shared;
  const context = vm.createContext({
    console, URL, Intl,
    window: { innerWidth: 390, isSecureContext: true, matchMedia: () => ({ matches: true }) },
    navigator: { share: async value => { shared = value; }, clipboard: { writeText: async () => {} } },
    document: {}
  });
  context.window.window = context.window;
  context.window.navigator = context.navigator;
  vm.runInContext(readFileSync("js/property-share.js", "utf8"), context);
  const helper = context.window.VCPropertyShare;
  assert.equal(helper.publicPropertyUrl({ codigo: "VCI000006" }), "https://valdineycapistranoimoveis.com.br/imovel.html?codigo=VCI000006");
  await helper.shareProperty({ codigo: "VCI000006", titulo: "Residencial Vida Azaléias", preco: 550000 });
  assert.match(shared.text, /VCI000006 — Residencial Vida Azaléias[\s\S]*R\$\s550\.000/);
  assert.equal(shared.url, "https://valdineycapistranoimoveis.com.br/imovel.html?codigo=VCI000006");
});

test("desktop fallback copies only the canonical public URL", async () => {
  let copied = "";
  const context = vm.createContext({
    console, URL, Intl,
    window: { innerWidth: 1366, isSecureContext: true, matchMedia: () => ({ matches: false }) },
    navigator: { share: async () => { throw new Error("desktop share should not run"); }, clipboard: { writeText: async value => { copied = value; } } },
    document: {}
  });
  context.window.window = context.window; context.window.navigator = context.navigator;
  vm.runInContext(readFileSync("js/property-share.js", "utf8"), context);
  const result = await context.window.VCPropertyShare.shareProperty({ codigo: "VCI000002", titulo: "Imóvel público" });
  assert.equal(result.status, "copied");
  assert.equal(copied, "https://valdineycapistranoimoveis.com.br/imovel.html?codigo=VCI000002");
  assert.doesNotMatch(copied, /\/crm(?:\/|$)/);
});

test("CRM share action blocks unpublished properties", () => {
  const source = readFileSync("crm/js/properties.js", "utf8");
  assert.match(source, /disabled: property\._row \? !property\.publicado/);
  assert.match(source, /Publique o imóvel para compartilhar/);
});

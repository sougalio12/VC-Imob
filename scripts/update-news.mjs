import { readFile, writeFile } from "node:fs/promises";

const CACHE_FILE = new URL("../data/noticias.json", import.meta.url);
const MAX_ITEMS = 18;
const KEYWORDS = [
  "imovel", "imobiliari", "habitacao", "moradia", "casa propria", "financiamento habitacional",
  "credito imobiliario", "selic", "juros altos", "construcao civil", "incorporacao", "loteamento", "aluguel",
  "apartamento", "condominio", "residencial"
];

export const NEWS_SOURCES = [
  {
    name: "Agência Brasil — Economia",
    category: "Economia",
    url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml"
  },
  {
    name: "Agência de Notícias IBGE",
    category: "Construção civil e economia",
    url: "https://agenciadenoticias.ibge.gov.br/agencia-rss"
  }
];

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return entities[entity.toLowerCase()] ?? "";
  });
}

export function plainText(value, limit = 240) {
  const clean = decodeEntities(value).replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}

function tag(xml, name) {
  return decodeEntities(xml.match(new RegExp(`<(?:[^:>]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[^:>]+:)?${name}>`, "i"))?.[1] || "");
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

function relevant(item) {
  const text = item.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return KEYWORDS.some(keyword => text.includes(keyword));
}

export function parseFeed(xml, source) {
  const entries = String(xml).match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return entries.map(entry => {
    const title = plainText(tag(entry, "title"), 180);
    const description = tag(entry, "description") || tag(entry, "summary") || tag(entry, "content");
    const sourceName = plainText(tag(entry, "source"), 100) || source.name;
    const linkTag = tag(entry, "link") || entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
    const published = tag(entry, "pubDate") || tag(entry, "published") || tag(entry, "updated");
    const date = new Date(published);
    return {
      titulo: title,
      resumo: plainText(description, 240),
      fonte: sourceName,
      categoria: source.category,
      dataPublicacao: Number.isNaN(date.valueOf()) ? "" : date.toISOString(),
      url: safeHttpsUrl(linkTag)
    };
  }).filter(item => item.titulo && item.url && item.dataPublicacao && relevant(item));
}

async function fetchSource(source) {
  const response = await fetch(source.url, { headers: { "user-agent": "VC-Imob-News/1.0 (+https://valdineycapistranoimoveis.com.br)" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  return parseFeed(await response.text(), source);
}

function deduplicateAndSort(items) {
  const unique = new Map();
  for (const item of items.filter(relevant)) {
    const key = item.titulo.toLocaleLowerCase("pt-BR");
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => new Date(b.dataPublicacao) - new Date(a.dataPublicacao)).slice(0, MAX_ITEMS);
}

export async function updateNews() {
  let cached = [];
  try { cached = JSON.parse(await readFile(CACHE_FILE, "utf8")); } catch {}
  const results = await Promise.allSettled(NEWS_SOURCES.map(fetchSource));
  const fresh = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const failures = results.filter(result => result.status === "rejected").map(result => result.reason?.message || "Fonte indisponível");
  const next = fresh.length ? deduplicateAndSort(failures.length ? [...fresh, ...cached] : fresh) : cached;
  if (fresh.length) await writeFile(CACHE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ updated: fresh.length > 0, items: next.length, failures }));
  return { updated: fresh.length > 0, items: next, failures };
}

if (process.argv[1] && new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href === import.meta.url) {
  updateNews().catch(error => { console.error(error); process.exitCode = 1; });
}

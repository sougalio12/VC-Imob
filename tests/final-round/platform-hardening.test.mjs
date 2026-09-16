import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = path => readFileSync(path, "utf8");
const headers = read("_headers");
const serviceWorker = read("crm/service-worker.js");
const catalog = JSON.parse(read("data/imoveis.json"));

test("security headers are versioned without weakening current protections", () => {
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'self'/);
  assert.match(headers, /connect-src[^\n]+https:\/\/isbkhhobutbdtdtpaavn\.supabase\.co/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\)/);
});

test("service worker remains limited to public same-origin shell", () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/crm\/"\)/);
  assert.doesNotMatch(serviceWorker, /supabase\.co|\/rest\/v1|\/auth\/v1|\/rpc\//);
});

test("existing public property codes and image counts remain intact", () => {
  const expected = { VCI000002: 7, VCI000003: 4, VCI000004: 7, VCI000005: 3, VCI000006: 6 };
  for (const [code, count] of Object.entries(expected)) {
    const property = catalog.find(item => item.codigo === code);
    assert.ok(property, `${code} missing`);
    assert.equal(property.imagens.length, count, `${code} image count changed`);
    for (const source of property.imagens) assert.ok(statSync(source.replace(/^\.\//, "")).isFile(), `${source} missing`);
  }
});

test("no private signing artifacts are present outside dependencies", () => {
  const forbidden = /\.(?:jks|keystore|p12|mobileprovision|p8)$/i;
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if ([".git", "node_modules"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  assert.deepEqual(walk(".").filter(path => forbidden.test(path)), []);
});

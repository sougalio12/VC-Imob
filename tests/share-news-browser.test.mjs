import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const widths = [320, 375, 390, 430, 768, 1024, 1366, 1920];
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

function cdp(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } };
  return {
    ready: socket.readyState === WebSocket.OPEN ? Promise.resolve() : new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }),
    send(method, params = {}) { return new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ id: request, method, params })); }); },
    close() { socket.close(); }
  };
}

async function waitJson(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Chrome CDP indisponível");
}

test("share and news UI is responsive at all required widths", { timeout: 120000, skip: !existsSync(chrome) }, async () => {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = normalize(join(root, relative));
      if (!file.startsWith(normalize(root)) || (await stat(file)).isDirectory()) throw new Error("not found");
      response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, debugPort = 14000 + Math.floor(Math.random() * 8000), profile = mkdtempSync(join(tmpdir(), "vc-share-news-"));
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-allow-origins=*", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let page;
  try {
    const targets = await waitJson(`http://127.0.0.1:${debugPort}/json/list`);
    page = cdp(targets.find(item => item.type === "page").webSocketDebuggerUrl); await page.ready;
    await page.send("Page.enable"); await page.send("Runtime.enable");
    const evaluate = async expression => { const result = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const navigate = async url => { await page.send("Page.navigate", { url }); for (let i = 0; i < 80; i += 1) { if (await evaluate("document.readyState === 'complete'")) break; await new Promise(resolve => setTimeout(resolve, 50)); } await new Promise(resolve => setTimeout(resolve, 150)); };
    const waitFor = async expression => { for (let i = 0; i < 100; i += 1) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timeout waiting for ${expression}`); };
    for (const width of widths) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: width <= 430 ? 844 : 1000, deviceScaleFactor: 1, mobile: width <= 430 });
      await navigate(`http://127.0.0.1:${port}/index.html`);
      await waitFor("document.querySelectorAll('.property-share-button').length === 5");
      const home = await evaluate(`(()=>({viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,shares:[...document.querySelectorAll('.property-share-button')].length,targets:[...document.querySelectorAll('.property-share-button')].every(x=>x.getBoundingClientRect().height>=43.5),news:[...document.querySelectorAll('.news-card')].length,newsContained:[...document.querySelectorAll('.news-card')].every(x=>{const r=x.getBoundingClientRect();return r.left>=-1&&r.right<=document.documentElement.clientWidth+1})}))()`);
      assert.ok(home.page <= home.viewport + 1, `site ${width}px has horizontal overflow`);
      assert.equal(home.shares, 5, `site ${width}px share buttons`); assert.equal(home.targets, true); assert.ok(home.news > 0); assert.equal(home.newsContained, true);
      await navigate(`http://127.0.0.1:${port}/imovel.html?codigo=VCI000006`);
      await waitFor("Boolean(document.getElementById('propertyShareButton'))");
      const detail = await evaluate(`(()=>{const b=document.getElementById('propertyShareButton');return{page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,text:b?.textContent.trim(),height:b?.getBoundingClientRect().height}})()`);
      assert.ok(detail.page <= detail.viewport + 1, `detail ${width}px has horizontal overflow`); assert.equal(detail.text, "Compartilhar imóvel"); assert.ok(detail.height >= 43.5);
    }
    for (const code of ["VCI000002", "VCI000003", "VCI000004", "VCI000005", "VCI000006"]) {
      await navigate(`http://127.0.0.1:${port}/imovel.html?codigo=${code}`);
      await waitFor("Boolean(document.querySelector('.property-detail-code'))");
      assert.equal(await evaluate(`document.querySelector('.property-detail-code')?.textContent.includes(${JSON.stringify(code)})`), true, `${code} public URL`);
    }
  } finally {
    page?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
    for (let attempt = 0; attempt < 5; attempt += 1) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  }
});

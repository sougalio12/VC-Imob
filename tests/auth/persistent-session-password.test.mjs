import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const authSource = readFileSync("crm/js/supabase.js", "utf8");
const toggleSource = readFileSync("crm/js/password-toggle.js", "utf8");
const login = readFileSync("crm/login.html", "utf8");
const signup = readFileSync("crm/signup.html", "utf8");
const toggleCss = readFileSync("crm/css/password-toggle.css", "utf8");
const serviceWorker = readFileSync("crm/service-worker.js", "utf8");

function storage(values = new Map()) {
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function authHarness({ persistentSession = null, legacySession = null, responses = [] } = {}) {
  const localValues = new Map();
  const sessionValues = new Map();
  if (persistentSession) localValues.set("vc-imob-session", JSON.stringify(persistentSession));
  if (legacySession) sessionValues.set("vc-imob-session", JSON.stringify(legacySession));
  const calls = [];
  const context = vm.createContext({
    console, Date, JSON, Error,
    localStorage: storage(localValues),
    sessionStorage: storage(sessionValues),
    CRM_CONFIG: { supabaseUrl: "https://project.supabase.test", supabasePublishableKey: "publishable-test-key" },
    isSupabaseConfigured: () => true,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response?.throws) throw new TypeError("network unavailable");
      const resolved = response || { ok: false, status: 500, data: {} };
      return { ok: resolved.ok, status: resolved.status, json: async () => resolved.data, text: async () => JSON.stringify(resolved.data) };
    }
  });
  vm.runInContext(authSource, context);
  return {
    calls, localValues, sessionValues,
    getStored: vm.runInContext("getStoredSession", context),
    store: vm.runInContext("storeSession", context),
    clear: vm.runInContext("clearStoredSession", context),
    refresh: vm.runInContext("refreshStoredSession", context),
    valid: vm.runInContext("getValidSession", context),
    signIn: vm.runInContext("signInWithPassword", context),
    signOut: vm.runInContext("signOutFromSupabase", context)
  };
}

const session = (overrides = {}) => ({
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "user-1" },
  ...overrides
});

test("PERSIST01 login stores the Supabase session persistently, never the password", async () => {
  const fresh = session();
  const run = authHarness({ responses: [{ ok: true, status: 200, data: fresh }] });
  await run.signIn("owner@example.test", "correct-password");
  assert.deepEqual(JSON.parse(run.localValues.get("vc-imob-session")), fresh);
  assert.equal(run.sessionValues.has("vc-imob-session"), false);
  assert.doesNotMatch(run.localValues.get("vc-imob-session"), /correct-password/);
});

test("PERSIST02 a valid persistent session is remotely verified after reopening", async () => {
  const run = authHarness({ persistentSession: session(), responses: [{ ok: true, status: 200, data: { id: "user-1" } }] });
  assert.equal((await run.valid({ verify: true })).user.id, "user-1");
  assert.match(run.calls[0].url, /\/auth\/v1\/user$/);
});

test("PERSIST03 an expired access token is renewed with its refresh token", async () => {
  const refreshed = session({ access_token: "renewed-access", refresh_token: "rotated-refresh" });
  const run = authHarness({ persistentSession: session({ expires_at: 1 }), responses: [{ ok: true, status: 200, data: refreshed }] });
  assert.equal((await run.valid({ verify: true })).access_token, "renewed-access");
  assert.equal(JSON.parse(run.localValues.get("vc-imob-session")).refresh_token, "rotated-refresh");
});

test("PERSIST04 revoked or invalid refresh tokens clear only the invalid session", async () => {
  const run = authHarness({ persistentSession: session(), responses: [{ ok: false, status: 401, data: {} }, { ok: false, status: 400, data: {} }] });
  assert.equal(await run.valid({ verify: true }), null);
  assert.equal(run.localValues.has("vc-imob-session"), false);
});

test("PERSIST05 temporary refresh failures preserve a recoverable session", async () => {
  for (const response of [{ throws: true }, { ok: false, status: 503, data: {} }]) {
    const original = session({ expires_at: 1 });
    const run = authHarness({ persistentSession: original, responses: [response] });
    assert.equal((await run.valid({ verify: true })).refresh_token, original.refresh_token);
    assert.equal(JSON.parse(run.localValues.get("vc-imob-session")).refresh_token, original.refresh_token);
  }
});

test("PERSIST06 manual logout clears persistent and legacy session copies", async () => {
  const run = authHarness({ persistentSession: session(), legacySession: session(), responses: [{ ok: true, status: 200, data: {} }, { ok: true, status: 204, data: null }] });
  await run.signOut();
  assert.equal(run.localValues.has("vc-imob-session"), false);
  assert.equal(run.sessionValues.has("vc-imob-session"), false);
});

test("PERSIST07 legacy sessionStorage sessions migrate once to persistent storage", () => {
  const run = authHarness({ legacySession: session() });
  assert.equal(run.getStored().user.id, "user-1");
  assert.equal(run.localValues.has("vc-imob-session"), true);
  assert.equal(run.sessionValues.has("vc-imob-session"), false);
});

test("PASSWORD01 login and signup use accessible non-submit toggles and correct autocomplete", () => {
  assert.match(login, /autocomplete="current-password"/);
  assert.match(signup, /autocomplete="new-password"/);
  for (const page of [login, signup]) {
    assert.match(page, /class="password-toggle" type="button"/);
    assert.match(page, /aria-label="Mostrar senha"/);
    assert.match(page, /password-toggle\.js\?v=auth-persistence-20260921/);
  }
  assert.match(toggleCss, /width:44px;height:44px/);
  assert.match(toggleCss, /padding-right:52px/);
});

test("PASSWORD02 toggling preserves value and selection in both directions", () => {
  const listeners = {};
  const input = { type: "password", value: "secret-value", selectionStart: 3, selectionEnd: 3, focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const attributes = { "aria-controls": "password", "aria-label": "Mostrar senha" };
  const button = { getAttribute: key => attributes[key], setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(toggleSource, { document: { querySelectorAll: () => [button], getElementById: () => input }, requestAnimationFrame: fn => fn() });
  listeners.click();
  assert.equal(input.type, "text"); assert.equal(input.value, "secret-value"); assert.equal(input.selectionStart, 3); assert.equal(attributes["aria-label"], "Ocultar senha");
  listeners.click();
  assert.equal(input.type, "password"); assert.equal(input.value, "secret-value"); assert.equal(attributes["aria-label"], "Mostrar senha");
});

test("PWA01 cache version changed and private/auth responses remain outside Cache Storage", () => {
  assert.match(serviceWorker, /vc-imob-shell-final-audit-20260923/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(serviceWorker, /supabase\.co|\/auth\/v1|\/rest\/v1/);
  assert.match(serviceWorker, /password-toggle\.css/);
  assert.match(serviceWorker, /password-toggle\.js/);
});

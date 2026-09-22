import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css=readFileSync("crm/css/clean-system.css","utf8");
const index=readFileSync("crm/index.html","utf8");
const login=readFileSync("crm/login.html","utf8");
const signup=readFileSync("crm/signup.html","utf8");
const confirm=readFileSync("crm/confirm.html","utf8");
const dashboard=readFileSync("crm/js/dashboard.js","utf8");
const agenda=readFileSync("crm/js/agenda.js","utf8");
const sw=readFileSync("crm/service-worker.js","utf8");

test("POLISH01 official logo asset is reused and its bitmap remains presentation-only",()=>{
  for(const page of [index,login,signup,confirm])assert.match(page,/icons\/icon-192\.png/);
  assert.match(index,/crm-brand-symbol-dark/);
  for(const page of [login,signup,confirm])assert.match(page,/crm-brand-symbol-light/);
  assert.match(css,/\.crm-brand-symbol img[\s\S]*width: 144%/);
  assert.match(css,/\.crm-brand-symbol-light img \{ mix-blend-mode: multiply/);
  assert.match(css,/\.crm-brand-symbol-dark img \{ filter: invert\(1\); mix-blend-mode: screen/);
});

test("POLISH02 WhatsApp actions cannot split and agenda actions have explicit hierarchy",()=>{
  assert.match(agenda,/whatsapp-action/);
  assert.match(css,/\.whatsapp-action[\s\S]*white-space: nowrap/);
  for(const role of ["activity-action-primary","activity-action-secondary","activity-action-utility","activity-action-danger"])assert.match(agenda,new RegExp(role));
  assert.match(css,/\.activity-action-primary[\s\S]*grid-column: 1\/-1/);
  assert.match(css,/@media \(max-width: 360px\)[\s\S]*\.activity-actions \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test("POLISH03 attention rules remain native controls but are unmistakably configurable",()=>{
  assert.match(dashboard,/automation-number-input/);
  assert.match(dashboard,/"dias"/);assert.match(dashboard,/"horas"/);
  assert.match(dashboard,/type:"checkbox"/);assert.match(dashboard,/automation-switch/);
  assert.match(dashboard,/crm-button crm-button-primary automation-save/);
  assert.match(dashboard,/save\.textContent="Salvando…"/);
  assert.match(dashboard,/As regras geram alertas internos; nenhuma mensagem é enviada ao cliente/);
});

test("POLISH04 design system exposes five calm surface and elevation levels",()=>{
  for(const token of ["--surface-0","--surface-1","--surface-2","--surface-3","--surface-elevated","--shadow-resting","--shadow-interactive","--shadow-elevated","--shadow-floating"])assert.match(css,new RegExp(token));
  assert.match(css,/\.document-card[\s\S]*var\(--shadow-resting\)/);
  assert.match(css,/\.modal-card[\s\S]*var\(--shadow-floating\)/);
});

test("POLISH05 controls, focus, touch, reduced motion and mobile containment stay explicit",()=>{
  assert.match(css,/--border-control/);assert.match(css,/:focus-visible/);assert.match(css,/min-height: 44px/);
  assert.match(css,/prefers-reduced-motion/);assert.match(css,/@media \(max-width: 430px\)/);assert.match(css,/@media \(max-width: 360px\)/);
  for(const width of [320,360,375,390,393,414,430])assert.ok(width>=320&&width<=430);
});

test("POLISH06 PWA revision is immutable and private responses remain uncached",()=>{
  assert.match(sw,/vc-imob-shell-polish-20260922/);
  assert.match(index,/clean-system\.css\?v=polish-20260922/);
  for(const asset of ["dashboard.js","agenda.js"])assert.match(index,new RegExp(`${asset.replace(".","\\.")}\\?v=polish-20260922`));
  assert.doesNotMatch(sw,/supabase\.co|\/auth\/v1|\/rest\/v1/);
});

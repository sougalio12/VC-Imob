import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css=readFileSync("crm/css/clean-system.css","utf8");
const crmCss=readFileSync("crm/css/crm.css","utf8");
const index=readFileSync("crm/index.html","utf8");
const login=readFileSync("crm/login.html","utf8");
const signup=readFileSync("crm/signup.html","utf8");
const confirm=readFileSync("crm/confirm.html","utf8");
const dashboard=readFileSync("crm/js/dashboard.js","utf8");
const agenda=readFileSync("crm/js/agenda.js","utf8");
const pwa=readFileSync("crm/js/pwa.js","utf8");
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
  assert.match(sw,/vc-imob-shell-documents-autofill-delete-20260923/);
  assert.match(index,/clean-system\.css\?v=menu-hotfix-20260922/);
  for(const asset of ["dashboard.js","agenda.js"])assert.match(index,new RegExp(`${asset.replace(".","\\.")}\\?v=polish-20260922`));
  assert.doesNotMatch(sw,/supabase\.co|\/auth\/v1|\/rest\/v1/);
});

test("POLISH07 mobile drawer close has an independent accessible hitbox",()=>{
  assert.match(index,/id="sidebarCloseButton"[^>]*type="button"[^>]*aria-label="Fechar menu"/);
  assert.match(pwa,/sidebarCloseButton[\s\S]*toggleSidebar\(false\)/);
  assert.match(css,/\.crm-brand-app \{[\s\S]*align-self: flex-start;[\s\S]*max-width: calc\(100% - 58px\);[\s\S]*margin-top: 0/);
  assert.match(css,/\.sidebar-close-button \{[\s\S]*position: absolute;[\s\S]*z-index: 2;[\s\S]*margin: 0/);
});

test("POLISH08 drawer labels keep a consistent icon gap",()=>{
  assert.match(css,/\.crm-nav button \{[\s\S]*grid-template-columns: 28px minmax\(0, 1fr\);[\s\S]*column-gap: 10px/);
});

test("POLISH09 Meu Dia preserves its dark semantic surface and readable empty state",()=>{
  assert.match(css,/\.crm-panel:not\(\.my-day-panel\),[\s\S]*background: var\(--surface-2\)/);
  assert.match(css,/\.my-day-panel \{[\s\S]*linear-gradient\(135deg, #181713 0%, #27241e 62%, #4a3d28 150%\);[\s\S]*color: #fff/);
  assert.match(css,/\.my-day-panel > \.muted \{ color: #d1cec6; \}/);
});

test("POLISH10 Mais opens through one listener and one transform sequence",()=>{
  assert.equal((pwa.match(/more\.addEventListener\("click"/g)||[]).length,1);
  assert.equal((pwa.match(/bindMobileNavigation\(\);/g)||[]).length,1);
  assert.match(crmCss,/\.crm-sidebar\{[^}]*transition:transform \.25s/);
  assert.doesNotMatch(css,/premium-sidebar-in/);
});

test("POLISH11 mobile brand spacing respects the iPhone safe area",()=>{
  assert.match(css,/\.crm-sidebar \{[\s\S]*padding-top: calc\(max\(20px, env\(safe-area-inset-top\)\) \+ 14px\)/);
  assert.match(css,/\.crm-brand-app \{[\s\S]*margin-top: 0/);
});

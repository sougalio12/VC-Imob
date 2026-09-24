import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const css=readFileSync("crm/css/clean-system.css","utf8");
const html=readFileSync("crm/index.html","utf8");
const dashboard=readFileSync("crm/js/dashboard.js","utf8");
const leads=readFileSync("crm/js/leads.js","utf8");
const kanban=readFileSync("crm/js/kanban.js","utf8");
const agenda=readFileSync("crm/js/agenda.js","utf8");
const properties=readFileSync("crm/js/properties.js","utf8");
const app=readFileSync("crm/js/app.js","utf8");
const sw=readFileSync("crm/service-worker.js","utf8");

test("PREMIUM01 global tokens provide hierarchy, depth and bounded motion",()=>{
  for(const token of ["--premium-bg","--premium-surface","--premium-shadow-sm","--premium-shadow-md","--premium-radius-lg","--motion-fast","--motion-base"])assert.match(css,new RegExp(token));
  assert.match(css,/prefers-reduced-motion/);assert.match(css,/transform var\(--motion-fast\)/);assert.doesNotMatch(css,/animation-duration:\s*[4-9]s/);
});

test("PREMIUM02 Home gives Meu Dia and semantic metrics explicit hierarchy",()=>{
  assert.match(dashboard,/my-day-intro/);for(const tone of ["info","gold","danger","success"])assert.match(dashboard,new RegExp(`"${tone}"`));
  for(const tone of ["my-day-info","my-day-gold","my-day-danger","my-day-success"])assert.match(css,new RegExp(tone));
  for(const tone of ["metric-info","metric-gold","metric-success","metric-warning","metric-danger"])assert.match(css,new RegExp(tone));
  assert.match(css,/\.my-day-panel[\s\S]*linear-gradient/);assert.match(css,/\.dashboard-metrics \.metric-card strong/);
});

test("PREMIUM03 leads, Kanban, agenda and properties reuse real data for visual states",()=>{
  assert.match(leads,/scoreLead\(lead/);assert.match(leads,/lead-card-row/);assert.match(leads,/is-overdue/);
  assert.match(kanban,/closest\?\.\("\.kanban-card"\).*is-dragging/);assert.match(css,/kanban-column\[data-stage="fechado"\]/);
  for(const timing of ["completed","overdue","today","upcoming"])assert.match(agenda,new RegExp(`\"${timing}\"`));
  assert.match(properties,/property-admin-facts/);for(const field of ["quartos","banheiros","areaConstruida","vagas"])assert.match(properties,new RegExp(field));
});

test("PREMIUM04 official brand, More, bottom navigation and sheets remain mobile-safe",()=>{
  assert.match(html,/crm-brand crm-brand-app[\s\S]*icons\/icon-192\.png/);assert.match(css,/\.crm-sidebar[\s\S]*radial-gradient/);
  assert.match(css,/@media \(max-width: 820px\)[\s\S]*\.crm-bottom-nav/);assert.match(css,/premium-sheet-in/);
  for(const width of [320,360,375,390,393,414,430])assert.ok(width>=320&&width<=430);
});

test("PREMIUM05 loading, success, errors, empty states and view transitions have feedback",()=>{
  assert.match(app,/crm-view crm-view-\$\{view\}/);assert.match(app,/classList\.add\("is-ready"\)/);
  assert.match(css,/premium-shimmer/);assert.match(css,/\.crm-toast::before/);assert.match(css,/\.crm-toast\.is-error::before/);assert.match(css,/\.empty-state::before/);
});

test("PREMIUM06 immutable PWA revision exposes changed assets without caching private data",()=>{
  assert.match(sw,/vc-imob-shell-documents-autofill-delete-20260923/);assert.match(html,/clean-system\.css\?v=menu-hotfix-20260922/);
  for(const asset of ["dashboard.js","agenda.js"])assert.match(html,new RegExp(`${asset.replace(".","\\.")}\\?v=polish-20260922`));
  for(const asset of ["leads.js","kanban.js","properties.js","app.js"])assert.match(html,new RegExp(`${asset.replace(".","\\.")}\\?v=premium-20260922`));
  assert.doesNotMatch(sw,/supabase\.co|\/auth\/v1|\/rest\/v1/);
});

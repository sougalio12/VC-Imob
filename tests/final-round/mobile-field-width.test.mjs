import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const responsive = read("crm/css/responsive-system.css");
const html = read("crm/index.html");
const sw = read("crm/service-worker.js");
const allCss = readdirSync("crm/css").filter(name => name.endsWith(".css")).map(name => read(`crm/css/${name}`)).join("\n");
const allJs = readdirSync("crm/js").filter(name => name.endsWith(".js")).map(name => read(`crm/js/${name}`)).join("\n");
const viewports = [320, 360, 375, 390, 393, 414, 430];

test("MOBILEWIDTH01 every supported iPhone width retains a positive, contained form content box", () => {
  for (const viewport of viewports) {
    const pageGutters = 24; // 12 px each side at <= 430 px
    const panelPadding = 28; // 14 px each side
    const available = viewport - pageGutters - panelPadding;
    assert.ok(available >= 268, `${viewport}px must leave a usable form width`);
    assert.ok(available <= viewport, `${viewport}px content must not exceed its viewport`);
  }
  assert.match(responsive, /@media \(max-width:\s*430px\)/);
  assert.match(responsive, /padding-inline:\s*max\(12px,[\s\S]*safe-area-inset-left[\s\S]*max\(12px,[\s\S]*safe-area-inset-right/);
});

test("MOBILEWIDTH02 dynamic wrappers and every native form control can shrink below intrinsic width", () => {
  assert.match(responsive, /\.crm-content :where\(div, section, article,[\s\S]*fieldset, label\)/);
  assert.match(responsive, /min-inline-size:\s*0/);
  assert.match(responsive, /\.crm-app input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*\.crm-app select,[\s\S]*\.crm-app textarea/);
  assert.match(responsive, /inline-size:\s*100%[\s\S]*max-inline-size:\s*100%/);
  assert.match(responsive, /box-sizing:\s*border-box/);
  assert.match(responsive, /\.crm-content fieldset,[\s\S]*\.modal-card fieldset[\s\S]*width:\s*100%/);
  assert.match(responsive, /::-webkit-date-and-time-value[\s\S]*min-inline-size:\s*0/);
  assert.match(responsive, /::-webkit-datetime-edit[\s\S]*min-inline-size:\s*0/);
  assert.match(responsive, /font-size:\s*16px/);
});

test("MOBILEWIDTH03 mobile grids, actions and toolbar controls collapse without page overflow", () => {
  assert.match(responsive, /\.form-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(responsive, /\.toolbar-controls > :where\(input, select, textarea, label\)[\s\S]*flex:\s*1 1 100%/);
  assert.match(responsive, /\.crm-form > \.crm-button,[\s\S]*width:\s*100%/);
  assert.match(responsive, /\.status-indicator,[\s\S]*\.score-chip,[\s\S]*\.stage[\s\S]*white-space:\s*normal/);
  assert.doesNotMatch(allJs, /style\.(?:width|minWidth|maxWidth)\s*=\s*["'`]\d{3,}px/);
});

test("MOBILEWIDTH04 horizontal scroll remains isolated to explicitly scrollable widgets", () => {
  assert.match(responsive, /\.lead-table-wrap,[\s\S]*\.kanban,[\s\S]*\.capture-board,[\s\S]*\.block4-tabs,[\s\S]*\.property-editor-progress/);
  assert.match(allCss, /\.lead-table-wrap\{overflow:auto/);
  assert.match(allCss, /\.kanban\{[^}]*overflow:auto/);
  assert.match(allCss, /\.capture-board\{[^}]*overflow-x:auto/);
});

test("MOBILEWIDTH05 the final stylesheet and service worker use a fresh immutable revision", () => {
  assert.ok(html.indexOf("responsive-system.css?v=mobile-fields-20260916b") > html.indexOf("assistant.css"));
  assert.match(sw, /vc-imob-shell-documents-autofill-delete-20260923/);
  assert.match(sw, /\.\/css\/responsive-system\.css/);
});

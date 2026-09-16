import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const migration=readFileSync("supabase/migrations/20260917000000_real_estate_documents.sql","utf8");
const frontend=readFileSync("crm/js/documents.js","utf8");
const pdfSource=readFileSync("crm/js/document-pdf.js","utf8");
const css=readFileSync("crm/css/documents.css","utf8");
const html=readFileSync("crm/index.html","utf8");
const legal=readFileSync("docs/legal-document-templates.md","utf8");
const sw=readFileSync("crm/service-worker.js","utf8");

test("DOC01 controlled, immutable and versioned schema is tenant scoped",()=>{
  for(const table of ["document_templates","real_estate_documents","real_estate_document_versions","real_estate_document_previews"]){assert.match(migration,new RegExp(`create table public\\.${table}`));assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));assert.match(migration,new RegExp(`alter table public\\.${table} force row level security`));}
  assert.match(migration,/unique \(document_id, version_no\)/);
  assert.match(migration,/revoke all on public\.document_templates,public\.real_estate_documents/);
  assert.doesNotMatch(migration,/grant (?:insert|update|delete).*real_estate_document/i);
  assert.doesNotMatch(migration,/service_role|disable row level security/i);
});

test("DOC02 official sources and legal limitations are documented",()=>{
  for(const source of ["Lei nº 6.530/1978","Decreto nº 81.871/1978","Código Civil","Resolução COFECI nº 1.504/2023","LGPD"])assert.match(legal,new RegExp(source));
  assert.match(legal,/não substitui a revisão por advogado/i);
  assert.match(legal,/não predefine multa, percentual, arras/i);
  assert.match(legal,/não é apresentado como registro no SGR/i);
});

test("DOC03 preview receipt binds payload and finalization blocks missing fields",()=>{
  assert.match(migration,/payload_hash text not null/);
  assert.match(migration,/expires_at timestamptz not null default \(now\(\) \+ interval '30 minutes'\)/);
  assert.match(migration,/real_estate_document_payload_hash\(target_payload\)<>preview\.payload_hash/);
  assert.match(migration,/cardinality\(version_row\.missing_fields\)>0/);
  assert.match(migration,/DOCUMENT_REQUIRED_FIELDS_MISSING/);
  assert.match(frontend,/Preview obrigatório/);
  assert.match(frontend,/Finalizar versão/);
});

test("DOC04 controlled fields require explicit sensitive choices",()=>{
  assert.match(migration,/target_payload->>'exclusivity' not in \('exclusive','non_exclusive'\)/);
  assert.match(migration,/target_payload->>'arras_option' not in \('none','applicable'\)/);
  assert.match(migration,/target_payload->>'financing_option' not in \('none','applicable'\)/);
  assert.match(migration,/DOCUMENT_INVALID_FIELD/);
  assert.doesNotMatch(frontend,/innerHTML|contentEditable|eval\(/);
});

test("DOC05 private PDFs are generated from finalized content without public storage",()=>{
  const context={globalThis:{},Blob,Uint8Array,setTimeout};vm.runInNewContext(pdfSource,context);
  const blob=context.globalThis.buildRealEstateDocumentPdf({title:"Autorização de venda",content:"CONTEÚDO FINAL\n\nPreço: R$ 550.000,00\n\n________________________________________\nCONTRATANTE",versionLabel:"Documento v1 · Modelo v1",generatedAt:"17/09/2026 10:00"});
  assert.equal(blob.type,"application/pdf");assert.ok(blob.size>500);
  assert.match(migration,/status='finalized'/);
  assert.match(frontend,/record_real_estate_document_pdf/);
  assert.doesNotMatch(migration,/storage\.objects|publicUrl|public bucket/i);
});

test("DOC06 mobile UI is one-column, accessible and PWA-versioned",()=>{
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/max-height:calc\(100dvh - env\(safe-area-inset-top\)/);
  assert.match(css,/min-height:44px/);
  assert.match(html,/data-view-link="documents"/);
  assert.match(html,/document-pdf\.js/);assert.match(html,/documents\.js/);
  assert.match(sw,/vc-imob-shell-documents-20260917/);assert.match(sw,/\.\/css\/documents\.css/);
});

test("DOC07 audit metadata never stores the full private document",()=>{
  for(const action of ["document_previewed","document_created","document_version_created","document_submitted_for_review","document_finalized","document_canceled","document_pdf_generated"])assert.match(migration,new RegExp(action));
  assert.doesNotMatch(migration,/audit_events[^;]+rendered_content/s);
  assert.doesNotMatch(migration,/audit_events[^;]+data_snapshot/s);
});


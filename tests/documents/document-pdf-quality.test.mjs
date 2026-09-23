import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const pdfSource=readFileSync("crm/js/document-pdf.js","utf8");
const migration=readFileSync("supabase/migrations/20260917120000_document_pdf_identity_quality.sql","utf8");
const operations=readFileSync("crm/js/operations-suite.js","utf8");
const settings=readFileSync("crm/js/team-operations.js","utf8");
const documents=readFileSync("crm/js/documents.js","utf8");
const css=readFileSync("crm/css/documents.css","utf8");
const context={globalThis:{},Blob,Uint8Array,setTimeout};
vm.runInNewContext(pdfSource,context);
const api=context.globalThis;

const title="AUTORIZAÇÃO / CONTRATO DE INTERMEDIAÇÃO PARA VENDA DE IMÓVEL";
const signature="________________________________________\nCONTRATANTE";
const paragraph="O contratante confirma os dados reais cadastrados e as condições comerciais expressamente escolhidas para esta operação imobiliária.";
const identity={organization_name:"Valdiney Capistrano",trade_name:"Valdiney Capistrano",creci:"CRECI cadastrado",public_phone:"Contato cadastrado"};

function contentWithSections(count){return [title,...Array.from({length:count},(_,index)=>`${index+1}. SEÇÃO PROFISSIONAL\n\n${paragraph} ${paragraph}`),signature].join("\n\n");}

test("DOCPDF01 section headings and compact signatures never become orphan blocks",()=>{
  const pages=api.layoutRealEstateDocumentPdf({title,content:contentWithSections(22),identity});
  assert.ok(pages.length>=3);
  for(const page of pages){
    const elements=page.elements;
    elements.forEach((element,index)=>{
      if(/^\d+\. SEÇÃO/.test(element.text))assert.ok(elements[index+1]&&!/^\d+\. SEÇÃO/.test(elements[index+1].text),`orphan heading on page ${pages.indexOf(page)+1}`);
      if(/^_+$/.test(element.text))assert.equal(elements[index+1]?.text,"CONTRATANTE");
    });
  }
});

test("DOCPDF09 final signature section remains together on one page",()=>{
  const content=[title,...Array.from({length:12},(_,index)=>`${index+1}. SEÇÃO PROFISSIONAL\n\n${paragraph} ${paragraph}`),"13. LOCAL, DATA E ASSINATURAS","Cuiabá/MT, 22 de setembro de 2026.",signature,"________________________________________\nCORRETOR(A) / IMOBILIÁRIA"].join("\n\n"),pages=api.layoutRealEstateDocumentPdf({title,content,identity});
  const signaturePageIndexes=pages.flatMap((page,pageIndex)=>page.elements.some(element=>/^_+$/.test(element.text))?[pageIndex]:[]);
  assert.equal(new Set(signaturePageIndexes).size,1);const page=pages[signaturePageIndexes[0]];assert.ok(page.elements.some(element=>element.text==="13. LOCAL, DATA E ASSINATURAS"));
});

test("DOCPDF02 logo placement preserves horizontal, square and vertical proportions",()=>{
  const bytes=new Uint8Array([0xff,0xd8,0xff,0xd9]);
  for(const [width,height] of [[1280,692],[500,500],[300,900],[6000,1200]]){
    const placed=api.documentLogoPlacement({bytes,width,height});
    assert.ok(placed.width<=270&&placed.height<=92);
    assert.ok(Math.abs(placed.width/placed.height-width/height)<0.001);
    assert.ok(placed.x>=52&&placed.x+placed.width<=543);
  }
  assert.equal(api.documentLogoPlacement(null),null);
  const logo={bytes:new Uint8Array([0xff,0xd8,0xff,0xd9]),width:1280,height:692},pages=api.layoutRealEstateDocumentPdf({title,content:contentWithSections(2),identity,logo});
  assert.ok(pages[0].elements[0].y<=570,"first content line must not collide with the logo/title metadata header");
});

test("DOCPDF03 PDF supports short and multipage content with Portuguese pagination",async()=>{
  const short=api.buildRealEstateDocumentPdf({title,content:contentWithSections(2),versionLabel:"Documento v1 · Modelo v1",generatedAt:"17/09/2026 10:00",identity});
  const mediumSectionCount=Array.from({length:20},(_,index)=>index+3).find(count=>api.layoutRealEstateDocumentPdf({title,content:contentWithSections(count),identity}).length===2);
  assert.ok(mediumSectionCount,"the engine must produce a representative two-page document");
  const medium=api.buildRealEstateDocumentPdf({title,content:contentWithSections(mediumSectionCount),versionLabel:"Documento v2 · Modelo v2",documentIdentifier:"DOC-TESTE-002",generatedAt:"22/09/2026 10:00",identity});
  const long=api.buildRealEstateDocumentPdf({title,content:contentWithSections(22),versionLabel:"Documento v2 · Modelo v1",generatedAt:"17/09/2026 10:00",identity});
  const shortText=Buffer.from(await short.arrayBuffer()).toString("latin1"),mediumText=Buffer.from(await medium.arrayBuffer()).toString("latin1"),longText=Buffer.from(await long.arrayBuffer()).toString("latin1");
  assert.match(shortText,/\/Count 1\b/);
  assert.match(mediumText,/\/Count 2\b/);assert.match(mediumText,/DOC-TESTE-002/);
  assert.match(longText,/\/Count [3-9]\b/);
  assert.match(longText,/Pá(?:gina|\x67ina)/);
  assert.doesNotMatch(longText,/\(Pagina /);
});

test("DOCPDF04 supplied owner logo is embedded byte-for-byte and never assigned globally",()=>{
  const encoded=migration.match(/decode\('([^']+)','base64'\)/)?.[1];
  assert.ok(encoded);
  assert.equal(createHash("sha256").update(Buffer.from(encoded,"base64")).digest("hex"),"6689d5f4a59f8b261d321bd57322fb08b5e73ed088b5f1704909c581eec60924");
  assert.match(migration,/provider='internal'.*billing_exempt/s);
  assert.doesNotMatch(migration,/update public\.organizations set current_document_identity_id=identity_id\s*;/i);
});

test("DOCPDF05 identity upload is validated, tenant-scoped, private and audited without bytes",()=>{
  assert.match(migration,/enable row level security/);assert.match(migration,/force row level security/);
  assert.match(migration,/role not in \('owner','manager'\)/);assert.match(migration,/DOCUMENT_IDENTITY_ACCESS_DENIED/);
  assert.match(migration,/document_logo_is_valid/);assert.match(migration,/3145728/);
  assert.match(migration,/document_logo_(?:added|replaced|removed)/);
  assert.doesNotMatch(migration,/jsonb_build_object\([^;]*logo_bytes/s);
  assert.match(operations,/validateDocumentLogoFile/);assert.match(operations,/image\/(?:jpeg|png|webp)/);
  assert.match(settings,/Identidade \/ Documentos/);assert.match(settings,/Substituir logo|Enviar logo/);assert.match(settings,/Remover logo/);
});

test("DOCPDF06 finalized versions retain identity snapshots and preview uses the same PDF engine",()=>{
  assert.match(migration,/document_identity_id uuid references public\.organization_document_identities/);
  assert.match(migration,/identity_snapshot jsonb not null/);
  assert.match(migration,/preview\.document_identity_id,preview\.identity_snapshot/);
  assert.match(documents,/document_identity_id/);assert.match(documents,/layoutRealEstateDocumentPdf/);
  assert.match(documents,/prepareDocumentLogoForPdf/);
});

test("DOCPDF07 mobile identity and preview UI remain contained and touch accessible",()=>{
  assert.match(css,/document-identity/);assert.match(css,/max-width:100%/);assert.match(css,/min-width:0/);
  assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
});

test("DOCPDF08 punctuation and legal date formatting are composed semantically",()=>{
  assert.match(migration,/right\(value,1\) ~ '\[\\\.,;:!\?\]'/);
  assert.match(migration,/array\['janeiro','fevereiro','março','abril'/);
  assert.doesNotMatch(migration,/regexp_replace\([^;]*\\\.\\\./s);
});

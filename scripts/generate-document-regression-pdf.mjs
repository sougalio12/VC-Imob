import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import vm from "node:vm";

const pdfSource=readFileSync("crm/js/document-pdf.js","utf8");
const migration=readFileSync("supabase/migrations/20260917120000_document_pdf_identity_quality.sql","utf8");
const context={globalThis:{},Blob,Uint8Array,setTimeout};
vm.runInNewContext(pdfSource,context);
const encoded=migration.match(/decode\('([^']+)','base64'\)/)?.[1];
if(!encoded)throw new Error("Logo de regressão ausente.");

const title="AUTORIZAÇÃO / CONTRATO DE INTERMEDIAÇÃO PARA VENDA DE IMÓVEL";
const content=[
  title,
  "1. PARTES",
  "CONTRATANTE: Proprietário cadastrado. Contato: Preenchimento necessário.\nCONTRATADO: Valdiney Capistrano, CRECI Preenchimento necessário. Contato: Preenchimento necessário.",
  "2. OBJETO",
  "O contratante autoriza a intermediação da venda do seguinte imóvel: imóvel residencial com área, características e garagem. Matrícula/registro, se cadastrado: Preenchimento necessário.",
  "3. PREÇO E CONDIÇÕES COMERCIAIS",
  "Preço pretendido: R$ 550.000,00. Condições: pagamento conforme condições expressamente definidas pelas partes.",
  "4. MODALIDADE DA INTERMEDIAÇÃO",
  "NÃO EXCLUSIVA. O contratante poderá atuar diretamente ou por outros intermediadores, observados os negócios resultantes da atividade do contratado e as condições expressamente pactuadas.",
  "5. DIVULGAÇÃO",
  "Autorizada a divulgação do imóvel nos canais profissionais selecionados pelo contratante.",
  "6. DEVERES DAS PARTES",
  "O contratado atuará com diligência e prudência, prestando as informações relevantes de que disponha. O contratante prestará informações verdadeiras e disponibilizará os elementos necessários à intermediação. As partes reconhecem que dados não cadastrados permanecem indicados como preenchimento necessário e não são presumidos pelo sistema.",
  "7. REMUNERAÇÃO",
  "Remuneração conforme condição expressamente preenchida e revisada pelas partes antes da finalização. Este documento não inventa percentuais, valores, documentos pessoais ou registros ausentes.",
  "8. PRAZO E ENCERRAMENTO",
  "Prazo: conforme período expressamente definido pelas partes. Condições de encerramento: encerramento por autorização, nos termos revisados no documento.",
  "9. DADOS PESSOAIS",
  "Os dados pessoais serão tratados na medida necessária à execução desta intermediação e ao cumprimento de obrigações legais, com acesso restrito e medidas de segurança compatíveis.",
  "10. LOCAL, DATA E ASSINATURAS",
  "Lucas do Rio Verde/MT, 16 de setembro de 2026.",
  "________________________________________\nCONTRATANTE",
  "________________________________________\nCONTRATADO / CORRETOR DE IMÓVEIS"
].join("\n\n");

const logo={bytes:new Uint8Array(Buffer.from(encoded,"base64")),width:1280,height:692};
const identity={organization_name:"Valdiney Capistrano",trade_name:"Valdiney Capistrano"};
const pages=context.globalThis.layoutRealEstateDocumentPdf({title,content,identity,logo});
const sectionPage=pages.find(page=>page.elements.some(item=>item.text==="8. PRAZO E ENCERRAMENTO"));
const sectionIndex=sectionPage?.elements.findIndex(item=>item.text==="8. PRAZO E ENCERRAMENTO")??-1;
if(sectionIndex<0||!sectionPage.elements[sectionIndex+1])throw new Error("Título órfão detectado na regressão.");

const blob=context.globalThis.buildRealEstateDocumentPdf({
  title,content,identity,logo,
  versionLabel:"Autorização v2 · Modelo jurídico v1 · Identidade v1",
  generatedAt:"16/09/2026 14:30"
});
const bytes=new Uint8Array(await blob.arrayBuffer());
const target="output/pdf/vc-imob-documento-regressao-qualidade.pdf";
mkdirSync("output/pdf",{recursive:true});
writeFileSync(target,bytes);
process.stdout.write(`${target}\n${pages.length} páginas\n`);

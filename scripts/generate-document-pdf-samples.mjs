import {mkdir,readFile,writeFile} from "node:fs/promises";
import vm from "node:vm";

const pdfSource=await readFile("crm/js/document-pdf.js","utf8");
const identityMigration=await readFile("supabase/migrations/20260917120000_document_pdf_identity_quality.sql","utf8");
const encodedLogo=identityMigration.match(/logo bytea:=decode\('([^']+)'/i)?.[1];
if(!encodedLogo)throw new Error("Logo documental de referência não encontrada.");
const context={globalThis:{},Blob,Uint8Array,setTimeout};
vm.runInNewContext(pdfSource,context);

const identity={organization_name:"Organização de demonstração",trade_name:"VC Imob · amostra técnica",creci:"CRECI 00000/MT",public_phone:"(65) 0000-0000"};
const logo={bytes:new Uint8Array(Buffer.from(encodedLogo,"base64")),width:1280,height:692};
const signature=(label)=>`________________________________________\n${label}`;
const intermediation=[
  "CONTRATO DE CORRETAGEM IMOBILIÁRIA PARA VENDA",
  "AMOSTRA TÉCNICA — SEM DADOS REAIS",
  "QUADRO RESUMO",
  "Contratante e corretor estão identificados e qualificados no registro controlado. O imóvel, a matrícula, o preço de oferta, a remuneração, o prazo e os limites de publicidade foram conferidos antes deste preview.",
  "1. OBJETO",
  "A amostra demonstra a composição profissional do instrumento de intermediação, sem substituir revisão jurídica do caso concreto.",
  "2. PRESTAÇÃO DO SERVIÇO",
  "O profissional atua com diligência, prudência, boa-fé e sigilo, prestando as informações relevantes disponíveis e preservando os documentos confiados.",
  "3. HONORÁRIOS E VIGÊNCIA",
  "As condições econômicas, o prazo e a modalidade de exclusividade devem corresponder exatamente ao que foi informado e aceito pelas partes.",
  "4. PUBLICIDADE E PROPOSTAS",
  "A publicidade respeita a autorização escrita. Propostas e contraofertas somente vinculam o contratante mediante aceitação expressa.",
  "5. DADOS PESSOAIS",
  "Os dados são tratados na medida necessária à intermediação e às obrigações legais, com acesso restrito e sem cache público.",
  "6. SGR E ASSINATURA",
  "O VC Imob não registra o documento no SGR e não certifica assinatura. A consulta e as formalidades aplicáveis permanecem sob conferência profissional.",
  "7. LOCAL E DATA",
  "Cuiabá/MT, 22 de setembro de 2026.",signature("CONTRATANTE"),signature("CORRETOR(A) / IMOBILIÁRIA")
].join("\n\n");

const purchaseSections=Array.from({length:13},(_,index)=>`${index+1}. CLÁUSULA DE DEMONSTRAÇÃO\n\nEsta seção demonstra paginação, hierarquia e leitura confortável com conteúdo extenso. Os dados, condições, valores, prazos e responsabilidades precisam ser preenchidos e conferidos para o negócio concreto. Este texto sintético não cria obrigação nem substitui revisão profissional.`);
const purchase=[
  "INSTRUMENTO PARTICULAR DE COMPRA E VENDA DE IMÓVEL — MINUTA PARA REVISÃO",
  "AMOSTRA TÉCNICA — SEM DADOS REAIS",
  "AVISO DE NATUREZA JURÍDICA",
  "Esta amostra organiza obrigações negociais. Não é escritura pública, não certifica assinatura e não transfere a propriedade por si só; a formalização e o registro dependem do cenário e dos requisitos aplicáveis.",
  ...purchaseSections,
  "14. LOCAL, DATA E ASSINATURAS",
  "Cuiabá/MT, 22 de setembro de 2026.",signature("VENDEDOR(ES)"),signature("COMPRADOR(ES)"),signature("TESTEMUNHA, SE PREVISTA E APLICÁVEL")
].join("\n\n");

await mkdir("output/pdf",{recursive:true});
for(const sample of [
  {path:"output/pdf/contrato-corretagem-v2-amostra.pdf",title:"Contrato de Corretagem Imobiliária para Venda",content:intermediation,id:"DEMO-COR-20260922"},
  {path:"output/pdf/instrumento-compra-venda-v2-amostra.pdf",title:"Instrumento Particular de Compra e Venda — Minuta para Revisão",content:purchase,id:"DEMO-CV-20260922"}
]){
  const blob=context.globalThis.buildRealEstateDocumentPdf({title:sample.title,content:sample.content,versionLabel:"Modelo v2 · Base jurídica 2026-09-22",documentIdentifier:sample.id,generatedAt:"22/09/2026 12:00",identity,logo});
  await writeFile(sample.path,Buffer.from(await blob.arrayBuffer()));
  process.stdout.write(`${sample.path}\n`);
}

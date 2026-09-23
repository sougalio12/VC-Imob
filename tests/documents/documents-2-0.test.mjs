import test from "node:test";
import assert from "node:assert/strict";
import {inflateSync} from "node:zlib";
import {readFileSync} from "node:fs";

const migration=readFileSync("supabase/migrations/20260922010000_documents_2_0.sql","utf8");
const frontend=readFileSync("crm/js/documents.js","utf8");
const css=readFileSync("crm/css/documents.css","utf8");
const manifest=JSON.parse(readFileSync("crm/manifest.webmanifest","utf8"));
const serviceWorker=readFileSync("crm/service-worker.js","utf8");

function decodePng(path){
  const file=readFileSync(path);assert.equal(file.subarray(1,4).toString(),"PNG");
  let offset=8,width,height,colorType,bitDepth,idat=[];
  while(offset<file.length){const length=file.readUInt32BE(offset),type=file.subarray(offset+4,offset+8).toString(),data=file.subarray(offset+8,offset+8+length);offset+=length+12;if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];}if(type==="IDAT")idat.push(data);if(type==="IEND")break;}
  assert.equal(bitDepth,8);assert.ok([2,6].includes(colorType));const channels=colorType===6?4:3,stride=width*channels,raw=inflateSync(Buffer.concat(idat)),rows=[];let cursor=0,previous=Buffer.alloc(stride);
  for(let y=0;y<height;y+=1){const filter=raw[cursor++],source=raw.subarray(cursor,cursor+stride),row=Buffer.alloc(stride);cursor+=stride;for(let index=0;index<stride;index+=1){const left=index>=channels?row[index-channels]:0,up=previous[index],upperLeft=index>=channels?previous[index-channels]:0;let value=source[index];if(filter===1)value=(value+left)&255;else if(filter===2)value=(value+up)&255;else if(filter===3)value=(value+Math.floor((left+up)/2))&255;else if(filter===4){const prediction=left+up-upperLeft,pa=Math.abs(prediction-left),pb=Math.abs(prediction-up),pc=Math.abs(prediction-upperLeft);value=(value+(pa<=pb&&pa<=pc?left:pb<=pc?up:upperLeft))&255;}else assert.equal(filter,0);row[index]=value;}rows.push(row);previous=row;}
  return{width,height,pixel(x,y){const row=rows[y],start=x*channels;return[row[start],row[start+1],row[start+2],channels===4?row[start+3]:255];}};
}

test("DOC20-01 legal versions, sources and special-scenario blockers are snapshotted",()=>{
  for(const column of ["legal_basis_version","legal_sources_snapshot","legal_checklist","blocking_reasons"])assert.match(migration,new RegExp(column));
  for(const scenario of ["rural","development","incorporation","subdivision","financing_option","fiduciary_lien","consumer_relationship","registry_status"])assert.match(migration,new RegExp(scenario));
  assert.match(migration,/DOCUMENT_LEGAL_REVIEW_REQUIRED/);
  assert.match(migration,/update public\.document_templates set status='retired' where version=1/);
  assert.match(migration,/\('sale_intermediation','sale_intermediation',2/);
  assert.match(migration,/\('property_sale_purchase','property_sale_purchase',2/);
});

test("DOC20-02 guided mobile flow preserves conditional disclosure and accessible states",()=>{
  assert.match(frontend,/DOCUMENT_STEPS/);assert.match(frontend,/data-condition-key/);assert.match(frontend,/Etapa \$\{stepIndex\+1\} de/);
  assert.match(frontend,/Este cenário requer análise jurídica específica/);assert.match(frontend,/Salvar rascunho/);assert.match(frontend,/blocking_reasons/);
  assert.match(frontend,/document-editor-header/);assert.match(frontend,/document-editor-body/);assert.match(frontend,/document-action-next/);assert.match(frontend,/document-action-preview/);
  assert.match(frontend,/active\.blur\(\)/);assert.match(frontend,/mobileStepCounter\.focus\(\{preventScroll:true\}\)/);
  assert.match(frontend,/if\(stepIndex!==steps\.length-1\)\{goToStep\(stepIndex\+1\);return;\}/);
  assert.match(css,/grid-template-rows:minmax\(0,1fr\) auto/);assert.match(css,/\.document-editor-actions \[hidden\]/);assert.match(css,/font-size:16px/);
  assert.match(css,/\.document-progress/);assert.match(css,/\.document-control:focus-within/);assert.match(css,/min-height:44px/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/@media\(max-width:600px\)/);
});

test("DOC20-03 PWA caches only public shell assets and carries the new immutable version",()=>{
  assert.match(serviceWorker,/vc-imob-shell-documents-mobile-20260923/);
  assert.doesNotMatch(serviceWorker,/rest\/v1|auth\/v1|real_estate_document_versions|rendered_content/);
  assert.match(serviceWorker,/url\.pathname\.startsWith\("\/crm\/"\)/);assert.match(serviceWorker,/css\|js\|png\|svg\|ico\|webmanifest/);
  for(const icon of manifest.icons){assert.match(icon.src,/documents-2-20260922/);assert.ok(["any","maskable"].includes(icon.purpose));}
});

test("DOC20-04 PWA icons contain no black outer frame and keep the official mark in a safe zone",()=>{
  for(const [path,size] of [["crm/icons/icon-192.png",192],["crm/icons/icon-512.png",512],["crm/icons/icon-maskable-512.png",512],["crm/icons/apple-touch-icon.png",180]]){
    const png=decodePng(path);assert.equal(png.width,size);assert.equal(png.height,size);
    const edge=[];for(let point=0;point<size;point+=1)edge.push(png.pixel(point,0),png.pixel(point,size-1),png.pixel(0,point),png.pixel(size-1,point));
    assert.equal(edge.some(([r,g,b,a])=>a>0&&r+g+b<90),false,`${path} still has a black frame`);
    let minX=size,minY=size,maxX=-1,maxY=-1;for(let y=0;y<size;y+=1)for(let x=0;x<size;x+=1){const[r,g,b,a]=png.pixel(x,y);if(a>0&&r+g+b<120){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
    assert.ok(maxX>minX&&maxY>minY,`${path} must retain the black VC symbol`);assert.ok(minX>=size*.1&&minY>=size*.1&&maxX<=size*.9&&maxY<=size*.9,`${path} mark is outside the safe zone`);
  }
});

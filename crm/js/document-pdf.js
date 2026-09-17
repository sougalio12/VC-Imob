(function (scope) {
  const CP1252 = new Map([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
  const PAGE={width:595,height:842,left:52,right:52,bottom:62,continuationTop:762};

  function cp1252Bytes(value) {
    return Uint8Array.from([...String(value)].map(char=>{const code=char.codePointAt(0);return code<=255?code:(CP1252.get(code)??0x3f);}));
  }
  function concatBytes(chunks) { const size=chunks.reduce((sum,item)=>sum+item.length,0),result=new Uint8Array(size);let offset=0;chunks.forEach(item=>{result.set(item,offset);offset+=item.length;});return result; }
  function escapePdf(text) { return [...cp1252Bytes(text)].map(code=>String.fromCharCode(code)).join("").replace(/([\\()])/g,"\\$1").replace(/[\r\n]/g," "); }
  function wrapParagraph(text,max=91) {
    const words=String(text).trim().split(/\s+/).filter(Boolean),lines=[];let line="";
    words.forEach(word=>{if(word.length>max){if(line)lines.push(line);for(let i=0;i<word.length;i+=max)lines.push(word.slice(i,i+max));line="";return;}const candidate=line?`${line} ${word}`:word;if(candidate.length>max){if(line)lines.push(line);line=word;}else line=candidate;});
    if(line)lines.push(line);return lines.length?lines:[""];
  }
  function isHeading(text) { const value=String(text).trim();return /^(?:\d+\.\s+|AVISO DE REVISÃO$)/.test(value)&&value===value.toLocaleUpperCase("pt-BR"); }
  function isSignature(text) { return /^_{8,}/m.test(String(text)); }
  function contentBlocks(content,title) {
    const raw=String(content||"").trim().split(/\n\s*\n/).map(value=>value.trim()).filter(Boolean);
    if(raw[0]?.toLocaleUpperCase("pt-BR")===String(title||"").trim().toLocaleUpperCase("pt-BR"))raw.shift();
    return raw.map(text=>({kind:isHeading(text)?"heading":isSignature(text)?"signature":"body",text,lines:text.split(/\n/).flatMap(line=>wrapParagraph(line,isHeading(text)?74:91))}));
  }
  function firstPageTop(identity,logo) { return logo?.bytes?.length?638:(identity?.organization_name||identity?.trade_name?710:728); }
  function layoutRealEstateDocumentPdf({title,content,identity={},logo=null}) {
    if(!String(content||"").trim())throw new Error("Conteúdo finalizado ausente.");
    const blocks=contentBlocks(content,title),pages=[{elements:[],first:true}],lineHeight=14.5,headingHeight=16,paragraphGap=8;
    let page=pages[0],y=firstPageTop(identity,logo);
    const newPage=()=>{page={elements:[],first:false};pages.push(page);y=PAGE.continuationTop;};
    const ensure=height=>{if(y-height<PAGE.bottom)newPage();};
    const addLines=(lines,{font="regular",size=10.2,height=lineHeight,gap=paragraphGap,indent=0}={})=>{for(const line of lines){if(y-height<PAGE.bottom)newPage();page.elements.push({text:line,x:PAGE.left+indent,y,font,size});y-=height;}y-=gap;};
    for(let index=0;index<blocks.length;index+=1){const block=blocks[index];if(block.kind==="heading"){const next=blocks[index+1],minimum=headingHeight+5+(next?Math.min(next.lines.length,2)*lineHeight:lineHeight);ensure(minimum);addLines(block.lines,{font:"bold",size:10.6,height:headingHeight,gap:5});}else if(block.kind==="signature"){const required=block.lines.length*lineHeight+24;if(required<=PAGE.continuationTop-PAGE.bottom)ensure(required);addLines(block.lines,{size:9.8,height:lineHeight,gap:24});}else addLines(block.lines);}
    return pages;
  }
  function logoPlacement(logo) { if(!logo?.bytes?.length||!(logo.width>0)||!(logo.height>0))return null;const scale=Math.min(270/logo.width,92/logo.height,1),width=logo.width*scale,height=logo.height*scale;return{x:(PAGE.width-width)/2,y:PAGE.height-42-height,width,height}; }
  function drawText(text,x,y,size,font="regular",gray=0) { return `${gray} g\nBT\n/${font==="bold"?"F2":"F1"} ${size} Tf\n${x} ${y} Td\n(${escapePdf(text)}) Tj\nET`; }
  function pdfStream(commands) { const bytes=cp1252Bytes(commands.join("\n"));return concatBytes([cp1252Bytes(`<< /Length ${bytes.length} >>\nstream\n`),bytes,cp1252Bytes("\nendstream")]); }
  function pdfDocument(objects,rootId) {
    const chunks=[cp1252Bytes("%PDF-1.4\n%âãÏÓ\n")],offsets=[0];let length=chunks[0].length;
    for(let id=1;id<objects.length;id+=1){offsets[id]=length;const wrapped=concatBytes([cp1252Bytes(`${id} 0 obj\n`),objects[id],cp1252Bytes("\nendobj\n")]);chunks.push(wrapped);length+=wrapped.length;}
    const xref=length,table=[`xref\n0 ${objects.length}\n0000000000 65535 f \n`];for(let id=1;id<objects.length;id+=1)table.push(`${String(offsets[id]).padStart(10,"0")} 00000 n \n`);table.push(`trailer\n<< /Size ${objects.length} /Root ${rootId} 0 R >>\nstartxref\n${xref}\n%%EOF`);chunks.push(cp1252Bytes(table.join("")));return concatBytes(chunks);
  }
  function buildPdf({title,content,versionLabel,generatedAt,identity={},logo=null}) {
    const pages=layoutRealEstateDocumentPdf({title,content,identity,logo}),objects=[null],catalog=1,pagesId=2,regular=3,bold=4;
    objects[catalog]=cp1252Bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);objects[regular]=cp1252Bytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");objects[bold]=cp1252Bytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    let imageId=null;const placement=logoPlacement(logo);
    if(placement){imageId=objects.length;const imageBytes=logo.bytes instanceof Uint8Array?logo.bytes:new Uint8Array(logo.bytes);objects.push(concatBytes([cp1252Bytes(`<< /Type /XObject /Subtype /Image /Width ${Math.round(logo.width)} /Height ${Math.round(logo.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),imageBytes,cp1252Bytes("\nendstream")]));}
    const pageIds=[],contentIds=[];pages.forEach(()=>{pageIds.push(objects.length);objects.push(null);contentIds.push(objects.length);objects.push(null);});objects[pagesId]=cp1252Bytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] >>`);
    pages.forEach((page,pageIndex)=>{const commands=[];if(page.first){if(placement)commands.push(`q\n${placement.width.toFixed(2)} 0 0 ${placement.height.toFixed(2)} ${placement.x.toFixed(2)} ${placement.y.toFixed(2)} cm\n/Logo Do\nQ`);else{const brand=identity.trade_name||identity.organization_name||"Documento imobiliário";commands.push(drawText(brand,PAGE.left,794,11,"bold"));const detail=[identity.creci,identity.public_phone].filter(Boolean).join(" · ");if(detail)commands.push(drawText(detail,PAGE.left,778,8.5,"regular",0.35));}const titleY=placement?placement.y-27:746;commands.push(drawText(title,PAGE.left,titleY,14,"bold"),`0.72 G\n${PAGE.left} ${titleY-12} m ${PAGE.width-PAGE.right} ${titleY-12} l S`);}else{const brand=identity.trade_name||identity.organization_name||"Documento imobiliário";commands.push(drawText(brand,PAGE.left,796,9,"bold",0.25),`0.82 G\n${PAGE.left} 784 m ${PAGE.width-PAGE.right} 784 l S`);}page.elements.forEach(item=>commands.push(drawText(item.text,item.x,item.y,item.size,item.font)));commands.push(`0.82 G\n${PAGE.left} 47 m ${PAGE.width-PAGE.right} 47 l S`,drawText(versionLabel,PAGE.left,31,7.5,"regular",0.4),drawText(`Página ${pageIndex+1} de ${pages.length}`,PAGE.width-PAGE.right-63,31,7.5,"regular",0.4));if(generatedAt)commands.push(drawText(`Gerado em ${generatedAt}`,PAGE.left,20,6.8,"regular",0.5));objects[contentIds[pageIndex]]=pdfStream(commands);objects[pageIds[pageIndex]]=cp1252Bytes(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${imageId&&page.first?` /XObject << /Logo ${imageId} 0 R >>`:""} >> /Contents ${contentIds[pageIndex]} 0 R >>`);});
    return new Blob([pdfDocument(objects,catalog)],{type:"application/pdf"});
  }
  async function prepareDocumentLogoForPdf({bytes,mime,width,height}={}) {
    const source=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);if(!source.length)return null;if(mime==="image/jpeg")return{bytes:source,width,height};if(typeof document==="undefined")throw new Error("Conversão de logo indisponível neste ambiente.");const blob=new Blob([source],{type:mime}),url=URL.createObjectURL(blob);try{const image=await new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>reject(new Error("Logo inválida."));item.src=url;}),canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext("2d",{alpha:false});context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);const converted=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.94));if(!converted)throw new Error("Não foi possível preparar a logo para o PDF.");return{bytes:new Uint8Array(await converted.arrayBuffer()),width:canvas.width,height:canvas.height};}finally{URL.revokeObjectURL(url);}
  }
  function downloadRealEstateDocumentPdf(options) { const blob=buildPdf(options),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=options.filename||"vc-imob-documento.pdf";document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return blob; }
  scope.layoutRealEstateDocumentPdf=layoutRealEstateDocumentPdf;scope.documentLogoPlacement=logoPlacement;scope.buildRealEstateDocumentPdf=buildPdf;scope.prepareDocumentLogoForPdf=prepareDocumentLogoForPdf;scope.downloadRealEstateDocumentPdf=downloadRealEstateDocumentPdf;
})(typeof window!=="undefined"?window:globalThis);

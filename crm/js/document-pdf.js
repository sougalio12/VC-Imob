(function (scope) {
  const CP1252 = new Map([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
  function cp1252(text) { return [...String(text)].map(char => { const code=char.codePointAt(0); return String.fromCharCode(code<=255?code:(CP1252.get(code)??0x3f)); }).join(""); }
  function escapePdf(text) { return cp1252(text).replace(/([\\()])/g,"\\$1").replace(/[\r\n]/g," "); }
  function wrapParagraph(text, max=92) {
    const words=String(text).trim().split(/\s+/).filter(Boolean),lines=[]; let line="";
    words.forEach(word=>{ if(word.length>max){ if(line)lines.push(line); for(let i=0;i<word.length;i+=max)lines.push(word.slice(i,i+max)); line=""; return; } const candidate=line?`${line} ${word}`:word; if(candidate.length>max){ if(line)lines.push(line); line=word; }else line=candidate; });
    if(line)lines.push(line); return lines.length?lines:[""];
  }
  function paginate(content) {
    const lines=[];
    String(content).split(/\n/).forEach(raw=>{ if(!raw.trim()){ lines.push(""); return; } wrapParagraph(raw).forEach(line=>lines.push(line)); });
    const pages=[]; for(let index=0;index<lines.length;index+=45)pages.push(lines.slice(index,index+45)); return pages.length?pages:[[""]];
  }
  function buildPdf({ title, content, versionLabel, generatedAt }) {
    if(!String(content||"").trim())throw new Error("Conteúdo finalizado ausente.");
    const pages=paginate(content),objects=[null];
    const catalog=1,pagesObject=2,font=3; objects[catalog]="<< /Type /Catalog /Pages 2 0 R >>"; objects[font]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    const pageIds=[],contentIds=[];
    pages.forEach(()=>{pageIds.push(objects.length);objects.push("");contentIds.push(objects.length);objects.push("");});
    objects[pagesObject]=`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] >>`;
    pages.forEach((lines,pageIndex)=>{
      const commands=["BT","/F1 9 Tf","48 794 Td",`(${escapePdf("VC Imob - Documentos")}) Tj`,"0 -18 Td","/F1 13 Tf",`(${escapePdf(title)}) Tj`,"/F1 9 Tf","0 -17 Td",`(${escapePdf(`${versionLabel} | Gerado em ${generatedAt}`)}) Tj`,"0 -22 Td"];
      lines.forEach(line=>{commands.push(`(${escapePdf(line)}) Tj`,`0 -15 Td`);});
      commands.push("ET","BT","/F1 8 Tf","48 28 Td",`(${escapePdf(`Pagina ${pageIndex+1} de ${pages.length}`)}) Tj`,"ET");
      const stream=commands.join("\n");
      objects[contentIds[pageIndex]]=`<< /Length ${cp1252(stream).length} >>\nstream\n${stream}\nendstream`;
      objects[pageIds[pageIndex]]=`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[pageIndex]} 0 R >>`;
    });
    let binary="%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",offsets=[0];
    for(let id=1;id<objects.length;id++){offsets[id]=binary.length;binary+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
    const xref=binary.length;binary+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let id=1;id<objects.length;id++)binary+=`${String(offsets[id]).padStart(10,"0")} 00000 n \n`;
    binary+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([Uint8Array.from(binary,char=>char.charCodeAt(0)&255)],{type:"application/pdf"});
  }
  function downloadRealEstateDocumentPdf(options) {
    const blob=buildPdf(options),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=options.filename||"vc-imob-documento.pdf";document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return blob;
  }
  scope.buildRealEstateDocumentPdf=buildPdf;
  scope.downloadRealEstateDocumentPdf=downloadRealEstateDocumentPdf;
})(typeof window!=="undefined"?window:globalThis);

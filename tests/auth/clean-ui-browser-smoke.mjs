import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,normalize,extname} from "node:path";
import {spawn} from "node:child_process";

const chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const viewports=[320,360,375,390,393,414,430];
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png",".svg":"image/svg+xml"};

function connection(url){
  const ws=new WebSocket(url),pending=new Map(),events=new Map();let id=0;
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);}else if(message.method&&events.has(message.method)){for(const callback of events.get(message.method))callback(message.params);}};
  const ready=ws.readyState===WebSocket.OPEN?Promise.resolve():new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  return{ready,send(method,params={}){return new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params}));});},once(method){return new Promise(resolve=>{const callback=params=>{events.get(method)?.delete(callback);resolve(params);};if(!events.has(method))events.set(method,new Set());events.get(method).add(callback);});},close(){ws.close();}};
}

async function waitJson(url){for(let index=0;index<60;index++){try{const response=await fetch(url);if(response.ok)return response.json();}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Chrome CDP unavailable at ${url}`);}

test("CLEAN-BROWSER real mobile widths contain auth forms and Team cards",{timeout:120000,skip:!existsSync(chrome)||process.env.VC_IMOB_BROWSER_SMOKE!=="1"},async()=>{
  const root=process.cwd();
  const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,"http://local").pathname),relative=pathname==="/"?"index.html":pathname.slice(1),file=normalize(join(root,relative));if(!file.startsWith(normalize(root))){res.writeHead(403).end();return;}if((await stat(file)).isDirectory()){res.writeHead(302,{Location:`${pathname.replace(/\/$/,"")}/index.html`}).end();return;}const body=await readFile(file);res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(body);}catch{res.writeHead(404).end("Not found");}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const webPort=server.address().port,debugPort=12000+Math.floor(Math.random()*10000),userDir=mkdtempSync(join(tmpdir(),"vc-imob-clean-"));
  const browser=spawn(chrome,["--headless=new","--disable-gpu","--no-first-run","--remote-allow-origins=*",`--remote-debugging-port=${debugPort}`,`--user-data-dir=${userDir}`,"about:blank"],{stdio:"ignore"});
  let page;
  try{
    const targets=await waitJson(`http://127.0.0.1:${debugPort}/json/list`),target=targets.find(item=>item.type==="page");page=connection(target.webSocketDebuggerUrl);await page.ready;await page.send("Page.enable");await page.send("Runtime.enable");
    const navigate=async url=>{const loaded=page.once("Page.loadEventFired");await page.send("Page.navigate",{url});await loaded;await new Promise(resolve=>setTimeout(resolve,150));};
    const evaluate=async expression=>(await page.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result.value;
    const assertContained=async(label,selector)=>{const result=await evaluate(`(()=>{const viewport=document.documentElement.clientWidth;const elements=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>getComputedStyle(node).display!=="none");const bad=elements.filter(node=>{const rect=node.getBoundingClientRect();return rect.left<-1||rect.right>viewport+1||node.scrollWidth>node.clientWidth+1;}).map(node=>({tag:node.tagName,cls:node.className,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,scroll:node.scrollWidth,client:node.clientWidth}));return{viewport,documentWidth:document.documentElement.scrollWidth,bad};})()`);assert.ok(result.documentWidth<=result.viewport+1,`${label}: document ${result.documentWidth}px exceeds ${result.viewport}px`);assert.deepEqual(result.bad,[],`${label}: overflowing controls`);};
    for(const width of viewports){await page.send("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:2,mobile:true});await navigate(`http://127.0.0.1:${webPort}/crm/login.html`);await assertContained(`login ${width}`,"main,section,form,label,input,button,a.signup-cta,.signup-cta *");await navigate(`http://127.0.0.1:${webPort}/crm/signup.html`);await assertContained(`signup ${width}`,"main,section,form,label,input,button,.signup-optional,.onboarding-steps");}
    await navigate(`http://127.0.0.1:${webPort}/crm/login.html`);await evaluate(`sessionStorage.setItem("vc-imob-demo","true")`);await navigate(`http://127.0.0.1:${webPort}/crm/index.html`);
    const views=["dashboard","leads","kanban","agenda","properties","team"];
    for(const width of viewports){
      await page.send("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:2,mobile:true});
      for(const view of views){await evaluate(`(()=>{navigateCrm(${JSON.stringify(view)});return true;})()`);await new Promise(resolve=>setTimeout(resolve,120));await assertContained(`${view} ${width}`,".crm-main,.crm-topbar,.crm-content,.crm-bottom-nav,.crm-bottom-nav button");}
      await evaluate(`document.getElementById("mobileMoreButton").click()`);await assertContained(`mais ${width}`,".crm-sidebar,.crm-brand-app,.crm-brand-app img,.crm-nav button");
      const logo=await evaluate(`(()=>{const image=document.querySelector(".crm-brand-app img"),rect=image.getBoundingClientRect();return{src:image.getAttribute("src"),width:rect.width,height:rect.height,visible:getComputedStyle(image).display!=="none"};})()`);assert.equal(logo.src,"./icons/icon-192.png");assert.ok(logo.visible&&logo.width===logo.height&&logo.width>=36,`mais ${width}: official icon is not square and visible`);
      await evaluate(`document.getElementById("sidebarCloseButton").click();document.getElementById("quickLeadButton").click()`);await new Promise(resolve=>setTimeout(resolve,50));await assertContained(`modal ${width}`,".crm-modal.is-open,.modal-card,.crm-form,.crm-form label,.crm-form input,.modal-actions button");await evaluate(`closeModal()`);
    }
    await evaluate(`(()=>{const rows=[{name:"Corretor com nome profissional extenso",active_leads:120,without_next_action:18,follow_ups:44,overdue:7,visits:12,proposals:8,sales:3,vgv:987654321,commission_expected:12345678,acquisitions:9}];document.getElementById("crmContent").replaceChildren(createTeamPerformancePanel(rows));})()`);
    for(const width of viewports){await page.send("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:2,mobile:true});await assertContained(`team ${width}`,".crm-content,.crm-panel,.team-performance-mobile,.team-member-operation-card,.team-member-metric,.team-member-metric *");const display=await evaluate(`getComputedStyle(document.querySelector(".team-performance-mobile")).display`);assert.equal(display,"grid");}
  }finally{
    page?.close();browser.kill();
    await Promise.race([new Promise(resolve=>browser.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
    await new Promise(resolve=>server.close(resolve));
    for(let attempt=0;attempt<5;attempt++){try{rmSync(userDir,{recursive:true,force:true});break;}catch(error){if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,200));}}
  }
});

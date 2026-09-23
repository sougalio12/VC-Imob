import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const supabase=readFileSync("crm/js/supabase.js","utf8");
const login=readFileSync("crm/login.html","utf8");
const signup=readFileSync("crm/signup.html","utf8");
const signupJs=readFileSync("crm/js/signup.js","utf8");
const confirm=readFileSync("crm/confirm.html","utf8");
const email=readFileSync("supabase/templates/confirmation.html","utf8");
const config=readFileSync("supabase/config.toml","utf8");
const clean=readFileSync("crm/css/clean-system.css","utf8");
const team=readFileSync("crm/js/team-operations.js","utf8");
const index=readFileSync("crm/index.html","utf8");
const serviceWorker=readFileSync("crm/service-worker.js","utf8");

function authHarness(responses=[]){
  const values=new Map(),calls=[];
  const location={hostname:"valdineycapistranoimoveis.com.br",href:"https://valdineycapistranoimoveis.com.br/crm/confirm.html#access_token=a",pathname:"/crm/confirm.html",hash:""};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const context=vm.createContext({console,Date,JSON,Error,URL,URLSearchParams,document:{title:"Confirmar"},window:{location,history:{replaceState(){}}},localStorage:storage,sessionStorage:storage,CRM_CONFIG:{supabaseUrl:"https://project.supabase.test",supabasePublishableKey:"publishable-test-key"},isSupabaseConfigured:()=>true,friendlySupabaseError:()=>"Erro",fetch:async(url,options={})=>{calls.push({url,options});const response=responses.shift()||{ok:true,status:200,data:{}};return{ok:response.ok,status:response.status,json:async()=>response.data,text:async()=>JSON.stringify(response.data)}}});
  vm.runInContext(supabase,context);return{calls,values,resend:vm.runInContext("resendSignupConfirmation",context),redirect:vm.runInContext("getAuthConfirmationRedirectUrl",context)};
}

test("CLEAN01 signup CTA is prominent while demo remains secondary",()=>{
  assert.match(login,/Novo no VC Imob\?/);assert.match(login,/Crie sua conta aqui/);assert.match(login,/Teste grátis por 7 dias/);
  assert.ok(login.indexOf("Crie sua conta aqui")<login.indexOf("Entrar em modo demonstração"));
});

test("CLEAN02 signup uses an exact safe confirmation callback and a non-enumerating resend state",async()=>{
  const run=authHarness([{ok:true,status:200,data:{}}]);
  assert.equal(run.redirect(),"https://valdineycapistranoimoveis.com.br/crm/confirm.html");
  await run.resend("Pessoa@Example.com");
  assert.match(run.calls[0].url,/\/auth\/v1\/resend\?redirect_to=https%3A%2F%2Fvaldineycapistranoimoveis\.com\.br%2Fcrm%2Fconfirm\.html/);
  assert.deepEqual(JSON.parse(run.calls[0].options.body),{type:"signup",email:"pessoa@example.com"});
  assert.match(signupJs,/Verifique seu e-mail/);assert.match(signupJs,/Reenviar em \$\{seconds\}s/);assert.doesNotMatch(signupJs,/conta não existe/i);
});

test("CLEAN03 callback never accepts an arbitrary redirect and removes auth fragments",()=>{
  assert.match(confirm,/consumeAuthConfirmationRedirect/);assert.match(confirm,/noindex, nofollow/);
  assert.match(supabase,/history\.replaceState\(\{\}, document\.title, window\.location\.pathname\)/);
  assert.doesNotMatch(supabase,/redirect(?:To|_to)\s*=\s*(?:params|searchParams)/);
});

test("CLEAN04 hosted confirmation template is Portuguese, robust and repository-configured",()=>{
  assert.match(email,/Confirme seu e-mail/);assert.match(email,/Confirmar meu e-mail/);assert.match(email,/\.ConfirmationURL/);assert.match(email,/\.Data\.full_name/);
  assert.doesNotMatch(email,/<script|@import|font-face/i);assert.match(config,/site_url = "https:\/\/valdineycapistranoimoveis\.com\.br\/crm\/"/);
  assert.match(config,/\[auth\.email\.template\.confirmation\]/);assert.match(config,/subject = "Confirme seu e-mail \| VC Imob"/);assert.match(config,/content_path = "\.\/supabase\/templates\/confirmation\.html"/);
});

test("CLEAN05 Team operations is a desktop table and native mobile cards with real metrics",()=>{
  assert.match(team,/team-performance-desktop/);assert.match(team,/team-performance-mobile/);assert.match(team,/team-member-operation-card/);
  for(const label of ["Carteira","Sem próxima ação","Follow-ups","Atrasos","Visitas","Propostas","Vendas","VGV","Comissão prevista","Captações"])assert.match(team,new RegExp(label));
  assert.match(clean,/@media \(max-width: 720px\)[\s\S]*\.team-performance-desktop \{ display: none; \}[\s\S]*\.team-performance-mobile \{ display: grid/);
});

test("CLEAN06 the clean system preserves mobile ergonomics and reduced motion",()=>{
  assert.match(signup,/clean-system\.css\?v=menu-hotfix-20260922/);assert.match(clean,/min-height: 44px/);assert.match(clean,/prefers-reduced-motion/);
  for(const viewport of [320,360,375,390,393,414,430])assert.ok(viewport-40>0);
});

test("CLEAN07 semantic colors are restrained, labelled and tied to real states",()=>{
  for(const token of ["--semantic-success","--semantic-warning","--semantic-danger","--semantic-info","--semantic-neutral","--semantic-gold"])assert.match(clean,new RegExp(token));
  for(const state of ["stage-accepted","stage-negotiating","stage-rejected","document-status-finalized","team-status-active","capture-stage-acquired","activity-priority-1"])assert.match(clean,new RegExp(state));
  assert.match(clean,/visible text remains the primary status cue/);
});

test("CLEAN08 screens have subtle contextual accents and Mais reuses the official PWA icon",()=>{
  for(const view of ["leads","agenda","properties","acquisitions","proposals","documents","team","billing"])assert.match(clean,new RegExp(`data-view=\\"${view}\\"`));
  assert.match(index,/class="crm-brand crm-brand-app"[\s\S]*src="\.\/icons\/icon-192\.png"/);
  assert.match(serviceWorker,/"\.\/icons\/icon-192\.png"/);
  assert.match(serviceWorker,/vc-imob-shell-documents-mobile-20260923/);
});

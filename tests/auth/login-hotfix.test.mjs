import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync("crm/js/supabase.js","utf8");
const login=readFileSync("crm/login.html","utf8");
const index=readFileSync("crm/index.html","utf8");
const sw=readFileSync("crm/service-worker.js","utf8");

function harness(initialSession=null,responses=[]){
  const values=new Map(),sessionValues=new Map();if(initialSession)values.set("vc-imob-session",JSON.stringify(initialSession));sessionValues.set("vc-imob-organization-context","stale");
  const calls=[];
  const storage=items=>({getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key)});
  const context=vm.createContext({console,Date,JSON,Error,localStorage:storage(values),sessionStorage:storage(sessionValues),CRM_CONFIG:{supabaseUrl:"https://project.supabase.test",supabasePublishableKey:"publishable-test-key"},isSupabaseConfigured:()=>true,friendlySupabaseError:()=>"Erro",fetch:async(url,options={})=>{calls.push({url,options});const response=responses.shift()||{ok:false,status:500,data:{}};return{ok:response.ok,status:response.status,json:async()=>response.data,text:async()=>JSON.stringify(response.data)}}});
  vm.runInContext(source,context);return{context,calls,values,sessionValues,signIn:vm.runInContext("signInWithPassword",context),getValid:vm.runInContext("getValidSession",context)};
}

test("LOGIN01 password exchange never reuses a stale user JWT",async()=>{
  const stale={access_token:"stale-user-jwt",refresh_token:"stale-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"old-user"}},fresh={access_token:"fresh-user-jwt",refresh_token:"fresh-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"new-user"}},run=harness(stale,[{ok:true,status:200,data:fresh}]);
  await run.signIn("owner@example.test","correct-password");
  assert.equal(run.calls.length,1);assert.equal(run.calls[0].options.headers.Authorization,"Bearer publishable-test-key");assert.notEqual(run.calls[0].options.headers.Authorization,"Bearer stale-user-jwt");
  assert.equal(JSON.parse(run.values.get("vc-imob-session")).access_token,"fresh-user-jwt");assert.equal(run.sessionValues.has("vc-imob-organization-context"),false);
});

test("LOGIN02 remote session guard refreshes or removes a revoked cached session",async()=>{
  const stale={access_token:"revoked-jwt",refresh_token:"revoked-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}},run=harness(stale,[{ok:false,status:401,data:{}},{ok:false,status:400,data:{}}]);
  assert.equal(await run.getValid({verify:true}),null);assert.equal(run.values.has("vc-imob-session"),false);
  assert.match(run.calls[0].url,/\/auth\/v1\/user$/);assert.match(run.calls[1].url,/grant_type=refresh_token/);
});

test("LOGIN03 valid cached session is remotely confirmed before CRM bootstrap",async()=>{
  const cached={access_token:"valid-jwt",refresh_token:"refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}},run=harness(cached,[{ok:true,status:200,data:{id:"user",email:"owner@example.test"}}]);
  const result=await run.getValid({verify:true});assert.equal(result.user.id,"user");assert.equal(run.calls[0].options.headers.Authorization,"Bearer valid-jwt");
});

test("LOGIN04 login and CRM load the clean revision without losing the session hotfix",()=>{
  for(const asset of ["config.js","supabase.js","auth.js","pwa.js"])assert.match(login,new RegExp(`${asset.replace(".","\\.")}\\?v=premium-20260922`));
  for(const asset of ["config.js","supabase.js","auth.js","pwa.js"])assert.match(index,new RegExp(`${asset.replace(".","\\.")}\\?v=premium-20260922`));
  assert.match(sw,/vc-imob-shell-polish-hotfix-20260922/);assert.match(login,/getValidSession\(\{ verify: true \}\)/);assert.match(login,/submit\.disabled = true/);
});

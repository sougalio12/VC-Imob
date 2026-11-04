import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/site-lead/handler.ts','utf8'));
const {createSiteLeadHandler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function harness(capture={data:[{lead_id:'test',created:true}],error:null}, overrides={}, allowed=true) {
  const calls=[];const values={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'server-test-only',SITE_LEAD_ORGANIZATION_ID:'server-org',SITE_LEAD_ALLOWED_ORIGINS:'https://preview.test',SITE_LEAD_RATE_LIMIT_SALT:'test-salt',...overrides};
  const handler=createSiteLeadHandler({env:name=>values[name],createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return name==='consume_site_lead_rate_limit'?{data:allowed,error:null}:capture;}})});
  return{handler,calls};
}
const request=(payload={},origin='https://preview.test')=>new Request('http://local/site-lead',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Cliente',phone:'65999990000',propertyCode:'VCI000001',...payload})});
test('handler delegates atomic publication check and capture to the server-bound organization',async()=>{
  const run=harness();const result=await run.handler(request({organization_id:'attacker-org',propertyTitle:'Forged title'}));
  assert.equal(result.status,201);assert.equal(run.calls[1].name,'capture_published_site_lead');
  assert.equal(run.calls[1].args.target_organization,'server-org');assert.equal(run.calls[1].args.target_property_code,'VCI000001');
  assert.equal('target_property_title' in run.calls[1].args,false);assert.equal(run.calls.length,2);
});
test('unpublished, nonexistent and foreign-organization property results return 404',async()=>{
  const run=harness({data:[],error:null});assert.equal((await run.handler(request())).status,404);
});
test('backend failure fails closed without reporting capture success',async()=>{
  const run=harness({data:null,error:{code:'unavailable'}});assert.equal((await run.handler(request())).status,503);
});
test('unknown origins, malformed payloads and oversized requests never capture',async()=>{
  const run=harness();assert.equal((await run.handler(request({},'https://attacker.test'))).status,403);
  assert.equal((await run.handler(request({name:''}))).status,422);
  assert.equal((await run.handler(request({extra:'x'.repeat(11000)}))).status,413);assert.equal(run.calls.length,0);
});
test('honeypot does not create records and absent server configuration fails closed',async()=>{
  const run=harness();assert.equal((await run.handler(request({website:'spam'}))).status,200);assert.equal(run.calls.length,0);
  const missing=harness(undefined,{SITE_LEAD_ORGANIZATION_ID:''});assert.equal((await missing.handler(request())).status,503);
});

test('rate limiting and missing salt reject before any capture RPC',async()=>{
  const limited=harness(undefined,{},false);assert.equal((await limited.handler(request())).status,429);assert.equal(limited.calls.length,1);
  const missing=harness(undefined,{SITE_LEAD_RATE_LIMIT_SALT:''});assert.equal((await missing.handler(request())).status,503);assert.equal(missing.calls.length,0);
});

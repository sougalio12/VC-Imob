import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildWeb} from '../../scripts/build-web.mjs';
import {assertLocalBackend} from '../helpers/local-backend.mjs';
const source=readFileSync('js/runtime-config.js','utf8');
const production=JSON.parse(readFileSync('config/environments/production.json','utf8'));
function runtime(input,origin='http://127.0.0.1:4174') {
  const context=vm.createContext({URL,atob,window:{location:new URL(origin),VC_IMOB_ENV:input},console:{error(){}}});vm.runInContext(source,context);return context.window;
}
const development={environment:'development',supabaseUrl:'http://127.0.0.1:54321',supabasePublishableKey:'sb_publishable_test',siteOrigin:'http://127.0.0.1:4174'};
test('development only permits the local backend and callback',()=>{
  const run=runtime(development);assert.equal(run.VC_IMOB_CONFIG.supabaseUrl,development.supabaseUrl);
  assert.equal(run.VC_IMOB_CONFIG.authRedirectUrl,'http://127.0.0.1:4174/crm/confirm.html');
  assert.equal(runtime({...development,supabaseUrl:production.supabaseUrl}).VC_IMOB_CONFIG.supabaseUrl,'');
});
test('staging rejects production backend and callbacks, permits its isolated project',()=>{
  const staging={...development,environment:'staging',supabaseUrl:'https://separate-staging.supabase.co',siteOrigin:'https://preview.test'};
  assert.equal(runtime(staging,'https://preview.test').VC_IMOB_CONFIG.supabaseUrl,staging.supabaseUrl);
  for(const change of [{supabaseUrl:production.supabaseUrl},{siteOrigin:production.siteOrigin}])assert.equal(runtime({...staging,...change},'https://preview.test').VC_IMOB_CONFIG.supabaseUrl,'');
});
test('a copied production artifact is blocked on preview and localhost',()=>{
  for(const origin of ['http://127.0.0.1:4174','https://pr-preview.test'])assert.equal(runtime(production,origin).VC_IMOB_CONFIG.supabaseUrl,'');
  assert.equal(runtime(production,production.siteOrigin).VC_IMOB_CONFIG.supabaseUrl,production.supabaseUrl);
});
test('server-only credentials and URL credentials cannot become public configuration',()=>{
  const serviceJwt=`header.${btoa(JSON.stringify({role:'service_role'}))}.signature`;
  for(const key of ['sb_secret_test',serviceJwt])assert.equal(runtime({...development,supabasePublishableKey:key}).VC_IMOB_CONFIG.supabaseUrl,'');
  assert.equal(runtime({...development,supabaseUrl:'http://secret@127.0.0.1:54321'}).VC_IMOB_CONFIG.supabaseUrl,'');
});
test('source HTML loads safe configuration before every consumer',()=>{
  const pages=['index.html','imovel.html','selecao.html','crm/index.html','crm/login.html','crm/signup.html','crm/confirm.html'];
  for(const page of pages){const html=readFileSync(page,'utf8');const first=html.indexOf('environment.js'),second=html.indexOf('runtime-config.js');assert.ok(first>=0&&second>first,page);for(const consumer of ['js/site-lead.js','js/config.js']){if(html.includes(consumer))assert.ok(html.indexOf(consumer)>second,page);}}
  assert.doesNotMatch(readFileSync('js/environment.js','utf8'),new RegExp(new URL(production.supabaseUrl).hostname));
});
test('default build is isolated, excludes backend source, and does not rewrite source config',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'vcimob-build-')),output=join(directory,'dist'),before=readFileSync('js/environment.js','utf8');
  try{await buildWeb('development',output);assert.ok(existsSync(join(output,'crm/index.html')));assert.equal(existsSync(join(output,'supabase')),false);assert.equal(existsSync(join(output,'tests')),false);assert.doesNotMatch(readFileSync(join(output,'js/environment.js'),'utf8'),new RegExp(new URL(production.supabaseUrl).hostname));assert.equal(readFileSync('js/environment.js','utf8'),before);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('production builds fail in test/PR contexts and staging fails when unconfigured',async()=>{
  const previous=process.env.VC_IMOB_TEST_RUN;process.env.VC_IMOB_TEST_RUN='1';
  try{await assert.rejects(buildWeb('production'),/bloqueada/);await assert.rejects(buildWeb('staging'),/Configure URL/);}finally{if(previous===undefined)delete process.env.VC_IMOB_TEST_RUN;else process.env.VC_IMOB_TEST_RUN=previous;}
});

test('live test guard rejects remote URLs disguised with localhost in credentials or paths',()=>{
  for(const url of ['https://isbkhhobutbdtdtpaavn.supabase.co/127.0.0.1','https://127.0.0.1@isbkhhobutbdtdtpaavn.supabase.co','http://localhost.attacker.test:54321','http://localhost:54321/path'])assert.throws(()=>assertLocalBackend(url));
  assert.equal(assertLocalBackend('http://127.0.0.1:54321'),'http://127.0.0.1:54321');
});

test('Auth callback stays in the configured preview instead of the production website',()=>{
  const context=vm.createContext({URL,window:{location:{href:'https://preview.test/crm/signup.html'}},CRM_CONFIG:{authRedirectUrl:'https://preview.test/crm/confirm.html'}});
  vm.runInContext(readFileSync('crm/js/supabase.js','utf8'),context);
  assert.equal(vm.runInContext('getAuthConfirmationRedirectUrl()',context),'https://preview.test/crm/confirm.html');
});

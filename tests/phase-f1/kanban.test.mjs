import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function runtime(extra = {}) {
  const ctx = vm.createContext({console, setTimeout, clearTimeout, ...extra});
  for (const file of ['utils','data','leads','kanban-data','kanban']) vm.runInContext(readFileSync(`crm/js/${file}.js`,'utf8'),ctx);
  return ctx;
}
const fixture = () => [
  {id:'a',name:'João Silva',phone:'(65) 99999-0001',origin:'site',stage:'novo',assigned_to:'agent',updated_at:'2026-08-30T12:00:00.123456Z'},
  {id:'b',name:'Maria',phone:'65988880002',origin:'anunciar_imovel',stage:'visita',assigned_to:null},
  {id:'c',name:'Pedro',origin:'manual',stage:'novo',assigned_to:'manager'}
];
const plain = value => JSON.parse(JSON.stringify(value));
test('lead belongs to its stage and unassigned leads remain visible',()=>{ const r=runtime(); assert.deepEqual(plain(r.filterKanbanLeads(fixture(),{stage:'novo'})).map(l=>l.id),['a','c']); assert.equal(r.filterKanbanLeads(fixture(),{assignee:'unassigned'})[0].id,'b'); });
test('accent insensitive name search',()=>assert.equal(runtime().filterKanbanLeads(fixture(),{search:'joao'})[0].id,'a'));
test('phone search ignores formatting',()=>assert.equal(runtime().filterKanbanLeads(fixture(),{search:'65999990001'})[0].id,'a'));
test('combined filters intersect predictably',()=>assert.equal(runtime().filterKanbanLeads(fixture(),{origin:'site',assignee:'agent',stage:'visita'}).length,0));
test('empty filters restore all leads',()=>assert.equal(runtime().filterKanbanLeads(fixture(),{}).length,3));
test('optimistic move persists canonical backend response',async()=>{let resolve;const store=runtime().createKanbanStore(fixture(),()=>new Promise(r=>resolve=r));const request=store.move('a','visita');assert.equal(store.leads[0].stage,'visita');assert.ok(store.pending.has('a'));resolve({...fixture()[0],stage:'visita',updated_at:'new'});await request;assert.equal(store.leads[0].updated_at,'new');assert.equal(store.pending.size,0);});
test('failure restores exact previous lead and order',async()=>{const store=runtime().createKanbanStore(fixture(),async()=>{throw Error('network');});await assert.rejects(store.move('a','visita'));assert.deepEqual(plain(store.leads),fixture());});
test('empty backend response is not false success',async()=>{const store=runtime().createKanbanStore(fixture(),async()=>undefined);await assert.rejects(store.move('a','visita'));assert.equal(store.leads[0].stage,'novo');});
test('same lead cannot race stage against assignment',async()=>{let release;const store=runtime().createKanbanStore(fixture(),()=>new Promise(r=>release=r),async()=>{});const p=store.move('a','visita');await assert.rejects(store.assign('a','manager'));release({...fixture()[0],stage:'visita'});await p;assert.equal(store.leads.length,3);});
test('different lead moves do not overwrite each other',async()=>{const store=runtime().createKanbanStore(fixture(),async(l,p)=>({...l,...p}));await Promise.all([store.move('a','visita'),store.move('c','fechado')]);assert.deepEqual(store.leads.map(l=>l.stage),['visita','visita','fechado']);});
test('refresh cannot replace pending mutation',async()=>{let release;const store=runtime().createKanbanStore(fixture(),()=>new Promise(r=>release=r));const p=store.move('a','visita');assert.throws(()=>store.replace([]));release({...fixture()[0],stage:'visita'});await p;});
test('invalid stage and missing lead rejected without persistence',async()=>{let calls=0;const store=runtime().createKanbanStore(fixture(),async()=>calls++);await assert.rejects(store.move('a','invalid'));await assert.rejects(store.move('missing','novo'));assert.equal(calls,0);});
test('same stage is a no-op',async()=>{let calls=0;await runtime().createKanbanStore(fixture(),async()=>calls++).move('a','novo');assert.equal(calls,0);});
for(const role of ['owner','manager','agent']) test(`${role} UI permission matches existing ownership rules`,()=>{const r=runtime();assert.equal(r.kanbanCanOperate({role,status:'active'},fixture()[0],'agent'),true);if(role==='agent')assert.equal(r.kanbanCanOperate({role,status:'active'},fixture()[1],'agent'),false);});
test('disabled UI cannot operate even if cached role is owner',()=>assert.equal(runtime().kanbanCanOperate({role:'owner',status:'disabled'},fixture()[0],'agent'),false));
test('assignment rollback does not lose unassigned lead',async()=>{const store=runtime().createKanbanStore(fixture(),null,async()=>{throw Error('denied');});await assert.rejects(store.assign('b','agent'));assert.equal(store.leads[1].assigned_to,null);});
test('stage request uses timestamp CAS and only allowed stage field',async()=>{let call;const r=runtime({isDemoMode:()=>false,supabaseRequest:async(path,options)=>{call={path,options};return [{...fixture()[0],stage:'visita'}];}});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);await r.moveKanbanLead(fixture()[0],'visita');assert.match(call.path,/organization_id=eq.org-a/);assert.ok(call.path.includes(encodeURIComponent(fixture()[0].updated_at)));assert.deepEqual(JSON.parse(call.options.body),{stage:'visita'});});
test('RLS zero rows raises conflict',async()=>{const r=runtime({isDemoMode:()=>false,supabaseRequest:async()=>[]});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);await assert.rejects(r.moveKanbanLead(fixture()[0],'visita'));});
test('quick editor rejects zero-row writes and carries exact revision',async()=>{let path;const r=runtime({isDemoMode:()=>false,supabaseRequest:async(url)=>{path=url;return [];}});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);await assert.rejects(r.updateLead('a',{stage:'visita'},fixture()[0].updated_at));assert.ok(path.includes(encodeURIComponent(fixture()[0].updated_at)));});
test('assignment uses official Phase D RPC, not protected PATCH',async()=>{let call;const r=runtime({isDemoMode:()=>false,supabaseRequest:async(path,options)=>{call={path,options};return {...fixture()[0],assigned_to:'manager'};}});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);await r.assignKanbanLead('a','manager');assert.equal(call.path,'/rest/v1/rpc/assign_lead');assert.deepEqual(JSON.parse(call.options.body),{target_organization:'org-a',target_lead:'a',target_user:'manager'});});
test('missing capability fails closed without fallback mutation',async()=>{const r=runtime({isDemoMode:()=>false,supabaseRequest:async()=>{throw Error('RPC unavailable');}});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);assert.equal(await r.getKanbanAccess(),null);});
test('keyset loader exhausts server pages even below requested limit',async()=>{const calls=[];let i=0;const r=runtime({isDemoMode:()=>false,supabaseRequest:async path=>{calls.push(path);return [[fixture()[0]],[fixture()[1]],[]][i++];}});vm.runInContext("getActiveOrganizationId=async()=> 'org-a'",r);assert.equal((await r.getKanbanLeads()).length,2);assert.match(calls[1],/id=gt.a/);});
test('phone CTA rejects script or malformed numbers',()=>{const r=runtime();assert.equal(r.kanbanPhone('javascript:alert(1)'), '');assert.equal(r.kanbanPhone('(65) 99999-0001'),'5565999990001');});
test('quick editor preserves exact follow-up instant and phone values',()=>{const r=runtime(),lead={...fixture()[0],next_follow_up:'2026-08-30T19:39:22.123Z'};assert.equal(r.leadDatePayload(lead,'proximo_retorno',r.leadValue(lead,'proximo_retorno')),lead.next_follow_up);assert.equal(r.leadValue(lead,'telefone'),lead.phone);});
test('edited local appointment is serialized with explicit UTC timezone',()=>{const r=runtime(),input='2026-09-01T15:30';assert.equal(r.leadDatePayload(null,'data_visita',input),new Date(input).toISOString());assert.equal(r.leadDatePayload(null,'data_visita',''),null);});

function pointerFixture(allowed=true) {
  const classes=()=>({values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);}});
  const document=new EventTarget(),window=new EventTarget(),handle=new EventTarget();
  handle.classList=classes();handle.isConnected=true;handle.disabled=false;
  const target={classList:classes(),dataset:{stage:'visita'}};
  document.elementFromPoint=()=>({closest:()=>target});
  const board={scrollLeft:0,contains:el=>el===target,getBoundingClientRect:()=>({left:0,right:900})};
  const drops=[];runtime({document,window}).installKanbanDrag(handle,board,()=>allowed,stage=>drops.push(stage));
  const fire=(node,type,props={})=>node.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{button:0,pointerId:1,clientX:100,clientY:100,...props}));
  return {document,window,handle,target,board,drops,fire};
}
test('mouse or touch pointer drop changes stage exactly once and removes listeners',()=>{const f=pointerFixture();f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});assert.ok(f.target.classList.values.has('is-drop-target'));f.fire(f.document,'pointerup',{clientX:200});f.fire(f.document,'pointerup',{clientX:200});assert.deepEqual(f.drops,['visita']);assert.equal(f.target.classList.values.size,0);});
test('small pointer movement is a click, not a stage change',()=>{const f=pointerFixture();f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:103});f.fire(f.document,'pointerup');assert.equal(f.drops.length,0);});
test('cancelled pointer and Escape restore drag visuals without writes',()=>{for(const action of ['pointercancel','keydown']){const f=pointerFixture();f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});f.fire(f.document,action,{key:'Escape'});f.fire(f.document,'pointerup');assert.equal(f.drops.length,0);assert.equal(f.target.classList.values.size,0);}});
test('disabled or unauthorized handle cannot start dragging',()=>{for(const disabled of [true,false]){const f=pointerFixture(disabled);f.handle.disabled=disabled;f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});f.fire(f.document,'pointerup');assert.equal(f.drops.length,0);}});
test('dropping outside this board cannot mutate a lead',()=>{const f=pointerFixture();f.document.elementFromPoint=()=>null;f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});f.fire(f.document,'pointerup');assert.equal(f.drops.length,0);});
test('unrelated pointer cannot finish another gesture',()=>{const f=pointerFixture();f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});f.fire(f.document,'pointerup',{pointerId:2});assert.equal(f.drops.length,0);f.fire(f.document,'pointerup');assert.equal(f.drops.length,1);});
test('navigating away or losing window focus cancels drag safely',()=>{for(const detached of [true,false]){const f=pointerFixture();f.fire(f.handle,'pointerdown');f.fire(f.document,'pointermove',{clientX:200});if(detached){f.handle.isConnected=false;f.fire(f.document,'pointermove',{clientX:220});}else f.fire(f.window,'blur');f.fire(f.document,'pointerup');assert.equal(f.drops.length,0);}});

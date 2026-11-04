import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync('js/public-catalog.js','utf8');
function harness(responses, initial = new Map(), backend = 'https://staging.supabase.co') {
  const calls = [];
  const context = vm.createContext({window:{location:{hostname:'preview.test'}}, PUBLIC_LEAD_CONFIG:{supabaseUrl:backend,publishableKey:'public'},
    console:{warn(){}}, localStorage:{getItem:k=>initial.get(k)||null,setItem:(k,v)=>initial.set(k,v)},
    fetch: async url => {calls.push(url);const next=responses.shift();if(next instanceof Error)throw next;return {ok:next.ok??true,json:async()=>next.data};}});
  vm.runInContext(source,context);
  return {load:context.window.loadPublishedProperties, calls, storage:initial};
}
const plain = value => JSON.parse(JSON.stringify(value));
test('valid empty RPC clears old results and remains empty during a later outage',async()=>{
  const run=harness([{data:[{codigo:'OLD'}]},{data:[]},new Error('offline')]);
  assert.equal((await run.load())[0].codigo,'OLD');
  assert.deepEqual(plain(await run.load()),[]);
  assert.deepEqual(plain(await run.load()),[]);
  assert.equal(run.calls.length,3);assert.ok(run.calls.every(url=>url.includes('/rpc/list_public_properties')));
});
test('cache from another environment/hostname and the v1 cache are never reused',async()=>{
  const storage=new Map([['vcimob-public-catalog-v1',JSON.stringify({savedAt:Date.now(),properties:[{codigo:'OLD'}]})]]);
  const first=harness([{data:[{codigo:'A'}]}],storage,'https://tenant-a.supabase.co');await first.load();
  const second=harness([new Error('offline'),{data:[{codigo:'STATIC'}]}],storage,'https://tenant-b.supabase.co');
  assert.equal((await second.load())[0].codigo,'STATIC');assert.equal(second.calls.length,2);
});
test('HTTP failure uses a recent cache, and a malformed RPC response uses the static fallback',async()=>{
  const run=harness([{data:[{codigo:'A'}]},{ok:false},]);await run.load();assert.equal((await run.load())[0].codigo,'A');
  const bad=harness([{data:{unexpected:true}},{data:[{codigo:'STATIC'}]}]);assert.equal((await bad.load())[0].codigo,'STATIC');
});
test('PostgREST wrapped rows remain supported',async()=>{
  const run=harness([{data:[{list_public_properties:{codigo:'WRAPPED'}}]}]);assert.equal((await run.load())[0].codigo,'WRAPPED');
});

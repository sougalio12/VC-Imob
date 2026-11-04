import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function harness() {
  const nodes=new Map(),events={},calls=[];let modal,focusReturns=0;
  const element=()=>({hidden:true,value:'',listeners:{},reset(){this.resets=(this.resets||0)+1;},focus(){},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);}});
  const document={activeElement:{focus(){focusReturns++;}},body:{append(){}},createElement(){modal=element();return modal;},addEventListener:(name,fn)=>events[name]=fn};
  const context=vm.createContext({window:{VC_IMOB_CONFIG:{supabaseUrl:'http://127.0.0.1:54321',supabasePublishableKey:'public'}},document,URLSearchParams,
    location:{search:'?utm_source=instagram',origin:'http://127.0.0.1:4174',pathname:'/'},
    FormData:class {constructor(){this.data={name:'Cliente',phone:'65999990000',email:'',website:''};}get(k){return this.data[k];}},
    fetch:async(url,options)=>{calls.push({url,options});return{ok:true};}});
  vm.runInContext(readFileSync('js/site-lead.js','utf8'),context);
  return{open:context.window.siteLeadCapture.openInterestFlow,get modal(){return modal;},nodes,events,calls,get focusReturns(){return focusReturns;}};
}
test('skip works on first open, clears state and never captures data',()=>{
  const run=harness();let continued=0;run.open({propertyCode:'VCI000001',onContinue:()=>continued++});
  run.nodes.get('.site-lead-skip').listeners.click();assert.equal(continued,1);assert.equal(run.calls.length,0);
  assert.equal(run.modal._siteLeadState,null);assert.equal(run.nodes.get('form').onsubmit,null);assert.equal(run.focusReturns,1);
});
test('submit then skip another property uses only the new callback',async()=>{
  const run=harness();let first=0,second=0;
  run.open({propertyCode:'VCI000001',propertyTitle:'A',onContinue:()=>first++});
  run.nodes.get('form').onsubmit({preventDefault(){}});await Promise.resolve();
  assert.equal(first,1);assert.equal(JSON.parse(run.calls[0].options.body).propertyCode,'VCI000001');
  run.open({propertyCode:'VCI000002',onContinue:()=>second++});run.nodes.get('.site-lead-skip').listeners.click();
  assert.equal(first,1);assert.equal(second,1);assert.equal(run.calls.length,1);assert.equal(run.modal._siteLeadState,null);
});
test('escape, close button and backdrop discard the previous callback',()=>{
  const run=harness();let callbacks=0;
  for(const close of [()=>run.events.keydown({key:'Escape'}),()=>run.nodes.get('.site-lead-close').listeners.click(),()=>run.modal.listeners.click({target:run.modal})]) {
    run.open({onContinue:()=>callbacks++});close();assert.equal(run.modal._siteLeadState,null);assert.equal(run.modal.hidden,true);
  }
  assert.equal(callbacks,0);
});

import test from'node:test';import assert from'node:assert/strict';import{runtime,lead,properties}from'./helpers.mjs';
test('F3 returns only objectively compatible properties',()=>assert.deepEqual(runtime().matchProperties(lead(),properties).map(m=>m.property.codigo),['VCI1']));
test('F3 explains matching percentage',()=>{const match=runtime().matchProperties(lead(),properties)[0];assert.equal(match.compatibility,100);assert.ok(match.reasons.includes('preço'));});
test('F3 supports Brazilian property measurements',()=>assert.equal(runtime().parsePropertyNumber('437,50 m²'),437.5));
test('F3 preserves multiple interests independently',async()=>{const r=runtime(undefined,{isDemoMode:()=>true});await r.addLeadInterestF('l',{codigo:'A',titulo:'A'});await r.addLeadInterestF('l',{codigo:'B',titulo:'B'});assert.equal((await r.getLeadInterestsF('l')).length,2);});

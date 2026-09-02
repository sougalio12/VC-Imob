import test from'node:test';import assert from'node:assert/strict';import{runtime,lead}from'./helpers.mjs';
test('F4 gives explicit high priority to overdue interested lead',()=>{const score=runtime().scoreLead(lead(),[{status:'agendado',scheduled_at:'2026-09-01',kind:'retorno'}],[{}],new Date('2026-09-02'));assert.equal(score.label,'Quente');assert.ok(score.reasons.length>=2);});
test('F4 never scores sensitive attributes',()=>{const score=runtime().scoreLead({...lead(),religion:'x',gender:'x'},[],[],new Date('2026-09-02'));assert.equal(score.reasons.some(r=>/relig|gênero/.test(r)),false);});
test('F4 closes prioritization after terminal stage',()=>assert.equal(runtime().scoreLead(lead({stage:'fechado'}),[],[]).score,0));

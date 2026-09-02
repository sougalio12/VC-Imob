import test from'node:test';import assert from'node:assert/strict';import{runtime,lead}from'./helpers.mjs';
test('F7 score and matching do not mutate source lead',()=>{const r=runtime(),source=lead(),snapshot=JSON.stringify(source);r.scoreLead(source,[],[]);r.matchProperties(source,[]);assert.equal(JSON.stringify(source),snapshot);});
test('F7 malformed numbers fail closed',()=>assert.equal(runtime().parsePropertyNumber('não informado'),null));
test('F7 terminal leads do not generate stale automation alerts',()=>assert.equal(runtime().buildInternalAlerts([lead({stage:'perdido',updated_at:'2020-01-01'})],[],{stale_lead_days:1,follow_up_reminder_hours:24,alert_unassigned:true},new Date('2026-09-02')).length,0));

import test from'node:test';import assert from'node:assert/strict';import{runtime}from'./helpers.mjs';
test('F5 groups origins deterministically',()=>{const r=runtime(['utils','data','crm-advanced-data','dashboard']);assert.deepEqual(JSON.parse(JSON.stringify(r.countBy([{origin:'site'},{origin:'site'},{origin:'indicação'}],i=>i.origin))),[['site',2],['indicação',1]]);});
test('F5 handles empty report groups',()=>{const r=runtime(['utils','data','crm-advanced-data','dashboard']);assert.deepEqual(JSON.parse(JSON.stringify(r.countBy([],i=>i.origin))),[]);});

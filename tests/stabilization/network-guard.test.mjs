import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {assertLoopback} from '../helpers/no-network.mjs';

test('Node network guard blocks production, remote services and disguised localhost URLs',()=>{
  for(const url of ['https://isbkhhobutbdtdtpaavn.supabase.co/rest/v1/leads','https://remote.supabase.co','http://127.0.0.1@remote.test','http://localhost.remote.test','https://remote.test/127.0.0.1']) {
    assert.throws(()=>assertLoopback(url),/network guard/);
    assert.throws(()=>fetch(url),/network guard/);
    assert.throws(()=>https.request(url),/network guard/);
  }
});
test('HTTP options and URL overrides cannot bypass the guard',()=>{
  assert.throws(()=>http.get({hostname:'remote.test',path:'/'}),/network guard/);
  assert.throws(()=>https.request('https://localhost',{hostname:'remote.test'}),/network guard/);
  assert.equal(assertLoopback('http://127.0.0.1:54321').hostname,'127.0.0.1');
});

// Loaded in Node test workers. No live remote backend may be reached by tests.
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';

export function assertLoopback(input) {
  const url=new URL(input);
  if (!['http:','https:','ws:','wss:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Test network guard: remote requests are forbidden.');
  return url;
}
const fetchLocal=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  assertLoopback(typeof input==='string'||input instanceof URL?input:input.url);
  return fetchLocal(input,options);
};
for(const [client,protocol] of [[http,'http:'],[https,'https:']]) {
  for(const method of ['request','get']) {
    const original=client[method];
    client[method]=function(input,...args) {
      let target=input;
      if(input&&typeof input==='object'&&!(input instanceof URL)) {
        const host=input.hostname||input.host||'localhost';
        target=`${input.protocol||protocol}//${host}`;
      }
      assertLoopback(target);
      // URL overloads may override the destination through the second options object.
      const override=args[0];
      if(override&&typeof override==='object'&&(override.hostname||override.host))assertLoopback(`${override.protocol||protocol}//${override.hostname||override.host}`);
      return Reflect.apply(original,this,[input,...args]);
    };
  }
}
syncBuiltinESMExports();
if(globalThis.WebSocket) {
  const LocalWebSocket=globalThis.WebSocket;
  globalThis.WebSocket=class extends LocalWebSocket {
    constructor(url,...args){assertLoopback(url);super(url,...args);}
  };
}

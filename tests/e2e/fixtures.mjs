import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
export const catalog=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url),'utf8'));
const SITE='http://127.0.0.1:4176',BACKEND='http://127.0.0.1:54321';
export const test=base.extend({
  controlledSite:[async({context},use)=>{
    const blocked=[],captures=[],rpcCalls=[],errors=[];
    const state={catalog:structuredClone(catalog)};
    // No service workers, external HTTP requests, popups or WebSockets can contact production.
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.routeWebSocket('**/*',socket=>{blocked.push(socket.url());socket.close();});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===BACKEND){
        if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':SITE,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'apikey,content-type'}});return;}
        if(url.pathname==='/rest/v1/rpc/list_public_properties'&&route.request().method()==='POST'){
          rpcCalls.push(route.request().postDataJSON());await route.fulfill({headers:{'access-control-allow-origin':SITE},json:state.catalog});return;
        }
        if(url.pathname==='/functions/v1/site-lead'&&route.request().method()==='POST'){
          captures.push(route.request().postDataJSON());await route.fulfill({status:201,headers:{'access-control-allow-origin':SITE},json:{ok:true,created:true}});return;
        }
      }else if(url.origin===SITE){await route.continue();return;}
      blocked.push(url.href);await route.abort('blockedbyclient');
    });
    await context.addInitScript(({site})=>{
      if(location.origin!==site)return;
      localStorage.setItem('vci_cookie_choice','essential');
      window.__e2eOpenedUrls=[];
      window.open=url=>{window.__e2eOpenedUrls.push(String(url));return null;};
    },{site:SITE});
    await use({state,captures,rpcCalls,blocked});
    expect(blocked,'Unexpected network request (all remote services are blocked)').toEqual([]);
    expect(errors,'Uncaught application errors').toEqual([]);
  },{auto:true}],
});
export {expect};

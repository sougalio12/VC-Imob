import '../tests/helpers/no-network.mjs';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {buildWeb} from './build-web.mjs';

// Force a synthetic, local configuration even when a shell has production variables.
Object.assign(process.env,{NODE_ENV:'test',VC_IMOB_TEST_RUN:'1',VC_IMOB_ENVIRONMENT:'development',
  VC_IMOB_SUPABASE_URL:'http://127.0.0.1:54321',VC_IMOB_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_e2e_fixture',
  VC_IMOB_SITE_ORIGIN:'http://127.0.0.1:4176'});
const root=await buildWeb('development');
const fixture=await readFile(new URL('../tests/e2e/fixtures/catalog.json',import.meta.url));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://127.0.0.1:4176');
    if(url.pathname==='/data/imoveis.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(fixture);return;}
    if(url.pathname==='/data/noticias.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('[]');return;}
    const pathname=decodeURIComponent(url.pathname),file=resolve(root,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    if(!(await stat(file)).isFile())throw new Error('Not a file');
    const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(content);
  }catch{res.writeHead(404).end('Not found');}
}).listen(4176,'127.0.0.1',()=>console.log('E2E fixture server: http://127.0.0.1:4176 (no backend connections)'));

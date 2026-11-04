import {buildWeb} from './build-web.mjs';
const output = await buildWeb('development');
process.chdir(output);
await import('./local-site-server.mjs');

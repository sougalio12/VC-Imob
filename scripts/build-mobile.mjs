import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWeb } from './build-web.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist-mobile');
const option = process.argv.indexOf('--environment');
const environment = option >= 0 ? process.argv[option + 1] : process.env.VC_IMOB_ENVIRONMENT || 'development';
await buildWeb(environment, output, true);
await cp(resolve(root, 'mobile/web/index.html'), resolve(output, 'index.html'));
console.log(`Bundle mobile local criado: ${environment}. Nenhum deploy executado.`);

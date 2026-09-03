import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist-mobile');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const directory of ['crm', 'assets', 'css', 'data', 'js']) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
for (const file of ['imovel.html']) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, 'mobile/web/index.html'), resolve(output, 'index.html'));

console.log('Bundle mobile criado em dist-mobile.');

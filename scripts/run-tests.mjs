import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const walk = directory => readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const group = process.argv[2] || 'all';
if (!['all','unit','db','stabilization'].includes(group)) throw new Error('Unknown test group');
const files = walk('tests').filter(file => file.endsWith('.test.mjs')).filter(file => {
  const database = /database|crud-security|global-mobile-crud-audit/.test(file);
  return group === 'all' || group === 'unit' && !database || group === 'db' && database || group === 'stabilization' && file.startsWith('tests/stabilization/');
});
const result = spawnSync(process.execPath, ['--import', './tests/helpers/no-network.mjs', '--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit', env: {...process.env, TZ:'America/Cuiaba', NODE_ENV:'test', VC_IMOB_TEST_RUN:'1', PGLITE_PACKAGE: resolve('node_modules/@electric-sql/pglite')}
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

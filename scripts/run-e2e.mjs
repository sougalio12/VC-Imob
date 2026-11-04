import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const result=spawnSync(process.execPath,['--import','./tests/helpers/no-network.mjs',require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)],{
  stdio:'inherit',
  env:{...process.env,NODE_ENV:'test',VC_IMOB_TEST_RUN:'1',TZ:'America/Cuiaba',
    VC_IMOB_ENVIRONMENT:'development',VC_IMOB_SUPABASE_URL:'http://127.0.0.1:54321',
    VC_IMOB_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_e2e_fixture',VC_IMOB_SITE_ORIGIN:'http://127.0.0.1:4176'}
});
if(result.error)throw result.error;
process.exitCode=result.status??1;

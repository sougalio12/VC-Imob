import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildWeb(environment = 'development', output = resolve(root, 'dist'), native = false) {
  if (!['development', 'staging', 'production'].includes(environment)) throw new Error('Ambiente inválido.');
  if (environment === 'production' && (process.env.VC_IMOB_TEST_RUN === '1' || process.env.NODE_ENV === 'test' || process.env.GITHUB_EVENT_NAME === 'pull_request')) throw new Error('Produção bloqueada em testes/previews de PR.');
  const config = JSON.parse(await readFile(resolve(root, `config/environments/${environment}.json`), 'utf8'));
  for (const [field, name] of Object.entries({supabaseUrl:'VC_IMOB_SUPABASE_URL',supabasePublishableKey:'VC_IMOB_SUPABASE_PUBLISHABLE_KEY',siteOrigin:'VC_IMOB_SITE_ORIGIN'})) {
    if (process.env[name]) config[field] = process.env[name];
  }
  if (environment !== 'development' && (!config.supabaseUrl || !config.supabasePublishableKey || !config.siteOrigin)) throw new Error('Configure URL, chave pública e origem do ambiente.');
  const location = new URL(config.siteOrigin || 'http://127.0.0.1:4174');
  const context = vm.createContext({ window: {location}, URL, atob, console: {error(){}} });
  vm.runInContext(await readFile(resolve(root, 'js/runtime-config.js'), 'utf8'), context);
  context.window.resolveVcImobConfig(config, location, native); // Fail before writing an artifact.
  if (output === root || !['dist', 'dist-mobile'].includes(basename(output))) throw new Error('Saída de build inválida.');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const directory of ['crm', 'assets', 'css', 'data', 'js']) await cp(resolve(root, directory), resolve(output, directory), {recursive:true});
  for (const file of ['index.html', 'imovel.html', 'selecao.html', 'favicon.ico', '_headers']) await cp(resolve(root, file), resolve(output, file));
  await writeFile(resolve(output, 'js/environment.js'), `// Generated public configuration: ${environment}\nwindow.VC_IMOB_ENV = ${JSON.stringify(config, null, 2)};\n`);
  let headers = await readFile(resolve(root, '_headers'), 'utf8');
  if (config.supabaseUrl) {
    const backend = new URL(config.supabaseUrl);
    headers = headers.replaceAll('https://isbkhhobutbdtdtpaavn.supabase.co', backend.origin).replaceAll('wss://isbkhhobutbdtdtpaavn.supabase.co', `${backend.protocol === 'https:' ? 'wss:' : 'ws:'}//${backend.host}`);
  }
  if (environment === 'development') headers = headers.replace('; upgrade-insecure-requests', '');
  await writeFile(resolve(output, '_headers'), headers);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv.indexOf('--environment');
  const environment = option >= 0 ? process.argv[option + 1] : process.env.VC_IMOB_ENVIRONMENT || 'development';
  await buildWeb(environment);
  console.log(`Build local concluído: ${environment} (dist). Nenhum deploy executado.`);
}

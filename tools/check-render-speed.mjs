// Running-page timing check: after setup with real Catalog prepared content, the frameworks list and Your setup are
// usable within a fixed budget once the host API calls complete, and the page's own work stays within it. Usage:
//   node tools/check-render-speed.mjs <core.tgz> <scan.tgz> <catalog.tgz> <output> [--budget-ms 5000]
// The content is the installed Catalog package's prepared content, bound to the exact Catalog archive, the same
// sources tools/check-setup-identity.mjs reads in its identity scenario.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { startPreview } from './preview.mjs';

const args = process.argv.slice(2);
const budgetAt = args.indexOf('--budget-ms'), budgetMs = budgetAt >= 0 ? Number(args.splice(budgetAt, 2)[1]) : undefined;
const [core, scan, catalog, out] = args;
if (!core || !scan || !catalog || !out) throw new Error('Usage: check-render-speed.mjs <core.tgz> <scan.tgz> <catalog.tgz> <output> [--budget-ms N]');
const output = resolve(out); await mkdir(output, { recursive: true });
const temporary = join(output, 'tmp'); await mkdir(temporary, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'ms-playwright');
Object.assign(process.env, homeEnvironment(join(output, 'home')), { TMPDIR: temporary, TMP: temporary, TEMP: temporary });
delete process.env.AIH_CONSUMER_PROJECT;
const supplied = { core: resolve(core), scan: resolve(scan), catalog: resolve(catalog) };
const archiveSha256 = createHash('sha256').update(await readFile(supplied.catalog)).digest('hex');
const directory = join(output, 'page');
const preview = await startPreview({ supplied, port: await freePort(), runDir: join(directory, 'run'), settingsPath: join(directory, 'settings.json'), quiet: true,
  beforeServe: async ({ consumerDir }) => {
    const { setupIdentitySources } = await import(pathToFileURL(join(consumerDir, 'consumer/setup-identity-browser.mjs')).href);
    await writeFile(join(directory, 'sources.json'), JSON.stringify(await setupIdentitySources({ directory, scenario: 'identity', archivePath: supplied.catalog, archiveSha256 })));
    process.env.AIH_FRAMEWORK_SOURCES = join(directory, 'sources.json');
  } });
let result;
try {
  const { runRenderSpeedBrowser } = await import(pathToFileURL(join(preview.consumerDir, 'consumer/render-speed-browser.mjs')).href);
  result = await runRenderSpeedBrowser({ origin: preview.url.replace(/\/$/, ''), output: directory, playwrightModule: import.meta.resolve('playwright'), budgetMs });
} catch (error) { result = { status: 'failed', error: error.message }; }
finally { await preview.close(); }
for (const { name, totalMs, afterApiMs, mainThreadMs, apiCalls } of result.steps ?? []) console.log(`${name}: ${afterApiMs} ms after ${apiCalls} API call(s) completed, ${mainThreadMs} ms page work (${totalMs} ms in all)`);
console.log(result.status === 'passed' ? `passed: within ${result.budgetMs} ms` : `failed: ${result.error}`);
await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
if (result.status !== 'passed') process.exitCode = 1;

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((done, fail) => { const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); }); });
}

// Running-page check for Your setup's content identity and the release list's index status, on the packed public
// packages. Usage: node tools/check-setup-identity.mjs <core.tgz> <scan.tgz> <catalog.tgz> <output> [scenario...]
// Every scenario reads real Catalog content: the installed Catalog package's prepared content, bound to the exact
// Catalog archive, and, for the index scenarios, Catalog's own published release-index fixtures read by its reader.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { startPreview } from './preview.mjs';

const [core, scan, catalog, out, ...selected] = process.argv.slice(2);
if (!core || !scan || !catalog || !out) throw new Error('Usage: check-setup-identity.mjs <core.tgz> <scan.tgz> <catalog.tgz> <output> [scenario...]');
const output = resolve(out); await mkdir(output, { recursive: true });
const temporary = join(output, 'tmp'); await mkdir(temporary, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'ms-playwright');
Object.assign(process.env, homeEnvironment(join(output, 'home')), { TMPDIR: temporary, TMP: temporary, TEMP: temporary });
delete process.env.AIH_CONSUMER_PROJECT;
const supplied = { core: resolve(core), scan: resolve(scan), catalog: resolve(catalog) };
const catalogSha256 = createHash('sha256').update(await readFile(supplied.catalog)).digest('hex');
const { name, version } = JSON.parse(execFileSync('tar', ['-xzOf', supplied.catalog, 'package/package.json'], { maxBuffer: 1_048_576 }).toString('utf8'));
const catalogPackage = { name, version };
const playwrightModule = import.meta.resolve('playwright');
const scenarios = selected.length ? selected : ['identity', 'prepared', 'signed', 'offline-undated', 'unsigned', 'expired', 'rollback-refused', 'conflict'];
// The first scenario installs the three archives into one consumer; later scenarios reuse those verified packages.
let consumerDir;
const results = [];
for (const scenario of scenarios) {
  const directory = join(output, scenario); await mkdir(directory, { recursive: true });
  const preview = await startPreview({ supplied, port: await freePort(), runDir: join(directory, 'run'),
    installedConsumerDir: consumerDir, settingsPath: join(directory, 'settings.json'), quiet: true,
    beforeServe: async ({ consumerDir: installedDir }) => {
      const { setupIdentitySources } = await import(pathToFileURL(join(installedDir, 'consumer/setup-identity-browser.mjs')).href);
      const configuration = await setupIdentitySources({ directory, scenario, archivePath: supplied.catalog, archiveSha256: catalogSha256 });
      await writeFile(join(directory, 'sources.json'), JSON.stringify(configuration));
      process.env.AIH_FRAMEWORK_SOURCES = join(directory, 'sources.json');
    } });
  consumerDir ??= preview.consumerDir;
  try {
    const { runSetupIdentityBrowser } = await import(pathToFileURL(join(preview.consumerDir, 'consumer/setup-identity-browser.mjs')).href);
    results.push(await runSetupIdentityBrowser({ origin: preview.url.replace(/\/$/, ''), output: directory, playwrightModule, scenario, catalogSha256, catalogPackage }));
    console.log(`passed: ${scenario}`);
  } catch (error) {
    // Every scenario runs, so one result names each state that fails.
    results.push({ status: 'failed', scenario, error: error.message });
    console.log(`failed: ${scenario}: ${error.message}`);
  } finally { await preview.close(); }
}
const status = results.every(result => result.status === 'passed') ? 'passed' : 'failed';
await writeFile(join(output, 'result.json'), JSON.stringify({ status, catalogSha256, results }, null, 2));
if (status !== 'passed') process.exitCode = 1;

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((done, fail) => { const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); }); });
}

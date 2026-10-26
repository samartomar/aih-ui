// Focused running-page acceptance using installed packed public packages. No module-level assertions.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets, serviceAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { coreTargetsSummary } from './server/core-targets-summary.mjs';
import { callService } from './server/service-client.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..'), consumerDir = resolve(process.argv[2]), output = resolve(process.argv[3]);
const artifacts = JSON.parse(await readFile(process.argv[4], 'utf8'));
const account = homedir();
const browserCache = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(account, 'AppData', 'Local')) : process.platform === 'darwin' ? join(account, 'Library', 'Caches') : (process.env.XDG_CACHE_HOME ?? join(account, '.cache'));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(browserCache, 'ms-playwright');
const temporary = join(output, 'tmp'); await mkdir(temporary, { recursive: true });
Object.assign(process.env, homeEnvironment(join(output, 'home')), { TMPDIR: temporary, TMP: temporary, TEMP: temporary });
// Browsing and saved intent only: this proof does not acquire an execution target.
delete process.env.AIH_CONSUMER_PROJECT;
for (const artifact of Object.values(artifacts)) if (createHash('sha256').update(await readFile(artifact.tarball)).digest('hex') !== artifact.sha256) throw new Error('Pinned package archive differs from its recorded identity.');
const runDir = join(output, 'page'); await buildCss(repo);
for (const [assets, destination] of [[pageAssets(repo), runDir], [serviceAssets(repo), consumerDir]]) for (const asset of assets) {
  const path = join(destination, asset.to); await mkdir(dirname(path), { recursive: true }); await copyFile(join(repo, asset.from), path);
}
const load = name => import(pathToFileURL(join(consumerDir, 'consumer', name)).href);
const selectedCases = process.argv.slice(5);
const unavailableOnly = selectedCases.length === 1 && selectedCases[0] === 'readerUnavailable';
const frameworkFixtures = unavailableOnly ? undefined : (await load('framework-fixtures.mjs')).frameworkFixtures;
const { runFrameworksBrowser, runFrameworkLoadingBrowser, runFrameworkReopenBrowser } = await load('frameworks-browser.mjs');
const fixture = unavailableOnly ? { scenarios: { readerUnavailable: { fixture: true, prepared: [{}] } }, expected: {} } : await frameworkFixtures(join(output, 'fixtures'), artifacts.catalog);
await writeFile(join(output, 'fixture-expectations.json'), JSON.stringify(fixture.expected, null, 2));
const summary = { packages: await Promise.all(Object.entries(artifacts).map(async ([name, value]) => ({name,packageName:`@aihq/${name}`,version:JSON.parse(await readFile(join(consumerDir,`node_modules/@aihq/${name}/package.json`),'utf8')).version,...value}))), coreTargets: coreTargetsSummary(callService(consumerDir, {op:'coreTargets'})) };
const config = join(output, 'sources.json'); process.env.AIH_FRAMEWORK_SOURCES = config;
const outcomes = [];
for (const [scenario, configuration] of [...Object.entries(fixture.scenarios), ...(!unavailableOnly ? [['restart', fixture.scenarios.ready]] : [])].filter(([name]) => !selectedCases.length || selectedCases.includes(name))) {
  await writeFile(config, JSON.stringify(configuration));
  const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(output, 'settings.json') });
  summary.entryCount = started.catalog.items.length; await writeFile(join(runDir,'summary.json'), JSON.stringify(summary));
  const origin = `http://127.0.0.1:${(await listen(started.server,0)).port}`;
  try {
    console.log(`Framework page: ${scenario}`);
    if(scenario==='ready')await runFrameworkLoadingBrowser({origin,output:join(output,'loading'),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});
    if(scenario==='restart') {await runFrameworkReopenBrowser({origin,output:join(output,'restart'),savedDirectory:join(output,'ready'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue;}
    outcomes.push(await runFrameworksBrowser({origin, output:join(output,scenario),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href,scenario,expected:fixture.expected}));
  } finally { await new Promise(done=>started.server.close(done)); }
}
await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',artifacts,outcomes,humanAcceptance:'pending'},null,2));

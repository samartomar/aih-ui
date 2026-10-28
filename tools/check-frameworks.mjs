// Focused running-page acceptance using installed packed public packages. No module-level assertions.
import { execFileSync } from 'node:child_process';
import { verifyInstalledArchive } from './candidate/upgrade.mjs';
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
const installed = Object.fromEntries(Object.entries(artifacts).map(([name, entry]) => [name, verifyInstalledArchive(entry, join(consumerDir, 'node_modules', name === 'ui' ? 'aih-ui' : `@aihq/${name}`))]));
const startedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const copied = [];
const runDir = join(output, 'page'); await buildCss(repo);
for (const [assets, destination] of [[pageAssets(repo), runDir], [serviceAssets(repo), consumerDir]]) for (const asset of assets) {
  const path = join(destination, asset.to); await mkdir(dirname(path), { recursive: true }); await copyFile(join(repo, asset.from), path);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const sha256 = digest(await readFile(join(repo, asset.from)));
  if (digest(await readFile(path)) !== sha256) throw new Error('Copied page/backend differs from the source snapshot.');
  copied.push({ path: asset.from, sha256 });
}
const load = name => import(pathToFileURL(join(consumerDir, 'consumer', name)).href);
const selectedCases = process.argv.slice(5);
const unavailableOnly = selectedCases.length === 1 && selectedCases[0] === 'readerUnavailable';
const frameworkFixtures = unavailableOnly ? undefined : (await load('framework-fixtures.mjs')).frameworkFixtures;
const { runBrowseFeedbackBrowser, runFolderMenuBrowser, runBrowseBrowser, runBrowseReopenBrowser, runOptionalHookBrowser, runBrowseFactsBrowser, runSetActionAccessBrowser, runEvidenceRefreshBrowser, runPluginRoutesBrowser, runRefusedSetFactsBrowser } = await load('browse-browser.mjs');
const { runUi165Browser } = await load('ui165-browser.mjs');
const { runFrameworksBrowser, runFrameworkLoadingBrowser, runFrameworkReopenBrowser } = await load('frameworks-browser.mjs');
const { runSetInputsBrowser } = await load('set-inputs-browser.mjs');
const fixture = unavailableOnly ? { scenarios: { readerUnavailable: { fixture: true, prepared: [{}] } }, expected: {} } : await frameworkFixtures(join(output, 'fixtures'), artifacts.catalog);
for (const name of ['callerInputs', 'callerInputRestart']) if (selectedCases.includes(name)) fixture.scenarios[name] = fixture.scenarios.browse;
await writeFile(join(output, 'fixture-expectations.json'), JSON.stringify(fixture.expected, null, 2));
const summary = { packages: await Promise.all(Object.entries(artifacts).map(async ([name, value]) => ({name,packageName:`@aihq/${name}`,version:JSON.parse(await readFile(join(consumerDir,`node_modules/@aihq/${name}/package.json`),'utf8')).version,...value}))), coreTargets: coreTargetsSummary(callService(consumerDir, {op:'coreTargets'})) };
const config = join(output, 'sources.json'); process.env.AIH_FRAMEWORK_SOURCES = config;
const outcomes = [];
for (const [scenario, configuration, themeCases] of [...Object.entries(fixture.scenarios), ...(!unavailableOnly ? [['restart', fixture.scenarios.ready], ['browseRestart', fixture.scenarios.browse], ['hookRestart', fixture.scenarios.hook], ['hookCross', fixture.scenarios.hook], ['hookCrossRestart', fixture.scenarios.hook], ['setAccess', fixture.scenarios.browse], ['ui165', fixture.scenarios.browse, ['dark']], ['ui165Light', fixture.scenarios.browse, ['light']], ['evidenceRefresh', fixture.scenarios.facts], ['browseFeedback', { prepared: fixture.scenarios.routes.prepared }], ['folderMenu', { prepared: fixture.scenarios.routes.prepared }]] : [])].filter(([name]) => !selectedCases.length || selectedCases.includes(name))) {
  await writeFile(config, JSON.stringify(configuration));
  const frameworkFixtureInventories = ['hook', 'hookRestart', 'hookCross', 'hookCrossRestart'].includes(scenario) ? await (await load('browse-fixtures.mjs')).optionalHookFixture() : undefined;
  const settingsPath = join(output, 'settings.json');
  const priorSettings = scenario === 'facts' ? await readFile(settingsPath).catch(() => undefined) : undefined;
  if (scenario === 'facts') await writeFile(settingsPath, JSON.stringify({ format: 'aih-ui-settings', version: 1, experience: 'enterprise', role: 'developer', organization: null, capabilities: [], clients: [] }));
  const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(output, 'settings.json'), frameworkFixtureInventories });
  summary.entryCount = started.catalog.items.length; await writeFile(join(runDir,'summary.json'), JSON.stringify(summary));
  const origin = `http://127.0.0.1:${(await listen(started.server,0)).port}`;
  try {
    console.log(`Framework page: ${scenario}`);
    if (scenario === 'callerInputs' || scenario === 'callerInputRestart') {
      const inputs = process.env.AIH_TEST_SET_INPUTS ? JSON.parse(await readFile(process.env.AIH_TEST_SET_INPUTS, 'utf8')) : undefined;
      outcomes.push(await runSetInputsBrowser({ origin, output: join(output, scenario), savedDirectory: scenario === 'callerInputRestart' ? join(output, 'callerInputs') : undefined, inputs, expected: fixture.expected, playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href })); continue;
    }
    if(scenario==='eccFacts') { await runRefusedSetFactsBrowser({origin,output:join(output,'eccFacts'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    // Each theme gets its own Workbench host: the host owns the chosen project folder for its lifetime
    // and the public API cannot unset it, so a shared host would leak one theme's folder into the next.
    // Default route runs both (ui165 dark, ui165Light light); pass ui165Light alone to continue only
    // the light iteration on a fresh host without replaying the completed dark one.
    if(scenario==='ui165'||scenario==='ui165Light') { outcomes.push(await runUi165Browser({origin,output:join(output,scenario),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href,themes:themeCases}));continue; }
    if(scenario==='folderMenu') { const folderRoot=join(output,'folder-menu-fixture'); await mkdir(join(folderRoot,'project-a'),{recursive:true}); await runFolderMenuBrowser({origin,output:join(output,'folderMenu'),folderRoot,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='browseFeedback') { outcomes.push(await runBrowseFeedbackBrowser({origin,output:join(output,'browseFeedback'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href}));continue; }
    if(scenario==='routes') { await runPluginRoutesBrowser({origin,output:join(output,'routes'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='setAccess') { await runSetActionAccessBrowser({origin,output:join(output,'setAccess'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='evidenceRefresh') { await runEvidenceRefreshBrowser({origin,output:join(output,'evidenceRefresh'),expected:fixture.expected,positive:(await (await load('browse-summary-fixtures.mjs')).summaryFixtures()).find(value=>value.row===17),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='facts') { await runBrowseFactsBrowser({origin,output:join(output,'facts'),expected:fixture.expected,specimens:await (await load('browse-summary-fixtures.mjs')).summaryFixtures(),fallbackSpecimen:await (await load('browse-summary-fixtures.mjs')).fallbackFixture(),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='browse') { outcomes.push(await runBrowseBrowser({origin,output:join(output,'browse'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href}));continue; }
    if(scenario==='browseRestart') { await runBrowseReopenBrowser({origin,output:join(output,'browseRestart'),savedDirectory:join(output,'browse'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='hookCross') { await runOptionalHookBrowser({origin,output:join(output,'hookCross'),crossFramework:true,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='hookCrossRestart') { await runOptionalHookBrowser({origin,output:join(output,'hookCrossRestart'),savedDirectory:join(output,'hookCross'),crossFramework:true,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='hookRestart') { await runOptionalHookBrowser({origin,output:join(output,'hookRestart'),savedDirectory:join(output,'hook'),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='hook') { await runOptionalHookBrowser({origin,output:join(output,'hook'),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue; }
    if(scenario==='ready')await runFrameworkLoadingBrowser({origin,output:join(output,'loading'),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});
    if(scenario==='restart') {await runFrameworkReopenBrowser({origin,output:join(output,'restart'),savedDirectory:join(output,'ready'),expected:fixture.expected,playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href});continue;}
    outcomes.push(await runFrameworksBrowser({origin, output:join(output,scenario),playwrightModule:pathToFileURL(join(repo,'node_modules/playwright/index.mjs')).href,scenario,expected:fixture.expected}));
  } finally { await new Promise(done=>started.server.close(done)); if (scenario === 'facts' && priorSettings) await writeFile(settingsPath, priorSettings); }
}
const source = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0, pageFiles: await Promise.all(pageAssets(repo).map(async asset => ({ path: asset.from, sha256: createHash('sha256').update(await readFile(join(repo, asset.from))).digest('hex') }))) };
if (source.head !== startedHead || (await Promise.all(copied.map(async file => createHash('sha256').update(await readFile(join(repo, file.path))).digest('hex') === file.sha256))).some(same => !same)) throw new Error('Source changed during the running-page proof; receipt withheld.');
source.copiedFiles = copied;
await writeFile(join(output,'result.json'),JSON.stringify({status:outcomes.some(value=>value?.status==='incomplete')?'incomplete':'passed',source,artifacts,installed,outcomes,humanAcceptance:'pending'},null,2));

// A verified public refusal is useful evidence, but not completed positive acceptance.
if (outcomes.some(value => value?.status === 'incomplete')) process.exitCode = 2;

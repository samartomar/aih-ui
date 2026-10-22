// Exercise the ordinary server against explicitly reviewed, installed archives.
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installConsumer, resolvePackage } from './packages.mjs';
import { serviceAssets } from './server/assets.mjs';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { snapshotCoreHome, compareCoreHome, describeCoreHomeChange } from './core-home-guard.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'aih-workbench-check-'));
const packages = ['core', 'catalog', 'scan'].map(name => {
  const supplied = process.env[`${name.toUpperCase()}_TGZ`];
  if (!supplied) throw new Error(`Set ${name.toUpperCase()}_TGZ to a reviewed packed artifact.`);
  return resolvePackage({ name, supplied, log: console.log });
});
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer'))
  .map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
// The backend worker callService runs inside the consumer.
for (const asset of serviceAssets(repo)) if (asset.to.startsWith('service/')) extraFiles[asset.to] = join(repo, asset.from);
for (const name of ['consumer.html', 'consumer.js', 'intent.html', 'intent.js', 'authoring.html', 'authoring.js', 'policy-file.js', 'app/dom.js', 'app/configuration-editor.js', 'app/claims-view.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, 'src/styles', name);
for (const name of readdirSync(join(repo, 'schemas'))) extraFiles[`schemas/${name}`] = join(repo, 'schemas', name);
// npm run exports user allow-scripts as an environment option. npm rejects that
// option for nested project installs; this isolated install always ignores scripts.
for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete process.env[key];
installConsumer({ consumerDir: output, packages, extraFiles, log: console.log });
writeFileSync(join(output, 'reviewed-packages.json'), JSON.stringify(packages, null, 2) + '\n');
// Core writes its records under the account home, so every stage gets a disposable one. Playwright finds its browsers
// under that home too, so the real browser location is passed through before the home moves.
const realCache = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
  : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'));
const isolated = { ...process.env, ...homeEnvironment(join(output, 'account-home')),
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(realCache, 'ms-playwright') };
// Listing metadata only, never contents: the run fails if the real home's Core records change. It runs on exit, so a
// stage that throws (a timeout, say) is still checked.
const realCoreBefore = snapshotCoreHome(homedir());
process.on('exit', () => {
  const realCoreChange = compareCoreHome(realCoreBefore, snapshotCoreHome(homedir()));
  if (!realCoreChange.unchanged) { console.error(describeCoreHomeChange(realCoreChange)); process.exitCode = 1; }
});
// The reviewed-batch suite alone takes about as long as all the others together, so it runs as its own group.
// The real-Core batch group has its own bounded budget: its serial Windows
// filesystem work measured 115s before the final concurrent-consent regression.
const testGroups = [
  ['ordinary-families', 'authoring-page', 'authoring-v3', 'reviews', 'personal-folder', 'journey', 'readiness', 'readiness-host', 'claims', 'friction', 'authority-source', 'organization-author', 'guided-setup', 'core-targets', 'workspace'],
  ['source-facts', 'scan-evidence', 'release-order', 'update-source', 'maintenance', 'improvements', 'trials'],
  ['batch'],
  ['intent-http', 'intent-page', 'organization', 'saved-intent', 'setup']
];
let checksLog = '';
for (const tests of testGroups) {
  const result = spawnSync(process.execPath, ['--test', ...tests.map(name => join(output, `consumer/${name}.test.mjs`))], {
    cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 20_000_000, timeout: tests.includes('batch') ? 180_000 : 120_000,
    env: { ...isolated, AIH_REPO: repo }
  });
  checksLog += `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(join(output, 'checks.log'), checksLog);
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode !== 0) break;
}
if (process.exitCode === 0) {
  const browser = spawnSync(process.execPath, [join(output, 'consumer/personal-folder-browser.mjs')], {
    cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000,
    env: { ...isolated, PLAYWRIGHT_MODULE: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href,
      AIH_FOLDER_EVIDENCE: join(output, 'personal-folder-evidence') }
  });
  writeFileSync(join(output, 'browser-check.log'), `${browser.stdout ?? ''}${browser.stderr ?? ''}`);
  process.stdout.write(browser.stdout ?? ''); process.stderr.write(browser.stderr ?? '');
  if (browser.error) throw browser.error;
  process.exitCode = browser.status ?? 1;
}
if (process.exitCode === 0) {
  // The reviewed-batch journey runs several fresh Core prepares and applies, in a disposable account home, so this stage takes longer.
  const integrated = spawnSync(process.execPath, [join(repo, 'tools/check-integrated-workbench.mjs'), output], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 300_000, env: isolated,
  });
  writeFileSync(join(output, 'prototype-check.log'), `${integrated.stdout ?? ''}${integrated.stderr ?? ''}`);
  process.stdout.write(integrated.stdout ?? ''); process.stderr.write(integrated.stderr ?? '');
  if (integrated.error) throw integrated.error;
  process.exitCode = integrated.status ?? 1;
}
if (process.exitCode === 0) {
  const authority = spawnSync(process.execPath, [join(repo, 'tools/check-authority-source.mjs'), output, join(output, 'authority-source-evidence')], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000, env: isolated,
  });
  writeFileSync(join(output, 'authority-source-check.log'), `${authority.stdout ?? ''}${authority.stderr ?? ''}`);
  process.stdout.write(authority.stdout ?? ''); process.stderr.write(authority.stderr ?? '');
  if (authority.error) throw authority.error;
  process.exitCode = authority.status ?? 1;
}
if (process.exitCode === 0) {
  // The V9 report presentation: Core equivalence, the offline tool and the visual check with screenshots.
  const report = spawnSync(process.execPath, [join(repo, 'tools/check-report.mjs'), output, join(output, 'report-evidence')], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000,
    env: { ...isolated, PLAYWRIGHT_MODULE: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href },
  });
  writeFileSync(join(output, 'report-check.log'), `${report.stdout ?? ''}${report.stderr ?? ''}`);
  process.stdout.write(report.stdout ?? ''); process.stderr.write(report.stderr ?? '');
  if (report.error) throw report.error;
  process.exitCode = report.status ?? 1;
}
if (process.exitCode === 0) {
  const unit = spawnSync(process.execPath, ['--test', ...readdirSync(join(repo, 'tools/tests')).filter(name => name.endsWith('.test.mjs')).map(name => join(repo, 'tools/tests', name))], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 120_000, env: isolated,
  });
  writeFileSync(join(output, 'presentation-checks.log'), `${unit.stdout ?? ''}${unit.stderr ?? ''}`);
  process.stdout.write(unit.stdout ?? ''); process.stderr.write(unit.stderr ?? '');
  if (unit.error) throw unit.error;
  process.exitCode = unit.status ?? 1;
}

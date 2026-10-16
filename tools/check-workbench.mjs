// Exercise the ordinary server against explicitly reviewed, installed archives.
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installConsumer, resolvePackage } from './packages.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'aih-workbench-check-'));
const packages = ['core', 'catalog', 'scan'].map(name => {
  const supplied = process.env[`${name.toUpperCase()}_TGZ`];
  if (!supplied) throw new Error(`Set ${name.toUpperCase()}_TGZ to a reviewed packed artifact.`);
  return resolvePackage({ name, supplied, log: console.log });
});
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer'))
  .map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
for (const name of ['consumer.html', 'consumer.js', 'intent.html', 'intent.js', 'authoring.html', 'authoring.js', 'policy-file.js', 'app/claims-view.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, 'src/styles', name);
for (const name of readdirSync(join(repo, 'schemas'))) extraFiles[`schemas/${name}`] = join(repo, 'schemas', name);
// npm run exports user allow-scripts as an environment option. npm rejects that
// option for nested project installs; this isolated install always ignores scripts.
for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete process.env[key];
installConsumer({ consumerDir: output, packages, extraFiles, log: console.log });
writeFileSync(join(output, 'reviewed-packages.json'), JSON.stringify(packages, null, 2) + '\n');
const tests = ['ordinary-families', 'authoring-page', 'authoring-v3', 'personal-folder', 'journey', 'maintenance', 'readiness', 'readiness-host', 'claims', 'authority-source'];
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => join(output, `consumer/${name}.test.mjs`))], {
  cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 20_000_000, timeout: 120_000
});
writeFileSync(join(output, 'checks.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`);
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) {
  const browser = spawnSync(process.execPath, [join(output, 'consumer/personal-folder-browser.mjs')], {
    cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000,
    env: { ...process.env, PLAYWRIGHT_MODULE: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href,
      AIH_FOLDER_EVIDENCE: join(output, 'personal-folder-evidence') }
  });
  writeFileSync(join(output, 'browser-check.log'), `${browser.stdout ?? ''}${browser.stderr ?? ''}`);
  process.stdout.write(browser.stdout ?? ''); process.stderr.write(browser.stderr ?? '');
  if (browser.error) throw browser.error;
  process.exitCode = browser.status ?? 1;
}
if (process.exitCode === 0) {
  const integrated = spawnSync(process.execPath, [join(repo, 'tools/check-integrated-workbench.mjs'), output], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000,
  });
  writeFileSync(join(output, 'prototype-check.log'), `${integrated.stdout ?? ''}${integrated.stderr ?? ''}`);
  process.stdout.write(integrated.stdout ?? ''); process.stderr.write(integrated.stderr ?? '');
  if (integrated.error) throw integrated.error;
  process.exitCode = integrated.status ?? 1;
}
if (process.exitCode === 0) {
  const authority = spawnSync(process.execPath, [join(repo, 'tools/check-authority-source.mjs'), output, join(output, 'authority-source-evidence')], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 180_000,
  });
  writeFileSync(join(output, 'authority-source-check.log'), `${authority.stdout ?? ''}${authority.stderr ?? ''}`);
  process.stdout.write(authority.stdout ?? ''); process.stderr.write(authority.stderr ?? '');
  if (authority.error) throw authority.error;
  process.exitCode = authority.status ?? 1;
}
if (process.exitCode === 0) {
  const unit = spawnSync(process.execPath, ['--test', ...readdirSync(join(repo, 'tools/tests')).filter(name => name.endsWith('.test.mjs')).map(name => join(repo, 'tools/tests', name))], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 5_000_000, timeout: 120_000,
  });
  writeFileSync(join(output, 'presentation-checks.log'), `${unit.stdout ?? ''}${unit.stderr ?? ''}`);
  process.stdout.write(unit.stdout ?? ''); process.stderr.write(unit.stderr ?? '');
  if (unit.error) throw unit.error;
  process.exitCode = unit.status ?? 1;
}

// Exercise the ordinary server against explicitly reviewed, installed archives.
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
for (const name of ['authoring.html', 'authoring.js', 'policy-file.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
// npm run exports user allow-scripts as an environment option. npm rejects that
// option for nested project installs; this isolated install always ignores scripts.
for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete process.env[key];
installConsumer({ consumerDir: output, packages, extraFiles, log: console.log });
writeFileSync(join(output, 'reviewed-packages.json'), JSON.stringify(packages, null, 2) + '\n');
const tests = ['ordinary-families', 'authoring-page', 'authoring-v3'];
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => join(output, `consumer/${name}.test.mjs`))], {
  cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 20_000_000, timeout: 120_000
});
writeFileSync(join(output, 'checks.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`);
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

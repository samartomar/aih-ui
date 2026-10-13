// Reproducible functional proof through installed public artifacts. No execution.
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { installConsumer, resolvePackage } from './packages.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(repo, '.tmp/functional-scale'));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 15) throw new Error('Use supported Node 24.15–24.x explicitly.');
if (!process.env.REVIEW_EVIDENCE_FILE || !process.env.PLAYWRIGHT_MODULE) throw new Error('Set REVIEW_EVIDENCE_FILE and PLAYWRIGHT_MODULE; see docs/functional-scale.md.');
if (existsSync(output) && readdirSync(output).length) throw new Error('Use a new empty output directory; preserve previous receipts.');
mkdirSync(output, { recursive: true });
const consumerDir = join(output, 'consumer');
const packages = ['core', 'catalog', 'scan'].map(name => {
  const supplied = process.env[`${name.toUpperCase()}_TGZ`];
  if (!supplied) throw new Error(`Set ${name.toUpperCase()}_TGZ to an exact reviewed archive.`);
  return resolvePackage({ name, supplied, log: console.log });
});
function run(args, cwd, logName) {
  const result = spawnSync(process.execPath, args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 32_000_000 });
  writeFileSync(join(output, logName), (result.stdout ?? '') + '\n' + (result.stderr ?? ''));
  if (result.error || result.status !== 0) throw new Error(`${logName}: ${result.error?.message ?? `exit ${result.status}`}`);
  if (logName !== 'pack.log') process.stdout.write(result.stdout ?? '');
  return result.stdout;
}
const npm = process.env.npm_execpath;
if (!npm || !/\.[cm]?js$/.test(npm)) throw new Error('Set npm_execpath to npm-cli.js for this Node runtime.');
const packed = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], repo, 'pack.log'))[0];
const uiArchive = join(output, packed.filename);
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer')).map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
for (const name of ['consumer.html', 'consumer.js', 'intent.html', 'intent.js', 'authoring.html', 'authoring.js', 'policy-file.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, 'src/styles', name);
installConsumer({ consumerDir, packages, extraFiles, log: console.log });
run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', uiArchive], consumerDir, 'install-ui.log');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const consumerBasis = Object.fromEntries(readdirSync(join(repo, 'tools/consumer')).filter(name => name.endsWith('.mjs')).map(name => {
  const installed = join(consumerDir, 'node_modules/aih-ui/tools/consumer', name);
  if (hash(join(repo, 'tools/consumer', name)) !== hash(installed)) throw new Error(`Installed UI differs: ${name}`);
  return [name, hash(installed)];
}));
writeFileSync(join(output, 'packages.json'), JSON.stringify({ node: process.version, packages, uiArchive, uiSha256: hash(uiArchive), consumerBasis }, null, 2) + '\n');
run(['--test', ...['authoring-v3.test.mjs', 'authoring-page.test.mjs', 'saved-intent.test.mjs'].map(name => join(consumerDir, 'consumer', name))], consumerDir, 'focused-regressions.log');
run([join(consumerDir, 'consumer/prove-functional-scale.mjs'), join(output, 'results')], consumerDir, 'functional-run.log');
console.log(JSON.stringify({ status: 'passed', output, consumerDir }));

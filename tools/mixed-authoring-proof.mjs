import { readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { installConsumer, resolvePackage } from './packages.mjs';
import { noteFixture, NOTE_SOURCE_REVISION } from './consumer/note-fixture.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceStatus = () => spawnSync('git', ['status', '--porcelain'], { cwd: repo, windowsHide: true, encoding: 'utf8' }).stdout.trim();
if (sourceStatus()) throw new Error('Qualify a clean committed source tree.');
const fixtureHashes = {};
for (const variant of ['current', 'updated', 'additional']) for (const source of (await noteFixture(variant)).sourceFiles) for (const [path, bytes] of Object.entries(source.files)) {
  const blob = spawnSync('git', ['show', `${NOTE_SOURCE_REVISION}:${path}`], { cwd: repo, windowsHide: true });
  if (blob.status || !Buffer.from(bytes).equals(blob.stdout)) throw new Error(`Fixture differs from committed source: ${path}`);
  fixtureHashes[path] = createHash('sha256').update(bytes).digest('hex');
}
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
function run(args, cwd = repo) {
  const result = spawnSync(process.execPath, args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 20_000_000 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.error || result.status) throw new Error(`Check failed: ${result.error?.message ?? result.status}`);
}
const packages = ['core', 'catalog', 'scan'].map(name => resolvePackage({ name, supplied: process.env[`${name.toUpperCase()}_TGZ`], log: console.log }));
const consumerDir = join(output, 'consumer');
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer')).map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
for (const name of ['consumer', 'intent', 'authoring']) for (const ext of ['html', 'js']) extraFiles[`page/${name}.${ext}`] = join(repo, `src/${name}.${ext}`);
extraFiles['page/policy-file.js'] = join(repo, 'src/policy-file.js');
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, `src/styles/${name}`);
installConsumer({ consumerDir, packages, extraFiles, log: console.log });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Set npm_execpath to the Node24 npm-cli.js.');
run([npm, 'pack', '--ignore-scripts', '--pack-destination', output]);
const archive = join(output, readdirSync(output).find(name => name.startsWith('aih-ui-') && name.endsWith('.tgz')));
run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumerDir);
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true, encoding: 'utf8' }).stdout.trim();
writeFileSync(join(output, 'packages.json'), JSON.stringify({ head, packages, uiArchive: archive, uiSha256: createHash('sha256').update(readFileSync(archive)).digest('hex') }, null, 2) + '\n');
const moduleHashes = Object.fromEntries(['headless.mjs', 'intake.mjs', 'intent-shape.mjs', 'migrate-intent.mjs', 'mixed-service.mjs', 'primitives.mjs', 'review-bindings.mjs', 'review-host.mjs'].map(name => {
  const source = readFileSync(join(repo, 'tools/consumer', name));
  const installed = readFileSync(join(consumerDir, 'node_modules/aih-ui/tools/consumer', name));
  if (!source.equals(installed)) throw new Error(`Installed UI module differs: ${name}`);
  return [name, createHash('sha256').update(installed).digest('hex')];
}));
writeFileSync(join(output, 'installed-module-hashes.json'), JSON.stringify(moduleHashes, null, 2) + '\n');
writeFileSync(join(output, 'source-snapshot.json'), JSON.stringify({ repository: 'samartomar/aih-ui', revision: NOTE_SOURCE_REVISION, files: fixtureHashes }, null, 2) + '\n');
run(['--test', ...readdirSync(join(consumerDir, 'consumer')).filter(name => name.endsWith('.test.mjs')).map(name => join(consumerDir, 'consumer', name))], consumerDir);
run([join(consumerDir, 'consumer/prove-mixed-authoring.mjs'), output], consumerDir);
run([join(consumerDir, 'consumer/prove-reviews.mjs'), output], consumerDir);
if (sourceStatus()) throw new Error('Qualification changed the committed source tree.');

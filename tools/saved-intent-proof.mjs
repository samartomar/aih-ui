// Reproduce against explicit reviewed public archives in an isolated consumer.
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { installConsumer, resolvePackage } from './packages.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'aih-saved-intent-proof-')));
mkdirSync(output, { recursive: true });
const consumerDir = join(output, 'consumer');
const packages = ['core', 'catalog', 'scan'].map(name => {
  const supplied = process.env[`${name.toUpperCase()}_TGZ`];
  if (!supplied) throw new Error(`Set ${name.toUpperCase()}_TGZ to a reviewed packed artifact.`);
  return resolvePackage({ name, supplied, log: console.log });
});
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer')).map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
for (const name of ['consumer.html', 'consumer.js', 'intent.html', 'intent.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, 'src/styles', name);
installConsumer({ consumerDir, packages, extraFiles, log: console.log });
writeFileSync(join(output, 'packages.json'), JSON.stringify(packages, null, 2) + '\n');
for (const args of [ ['--test', ...readdirSync(join(consumerDir, 'consumer')).filter(name => name.endsWith('.test.mjs')).map(name => join(consumerDir, 'consumer', name))],
  [join(consumerDir, 'consumer/prove-saved-intent.mjs'), join(output, 'results')] ]) {
  const result = spawnSync(process.execPath, args, { cwd: consumerDir, windowsHide: true, encoding: 'utf8' });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.error || result.status !== 0) throw new Error(`Proof failed: ${result.error?.message ?? result.status}`);
}
console.log(JSON.stringify({ consumerDir, output, page: 'http://127.0.0.1:4821/intent' }));
if (process.argv.includes('--serve')) {
  const child = spawn(process.execPath, [join(consumerDir, 'consumer/server.mjs')], { cwd: consumerDir, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, AIH_CONSUMER_PORT: process.env.AIH_CONSUMER_PORT ?? '4821', AIH_CONSUMER_PACKAGES: JSON.stringify(packages.map(({ name, sha256 }) => ({ name, sha256 }))) } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
  child.on('exit', code => process.exitCode = code ?? 1);
}

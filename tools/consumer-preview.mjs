// Installs explicit public package artifacts; never imports sibling source.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { installConsumer, resolvePackage } from './packages.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerDir = mkdtempSync(join(tmpdir(), 'aih-ui-consumer-'));
const packages = ['core', 'catalog', 'scan'].map(name => {
  const supplied = process.env[`${name.toUpperCase()}_TGZ`];
  if (!supplied) throw new Error(`Set ${name.toUpperCase()}_TGZ to a reviewed packed artifact.`);
  return resolvePackage({ name, supplied, log: console.log });
});
const extraFiles = Object.fromEntries(readdirSync(join(repo, 'tools/consumer'))
  .map(name => [`consumer/${name}`, join(repo, 'tools/consumer', name)]));
for (const name of ['consumer.html', 'consumer.js', 'intent.html', 'intent.js', 'authoring.html', 'authoring.js', 'policy-file.js']) extraFiles[`page/${name}`] = join(repo, 'src', name);
for (const name of ['consumer.css', 'tokens.css']) extraFiles[`page/${name}`] = join(repo, 'src/styles', name);
installConsumer({ consumerDir, packages, extraFiles, log: console.log });
console.log(JSON.stringify({ consumerDir, packages }, null, 2));
const child = spawn(process.execPath, [join(consumerDir, 'consumer/server.mjs')], {
  cwd: consumerDir, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, AIH_CONSUMER_PACKAGES: JSON.stringify(packages.map(({name,sha256}) => ({name,sha256}))) }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', code => process.exitCode = code ?? 1);

// Core, Catalog and Scan are optional peers, so a plain checkout has none of them: a check run from the checkout reads
// them only through the packed consumer it is given (an import of a path under it, or createRequire on a file in it),
// never by an import, require or resolve the checkout itself must satisfy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const quoted = String.raw`\s*['"\x60]([^'"\x60]+)['"\x60]`;
const forms = [
  new RegExp(String.raw`^\s*(?:import|export)\s[^'"]*?from` + quoted, 'gm'), // import … from '…', export … from '…'
  new RegExp(String.raw`^\s*import` + quoted, 'gm'), // import '…'
  new RegExp(String.raw`\bimport\s*\(` + quoted, 'g'), // import('…')
  new RegExp(String.raw`(?<![.\w])require(?:\.resolve)?\s*\(` + quoted, 'g'), // require('…'), require.resolve('…')
  new RegExp(String.raw`\bimport\.meta\.resolve\s*\(` + quoted, 'g'), // import.meta.resolve('…')
];
// What a module asks the checkout's own resolver for. A require built on the checkout (createRequire(import.meta.url))
// may load the checkout's own dependencies, as build-css loads Tailwind, but a module that builds one names no peer at all.
const specifiers = source => forms.flatMap(form => [...source.matchAll(form)].map(match => match[1]));
const checkoutRequire = /createRequire\s*\(\s*import\.meta\.url\s*\)/, peerName = /['"\x60]@aihq\//;

export function peerReaches(entry, root) {
  const seen = new Set(), found = [];
  const name = path => relative(root, path).replace(/\\/g, '/');
  (function walk(file, chain) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8'), here = [...chain, name(file)].join(' > ');
    if (checkoutRequire.test(source) && peerName.test(source)) found.push(`${here} calls createRequire(import.meta.url) and names a peer`);
    for (const specifier of specifiers(source)) {
      if (specifier.startsWith('@aihq/')) found.push(`${here} imports ${specifier}`);
      else if (specifier.startsWith('.')) { const next = resolve(dirname(file), specifier); if (existsSync(next)) walk(next, [...chain, name(file)]); }
    }
  })(entry, []);
  return found;
}

test('no check run from the checkout imports, requires or resolves Core, Catalog or Scan', () => {
  const checks = readdirSync(join(repo, 'tools')).filter(name => /^check-.*\.mjs$/.test(name));
  assert.ok(checks.includes('check-installed-truth.mjs'));
  assert.deepEqual(checks.flatMap(name => peerReaches(join(repo, 'tools', name), repo)), []);
});

test('a dynamic import, a required peer and a require on the checkout are each refused; a require on the consumer is not', t => {
  const root = mkdtempSync(join(tmpdir(), 'aih-optional-peers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'uses-core.mjs'), "import { listTools } from '@aihq/core/harness';\nexport const tools = listTools;\n");
  const check = (name, body) => { writeFileSync(join(root, name), body); return peerReaches(join(root, name), root); };
  assert.deepEqual(check('check-dynamic-edge.mjs', "const { tools } = await import('./uses-core.mjs');\n"),
    ['check-dynamic-edge.mjs > uses-core.mjs imports @aihq/core/harness']);
  assert.deepEqual(check('check-dynamic-peer.mjs', "await import('@aihq/core');\n"), ['check-dynamic-peer.mjs imports @aihq/core']);
  assert.deepEqual(check('check-checkout-require.mjs', "import { createRequire } from 'node:module';\nconst catalog = createRequire(import.meta.url)('@aihq/catalog');\n"),
    ['check-checkout-require.mjs calls createRequire(import.meta.url) and names a peer']);
  assert.deepEqual(check('check-require.mjs', "const r = require('@aihq/scan'); require.resolve('./uses-core.mjs');\nimport.meta.resolve('@aihq/catalog/package.json');\n"),
    ['check-require.mjs imports @aihq/scan', 'check-require.mjs > uses-core.mjs imports @aihq/core/harness', 'check-require.mjs imports @aihq/catalog/package.json']);
  assert.deepEqual(check('check-bound-require.mjs', "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nconst catalog = load('@aihq/catalog');\n"),
    ['check-bound-require.mjs calls createRequire(import.meta.url) and names a peer']);
  assert.deepEqual(check('check-own-dependency.mjs', "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconst postcss = require('postcss');\n"), []);
  assert.deepEqual(check('check-consumer-require.mjs', "import { createRequire } from 'node:module';\nimport { join } from 'node:path';\nconst consumerDir = process.argv[2];\n"
    + "const root = createRequire(join(consumerDir, 'package.json')).resolve('@aihq/catalog/package.json');\n"), []);
});

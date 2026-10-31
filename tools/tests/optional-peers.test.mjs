// Core, Catalog and Scan are optional peers, so a plain checkout has none of them: a check run from the checkout reads
// them only through the packed consumer it is given, never by a static import the checkout itself must resolve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const staticImports = source => [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map(match => match[1] ?? match[2]);

function peerImports(file, seen = new Set(), chain = []) {
  if (seen.has(file)) return [];
  seen.add(file);
  return staticImports(readFileSync(file, 'utf8')).flatMap(specifier => {
    if (specifier.startsWith('@aihq/')) return [[...chain, file].map(path => relative(repo, path).replace(/\\/g, '/')).join(' > ') + ` imports ${specifier}`];
    const next = specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined;
    return next && existsSync(next) ? peerImports(next, seen, [...chain, file]) : [];
  });
}

test('no check run from the checkout statically imports Core, Catalog or Scan', () => {
  const checks = readdirSync(join(repo, 'tools')).filter(name => /^check-.*\.mjs$/.test(name));
  assert.ok(checks.includes('check-installed-truth.mjs'));
  assert.deepEqual(checks.flatMap(name => peerImports(join(repo, 'tools', name))), []);
});

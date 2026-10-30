// The UI archive the owner-testing candidate installs (`npm pack`): the runtime and its documents, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNpmCli } from '../candidate/upgrade.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tracked = spawnSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const built = join(repo, 'src', 'styles', 'tailwind.css');

function packedFiles(t) {
  // A local CSS build is never shipped: start builds it in the installed UI, and the archive check compares installed bytes.
  if (!existsSync(built)) { writeFileSync(built, '/* local build */\n'); t.after(() => rmSync(built, { force: true })); }
  const result = spawnSync(process.execPath, [findNpmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0].files.map(file => file.path);
}

test('the archive leaves out tests, scratch, notes, repository tooling and the local CSS build', t => {
  const files = packedFiles(t);
  const out = files.filter(path => /(^|\/)tests\/|\.test\.mjs$|^\.ua\/|^\.git|^\.serena\/|^\.claude\/|^TODO|overnight|^docs\/agents\/|^prototype\/|^aih-policy-workbench\.html$|^AGENTS\.md$|^CLAUDE\.md$|^GLOSSARY\.md$/.test(path));
  assert.deepEqual(out, []);
  assert.equal(files.includes('src/styles/tailwind.css'), false);
});

test('the archive carries the runtime: the page, the candidate, the preview, the service, the exports and the notices', t => {
  const files = new Set(packedFiles(t));
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const runtimeDirs = ['src/', 'schemas/', 'fixtures/contracts/', 'tools/candidate/', 'tools/consumer/', 'tools/server/', 'tools/service/'];
  const expected = [
    'package.json', 'README.md', 'tailwind.config.cjs', 'package-support-1.1.json', 'tools/consumer/LICENSE', 'tools/consumer/NOTICE',
    'tools/candidate.mjs', 'tools/preview.mjs', 'tools/build-css.mjs', 'tools/packages.mjs', 'tools/consumer-preview.mjs', 'tools/check-complete-candidate.mjs',
    ...tracked.filter(path => runtimeDirs.some(dir => path.startsWith(dir)) && !path.endsWith('.test.mjs')),
    ...Object.values(pkg.exports).filter(target => !target.includes('*')).map(target => posix.normalize(target)),
  ];
  assert.deepEqual(expected.filter(path => !files.has(path)), []);
});

test('every relative import in a packed module resolves to a packed file', t => {
  const files = new Set(packedFiles(t));
  const missing = [];
  for (const file of [...files].filter(path => /\.(mjs|js)$/.test(path))) {
    const source = readFileSync(join(repo, file), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!files.has(target)) missing.push(`${file} -> ${specifier}`);
    }
  }
  assert.deepEqual(missing, []);
});

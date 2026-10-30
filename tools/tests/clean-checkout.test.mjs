// The installed-candidate check packs a checkout and records its commit, so the checkout must be exactly that commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCheckout } from '../clean-checkout.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (cwd, ...args) => { const result = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };

function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-clean-checkout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  writeFileSync(join(root, 'package.json'), '{"name":"aih-ui","version":"0.0.0"}\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
  return root;
}

test('a clean checkout reports its commit and treeClean; ignored files do not count', t => {
  const root = checkout(t);
  mkdirSync(join(root, 'node_modules')); writeFileSync(join(root, 'node_modules', 'x.js'), '');
  assert.deepEqual(cleanCheckout(root), { commit: git(root, 'rev-parse', 'HEAD'), treeClean: true });
});

test('an untracked file, even inside a new directory, or an uncommitted edit is refused, naming the paths', t => {
  const root = checkout(t);
  mkdirSync(join(root, 'src', 'deep'), { recursive: true }); writeFileSync(join(root, 'src', 'deep', 'new.js'), '');
  assert.throws(() => cleanCheckout(root), /not clean.*src\/deep\/new\.js/s);
  rmSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"aih-ui","version":"0.0.1"}\n');
  assert.throws(() => cleanCheckout(root), /not clean.*package\.json/s);
});

test('a folder that is not a Git checkout is refused', t => {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-not-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => cleanCheckout(root), /not a Git checkout/);
});

test('check-candidate-install refuses a dirty --checkout before it creates or packs anything', t => {
  const root = checkout(t);
  writeFileSync(join(root, 'stray.txt'), 'uncommitted');
  const output = join(mkdtempSync(join(tmpdir(), 'aih-ui-check-out-')), 'out');
  t.after(() => rmSync(dirname(output), { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(repo, 'tools', 'check-candidate-install.mjs'), join(root, 'packs.json'), output, '--checkout', root], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not clean.*stray\.txt/s);
  assert.equal(existsSync(output), false, 'nothing was created');
});

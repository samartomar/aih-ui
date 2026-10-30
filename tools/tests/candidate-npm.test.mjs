import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findNpmCli } from '../candidate/upgrade.mjs';

// A fake filesystem: `files` exist; `links` map a PATH entry to the file it resolves to.
const fake = (files, links = {}) => ({ exists: path => files.includes(path) || path in links, realpath: path => links[path] ?? path });

test('npm_execpath wins when it names an npm-cli.js that exists', () => {
  const cli = '/opt/npm/bin/npm-cli.js';
  assert.equal(findNpmCli({ env: { npm_execpath: cli, PATH: '/usr/bin' }, execPath: '/usr/bin/node', platform: 'linux', ...fake([cli, '/usr/lib/node_modules/npm/bin/npm-cli.js']) }), cli);
});

test('an npm_execpath that is not npm (another package manager) or is missing is passed over', () => {
  const layout = '/usr/lib/node_modules/npm/bin/npm-cli.js';
  for (const npm_execpath of ['/opt/pnpm/bin/pnpm.cjs', '/gone/npm-cli.js']) {
    assert.equal(findNpmCli({ env: { npm_execpath }, execPath: '/usr/bin/node', platform: 'linux', ...fake(['/opt/pnpm/bin/pnpm.cjs', layout]) }), layout, npm_execpath);
  }
});

test('Linux and macOS: npm on PATH is followed through its link to npm-cli.js', () => {
  const cli = '/home/u/.nvm/versions/node/v26.12.1/lib/node_modules/npm/bin/npm-cli.js';
  for (const platform of ['linux', 'darwin']) {
    assert.equal(findNpmCli({ env: { PATH: '/nothing:/home/u/.nvm/versions/node/v26.12.1/bin' }, execPath: '/elsewhere/bin/node', platform,
      ...fake([cli], { '/home/u/.nvm/versions/node/v26.12.1/bin/npm': cli }) }), cli, platform);
  }
});

test('Linux and macOS: an npm on PATH that is a launcher, not a link, finds npm-cli.js in the lib layout beside it', () => {
  const cli = '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js';
  assert.equal(findNpmCli({ env: { PATH: '/opt/homebrew/bin' }, execPath: '/x/node', platform: 'darwin', ...fake(['/opt/homebrew/bin/npm', cli]) }), cli);
});

test('Windows: npm.cmd on Path finds node_modules\\npm beside it', () => {
  const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  assert.equal(findNpmCli({ env: { Path: 'C:\\Windows;C:\\Program Files\\nodejs' }, execPath: 'D:\\other\\node.exe', platform: 'win32',
    ...fake(['C:\\Program Files\\nodejs\\npm.cmd', cli]) }), cli);
});

test('without npm_execpath or npm on PATH, the platform layout beside node is used', () => {
  assert.equal(findNpmCli({ env: {}, execPath: '/usr/local/bin/node', platform: 'linux', ...fake(['/usr/local/lib/node_modules/npm/bin/npm-cli.js']) }),
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js');
  assert.equal(findNpmCli({ env: {}, execPath: 'C:\\nodejs\\node.exe', platform: 'win32', ...fake(['C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']) }),
    'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js');
});

test('no npm anywhere is refused, naming each place looked', () => {
  assert.throws(() => findNpmCli({ env: { PATH: '/usr/bin' }, execPath: '/usr/bin/node', platform: 'linux', ...fake([]) }),
    /npm_execpath.*PATH.*\/usr\/lib\/node_modules\/npm\/bin\/npm-cli\.js/s);
});

test('on this machine, plain node with no npm_execpath finds a real npm-cli.js', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'));
  const script = `import { findNpmCli } from ${JSON.stringify(pathToFileURL(resolve('tools/candidate/upgrade.mjs')).href)}; process.stdout.write(findNpmCli());`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm-cli\.js$/);
  assert.ok(existsSync(result.stdout));
});

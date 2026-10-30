#!/usr/bin/env node
// The owner-testing candidate as the README documents it, end to end from a clean folder: pack this checkout, preflight and
// upgrade a manifest that pins that UI archive with real Core, Catalog and Scan packs and the journey's prepared frameworks
// (which installs, starts and smoke-checks the installed UI), then open the page and use it with a real pointer.
//
// Usage: node tools/check-candidate-install.mjs <packs.json> <new-output-directory> [--port 4894] [--checkout <dir>]
//   --checkout packs and runs another checkout of this repository (for example an older commit) instead of this one.
//   packs.json: { "core": { "tarball", "commit" }, "catalog": { ... }, "scan": { ... } }, tarballs relative to the file.
// The output directory must be new or empty and outside every Git workspace (the candidate's own rule). The npm packs, the
// manifest, the data directory, screenshots and receipt.json are kept there. The checkout must be clean (no edit and no untracked
// file; tools/clean-checkout.mjs) before and after packing, so the archive is its commit; the receipt records commit and treeClean. Every command runs as plain `node`, without
// npm_execpath, as the owner would type it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSupportedNode, findNpmCli } from './candidate/upgrade.mjs';
import { cleanCheckout } from './clean-checkout.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const port = Number(option('--port') ?? 4894);
const repo = resolve(option('--checkout') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const [packsPath, outputPath] = args.filter((value, index, all) => !['--port', '--checkout'].includes(value) && !['--port', '--checkout'].includes(all[index - 1]));
if (!packsPath || !outputPath) throw new Error('usage: node tools/check-candidate-install.mjs <packs.json> <new-output-directory> [--port 4894] [--checkout <dir>]');
assertSupportedNode(process.versions.node);
// The archive is packed from the checkout's files and recorded as its commit, so the two must be the same bytes.
const checkout = cleanCheckout(repo);
const output = resolve(outputPath);
if (existsSync(output) && readdirSync(output).length) throw new Error(`${output} must be new or empty.`);
const packsDir = join(output, 'packs'), data = join(output, 'data'), shots = join(output, 'screenshots');
mkdirSync(packsDir, { recursive: true }); mkdirSync(shots, { recursive: true });
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const say = message => process.stdout.write(`${new Date().toISOString()} ${message}\n`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath' && !key.toUpperCase().startsWith('AIH_')));
const run = (command, commandArgs, cwd = output) => {
  say(`$ ${[basename(command), ...commandArgs].join(' ')}`);
  const result = spawnSync(command, commandArgs, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 1_200_000 });
  writeFileSync(join(output, `${basename(commandArgs[1] ?? commandArgs[0])}-${commandArgs.find(value => ['pack', 'preflight', 'upgrade', 'stop', 'status'].includes(value)) ?? 'run'}.log`), `${result.stdout}\n${result.stderr}`);
  if (result.error || result.status !== 0) throw new Error(`${commandArgs.join(' ')} failed (${result.error?.message ?? result.status}):\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-3000)}`);
  return result.stdout;
};
const receipt = { node: process.versions.node, port, checkout: repo, commit: checkout.commit, treeClean: checkout.treeClean, steps: [], findings: [] };
const step = (name, detail = {}) => { receipt.steps.push({ name, at: new Date().toISOString(), ...detail }); say(`ok: ${name}`); };

// 1. The UI archive, packed from this checkout, with only what its "files" list ships.
const packed = JSON.parse(run(process.execPath, [findNpmCli({ env }), 'pack', '--json', '--pack-destination', packsDir], repo))[0];
const packedFiles = packed.files.map(file => file.path).sort();
writeFileSync(join(output, 'packed-files.txt'), `${packedFiles.join('\n')}\n`);
const stray = packedFiles.filter(path => /(^|\/)tests\/|\.test\.mjs$|^\.ua\/|^\.git|^\.serena\/|^TODO|overnight/.test(path));
// Recorded, not thrown, so the documented commands still run and report their own state; the check fails at the end.
if (stray.length) receipt.findings.push(`the UI archive carries ${stray.length} test, scratch, note or repository-tooling files, such as ${stray.slice(0, 5).join(', ')}`);
if (packedFiles.includes('src/styles/tailwind.css')) receipt.findings.push('the UI archive carries a local Tailwind build; start builds it in the installed UI');
cleanCheckout(repo);
step('pack', { tarball: packed.filename, entries: packed.entryCount, bytes: packed.size });

// 2. The manifest the README describes, with the frameworks the journey uses.
const packs = JSON.parse(readFileSync(resolve(packsPath), 'utf8'));
const entry = name => { const source = resolve(dirname(resolve(packsPath)), packs[name].tarball), target = join(packsDir, basename(source)); copyFileSync(source, target); return { tarball: basename(target), sha256: sha(target), commit: packs[name].commit }; };
const { commit } = checkout;
const manifest = { schema: 'urn:aih-ui:candidate-manifest:1.0.0', candidate: `aih-ui ${commit.slice(0, 8)} installed-candidate check`,
  ui: { tarball: packed.filename, sha256: sha(join(packsDir, packed.filename)), commit },
  packages: { core: entry('core'), catalog: entry('catalog'), scan: entry('scan') },
  preparedFrameworks: ['extensions', 'ecc', 'superpowers'] };
const manifestPath = join(packsDir, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
receipt.manifest = manifest;

// 3. The documented commands, from the checkout.
const candidate = join(repo, 'tools', 'candidate.mjs'), common = ['--manifest', manifestPath, '--data', data, '--port', String(port)];
let browser;
try {
  run(process.execPath, [candidate, 'preflight', ...common]);
  step('preflight');
  const upgraded = run(process.execPath, [candidate, 'upgrade', ...common]);
  const release = JSON.parse(upgraded.slice(upgraded.indexOf('{'))).release;
  const phases = JSON.parse(readFileSync(join(release, 'checkpoint.json'), 'utf8')).phases.map(value => value.phase);
  assert.ok(phases.includes('ready-and-browser-verified'), `upgrade started the installed UI and passed its smoke check (${phases.join(', ')})`);
  assert.ok(existsSync(join(release, 'node_modules', 'aih-ui', 'src', 'styles', 'tailwind.css')), 'the installed UI built its CSS at start');
  step('upgrade, start and smoke', { release, phases });
  const status = run(process.execPath, [candidate, 'status', '--data', data]);
  const origin = status.match(/url: (http:\/\/\S+?)\/?\s/)?.[1];
  assert.ok(origin, `status names the running URL:\n${status}`);

  // 4. The page, as the owner uses it.
  const { chromium } = await import(pathToFileURL(join(release, 'node_modules', 'playwright', 'index.mjs')).href);
  const { chooseCatalogFamily } = await import(pathToFileURL(join(release, 'node_modules', 'aih-ui', 'tools', 'consumer', 'policy-drawer.mjs')).href);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/`);
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let next = 0; next < 4; next++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  // A real pointer: the element is what is under its own centre, and the mouse presses there.
  // The set picker re-renders while a framework opens, so a node replaced under us is looked up again.
  const pointerClick = async (locator, label) => {
    for (let attempt = 1; ; attempt++) {
      try { await pointAndClick(locator, label); return; }
      catch (error) { if (attempt >= 5 || !/not attached|detached/i.test(error.message)) throw error; }
    }
  };
  const pointAndClick = async (locator, label) => {
    await locator.scrollIntoViewIfNeeded();
    const hit = await locator.evaluate(node => { const box = node.getBoundingClientRect(), at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return at === node || node.contains(at) ? 'self' : at ? `${at.tagName}#${at.id}.${String(at.className).slice(0, 60)}` : 'nothing'; });
    assert.equal(hit, 'self', `${label} is under the pointer at its centre`);
    const box = await locator.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  assert.equal(await page.locator('#catalog-workspace').evaluate(node => getComputedStyle(node).overflowY), 'auto', 'the page is styled: the catalog column scrolls');
  const rail = page.locator('#framework-navigation button[data-family]');
  await rail.first().waitFor();
  const frameworks = await rail.allInnerTexts();
  for (const name of [/ECC/, /Superpowers/, /Extensions/]) assert.ok(frameworks.some(text => name.test(text)), `the rail lists ${name}: ${frameworks.join(' | ')}`);
  assert.doesNotMatch(await page.locator('#nav-rail').innerText(), /No frameworks available/);
  step('frameworks listed', { frameworks });
  await page.screenshot({ path: join(shots, 'frameworks.png') });

  await chooseCatalogFamily(page, 'Superpowers');
  await page.locator('#starting-sets [data-set-id]').first().waitFor();
  const add = page.locator('#starting-sets [data-add-sets]');
  await add.waitFor();
  await pointerClick(add, 'Add chosen sets');
  await page.waitForFunction(() => document.getElementById('framework-guidance')?.textContent.includes('Chosen sets added'));
  const chosen = Number((await page.locator('#your-setup').innerText()).match(/\((\d+)\)/)?.[1] ?? 0);
  assert.ok(chosen > 0, 'the chosen sets reached Your setup');
  step('Add chosen sets takes a real pointer click', { chosen });
  await page.screenshot({ path: join(shots, 'sets-added.png') });

  const drawer = page.locator('#policy-review-panel');
  if (await drawer.isVisible()) await pointerClick(page.locator('#policy-back-to-catalog'), 'Back to catalog');
  await drawer.waitFor({ state: 'hidden' });
  await pointerClick(page.locator('#your-setup'), 'Your setup');
  await drawer.waitFor();
  await page.locator('#policy-review-panel-title').waitFor();
  assert.ok(await drawer.evaluate(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.top < innerHeight && box.left < innerWidth; }), 'the review drawer is on screen');
  await pointerClick(page.locator('#policy-back-to-catalog'), 'Back to catalog');
  await drawer.waitFor({ state: 'hidden' });
  step('Review (Your setup) reachable and closable by pointer');
  await page.screenshot({ path: join(shots, 'review-closed.png') });
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(receipt.findings, [], 'nothing was found wrong along the way');
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed'; receipt.error = error.message;
  if (receipt.findings.length) say(`also found: ${receipt.findings.join('; ')}`);
  throw error;
} finally {
  await browser?.close();
  try { run(process.execPath, [candidate, 'stop', '--data', data]); } catch (error) { receipt.stopError = error.message; }
  writeFileSync(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  say(`receipt: ${join(output, 'receipt.json')} (${receipt.status})`);
}

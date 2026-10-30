// The installed list, "Remove this set" and a namespaced rule's name against real Catalog sets, alone, after the packed
// consumer has been assembled (tools/check-workbench.mjs). check-installed-workbench.mjs runs the same three cases in
// both themes.
//
// Usage: node tools/check-installed-truth.mjs <consumerDir> [list|set-removal|namespaced-rule|update-one ...] [--theme dark|light]
//          [--update-pack <catalog.tgz>]
// Each case gets a fresh disposable project and a real child host process (tools/installed-host.mjs).
// update-one needs --update-pack: a Catalog pack of the installed package and version in which exactly one installed
// ECC TypeScript rule changed. It installs through the page, restarts the host on that pack, updates the one item and
// requires that only its files changed, with every selection's origins and configuration kept.
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { runInstalledListTruthBrowser, runNamespacedRuleTruthBrowser, runSetRemovalTruthBrowser, runUpdateOneBrowser, runUpdateOneInstallBrowser } from './consumer/installed-truth-browser.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The page's Tailwind build is ignored by Git, so a fresh checkout has none; without it the catalog column is no
// scroll container and its controls sit clipped under the panels, unreachable by a pointer.
await buildCss(repo);
const args = process.argv.slice(2);
const consumerDir = resolve(args[0]);
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : 'dark';
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const updatePack = option('--update-pack') && resolve(option('--update-pack'));
const named = args.slice(1).filter((value, index, all) => !value.startsWith('--') && !['--theme', '--update-pack'].includes(all[index - 1]));
const cases = { list: runInstalledListTruthBrowser, 'set-removal': runSetRemovalTruthBrowser, 'namespaced-rule': runNamespacedRuleTruthBrowser, 'update-one': runUpdateOne };
const selected = named.length ? named : Object.keys(cases).filter(name => name !== 'update-one' || updatePack);
for (const name of selected) if (!cases[name]) throw new Error(`Unknown case ${name}; choose from ${Object.keys(cases).join(', ')}.`);

const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const { frameworkFixtures } = await import(pathToFileURL(join(consumerDir, 'consumer/framework-fixtures.mjs')).href);
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const catalogArtifact = reviewed.find(entry => entry.name === 'catalog');
const fixtureDir = join(consumerDir, 'installed-truth-fixtures');
// The checked Extensions, ECC and Superpowers releases, through the same public sources route the other cases use.
const sources = join(fixtureDir, 'sources.json');
await writeFile(sources, JSON.stringify((await frameworkFixtures(fixtureDir, catalogArtifact)).scenarios.facts));

async function withHost(project, run, sourcesPath = sources, hostConsumerDir = consumerDir) {
  await mkdir(project, { recursive: true });
  const runDir = join(project, 'page');
  for (const asset of pageAssets(repo)) { const target = join(runDir, asset.to); await mkdir(dirname(target), { recursive: true }); await copyFile(join(repo, asset.from), target); }
  const summaryPath = join(runDir, 'summary.json'); await writeFile(summaryPath, JSON.stringify(summary));
  const portPath = join(project, 'host.port'), configPath = join(project, 'host-config.json');
  await writeFile(configPath, JSON.stringify({ consumerDir: hostConsumerDir, runDir, summaryPath, settingsPath: join(project, 'settings.json'), portPath,
    env: { AIH_CONSUMER_PROJECT: project, AIH_FRAMEWORK_SOURCES: sourcesPath } }));
  await rm(portPath, { force: true });
  const child = spawn(process.execPath, [join(repo, 'tools/installed-host.mjs'), configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; child.stdout.on('data', chunk => log.push(String(chunk))); child.stderr.on('data', chunk => log.push(String(chunk)));
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  try {
    let port;
    for (let attempt = 0; attempt < 300 && !port; attempt++) {
      if (child.exitCode !== null) throw new Error(`host exited before ready: ${log.join('').slice(-2000)}`);
      if (existsSync(portPath)) port = Number(readFileSync(portPath, 'utf8').trim()); else await new Promise(done => setTimeout(done, 100));
    }
    if (!port) throw new Error(`host did not start within 30s: ${log.join('').slice(-2000)}`);
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
  }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Every file of the project but the Workbench host's own (its page copy, port, configuration and setup store).
const HOST_FILES = new Set(['page', 'host.port', 'host-config.json', 'settings.json']);
async function treeHashes(root, prefix = '') {
  const hashes = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && HOST_FILES.has(entry.name)) continue;
    if (entry.isDirectory()) Object.assign(hashes, await treeHashes(root, path));
    else hashes[path] = sha256(readFileSync(join(root, path)));
  }
  return hashes;
}
// What a selection keeps across an update: the facts Core records for it, less its item hashes and states.
const kept = selection => JSON.stringify({ managementId: selection.managementId, scope: selection.scope, name: selection.name, kind: selection.kind, tool: selection.tool,
  framework: selection.framework, itemId: selection.item?.itemId, origins: selection.origins, approval: selection.approval, configuration: selection.configuration });

async function runUpdateOne({ project, output, playwrightModule, theme }) {
  if (!updatePack) return { status: 'incomplete', reason: 'update-one needs --update-pack <catalog.tgz>' };
  // Catalog's public reader, as the consumer installed it.
  const catalogManifest = createRequire(join(consumerDir, 'package.json')).resolve('@aihq/catalog/package.json');
  const nodeEntry = JSON.parse(readFileSync(catalogManifest, 'utf8')).exports['./node'].import;
  const { readInstalledPreparedContent } = await import(pathToFileURL(join(dirname(catalogManifest), nodeEntry)).href);
  // The Workbench restarted on the newer Catalog: the same consumer with only its installed Catalog package replaced.
  const updatedConsumer = join(consumerDir, 'update-one-consumer');
  await rm(updatedConsumer, { recursive: true, force: true }); await mkdir(updatedConsumer, { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'node_modules', 'consumer', 'service', 'workbench', 'schemas', 'page'])
    if (existsSync(join(consumerDir, name))) await cp(join(consumerDir, name), join(updatedConsumer, name), { recursive: true, verbatimSymlinks: true });
  const baseRoot = dirname(catalogManifest), newRoot = join(updatedConsumer, 'node_modules/@aihq/catalog');
  await rm(newRoot, { recursive: true, force: true }); await mkdir(newRoot, { recursive: true });
  execFileSync('tar', ['-xzf', updatePack, '-C', newRoot, '--strip-components=1'], { windowsHide: true });
  const base = JSON.parse(readFileSync(sources, 'utf8'));
  // Exactly one item changed between the two packs, read by Catalog's own reader.
  const frameworks = [...new Set(base.prepared.map(entry => entry.frameworkId))];
  const identities = async root => Object.fromEntries((await Promise.all(frameworks.map(async frameworkId => {
    const read = await readInstalledPreparedContent({ root, frameworkId, sourceInput: `update-one-${frameworkId}` });
    if (!read.valid) throw new Error(`Catalog refused ${frameworkId} at ${root}: ${JSON.stringify(read.diagnostics).slice(0, 400)}`);
    return read.release.items.map(item => [`${frameworkId}:${item.id}`, `${item.contentSha256}/${item.behaviourSha256}`]);
  }))).flat());
  const before = await identities(baseRoot), after = await identities(newRoot);
  if (JSON.stringify(Object.keys(before).sort()) !== JSON.stringify(Object.keys(after).sort())) throw new Error('the update pack adds or removes items');
  const changed = Object.keys(before).filter(key => before[key] !== after[key]);
  if (changed.length !== 1 || !changed[0].startsWith('ecc:ecc.rule.typescript.')) throw new Error(`the update pack must change exactly one ECC TypeScript rule; it changes ${changed.join(', ') || 'nothing'}`);
  const itemId = changed[0].slice('ecc:'.length);
  // Only the Catalogs' prepared content, as a person's Workbench has it: Core reports update states only when every
  // offered release names its items' hashes, which the fixture release index does not.
  const installSources = join(fixtureDir, 'update-one-installed-sources.json'), updateSources = join(fixtureDir, 'update-one-newer-sources.json');
  const archiveSha256 = sha256(readFileSync(updatePack));
  await writeFile(installSources, JSON.stringify({ prepared: base.prepared }));
  await writeFile(updateSources, JSON.stringify({ prepared: base.prepared.map(({ expectedContentSha256: _pinned, ...entry }) => ({ ...entry, root: newRoot, archivePath: updatePack, archiveSha256 })) }));

  const installed = await withHost(project, origin => runUpdateOneInstallBrowser({ origin, output, playwrightModule, theme }), installSources);
  if (installed.status !== 'passed') return installed;
  const target = installed.inventory.selections.find(selection => selection.item?.itemId === itemId && selection.scope === 'project');
  if (!target) throw new Error(`${itemId} was not installed with ecc.rules.typescript`);
  const treeBefore = await treeHashes(project);
  const updated = await withHost(project, origin => runUpdateOneBrowser({ origin, output, playwrightModule, theme, itemId }), updateSources, updatedConsumer);
  if (updated.status !== 'passed') return updated;
  const treeAfter = await treeHashes(project);
  // Only the updated item's files changed (sha256 before and after); every other file is byte-identical.
  const relative = path => path.replace(/\\/g, '/').replace(`${project.replace(/\\/g, '/')}/`, '');
  const targetPaths = new Set(target.members.map(member => relative(member.path)));
  const changedPaths = [...new Set([...Object.keys(treeBefore), ...Object.keys(treeAfter)])].filter(path => treeBefore[path] !== treeAfter[path]).sort();
  if (!targetPaths.size) throw new Error(`Core lists no files for ${itemId}`);
  const outside = changedPaths.filter(path => !targetPaths.has(path)), touched = changedPaths.filter(path => targetPaths.has(path));
  if (!touched.length) throw new Error(`the updated item's files did not change: ${[...targetPaths].join(', ')}`);
  if (outside.length) throw new Error(`${outside.length} files outside ${itemId} changed: ${outside.slice(0, 5).join(', ')}`);
  // Every selection keeps its origins and configuration; the updated one is recorded as current, its files matching.
  const lost = installed.inventory.selections.filter(selection => {
    const next = updated.inventory.selections.find(other => other.managementId === selection.managementId && other.scope === selection.scope);
    return !next || kept(next) !== kept(selection);
  });
  if (lost.length) throw new Error(`${lost.length} selections lost origins or configuration: ${lost.slice(0, 5).map(selection => selection.managementId).join(', ')}`);
  if (updated.inventory.selections.length !== installed.inventory.selections.length) throw new Error('the update changed how many selections are installed');
  const now = updated.inventory.selections.find(selection => selection.managementId === target.managementId);
  if (now.updateState !== 'current' || now.members.some(member => member.fileState !== 'matches')) throw new Error(`${itemId} after the update: ${JSON.stringify({ updateState: now.updateState, members: now.members })}`);
  if (now.item.contentSha256 === target.item.contentSha256) throw new Error(`${itemId} is still recorded with its installed content`);
  await writeFile(join(output, `update-one-files-${theme}.json`), JSON.stringify({ itemId, changed: touched.map(path => ({ path, before: treeBefore[path], after: treeAfter[path] })),
    unchanged: Object.keys(treeBefore).length - touched.length, selectionsKept: installed.inventory.selections.length }, null, 2));
  return { status: 'passed' };
}

const playwrightModule = import.meta.resolve('playwright');
for (const name of selected) {
  const project = join(consumerDir, `installed-truth-${name}-${theme}-${randomUUID().slice(0, 8)}`);
  const output = join(consumerDir, `installed-truth-evidence-${name}-${theme}`);
  const outcome = name === 'update-one' ? await runUpdateOne({ project, output, playwrightModule, theme })
    : await withHost(project, origin => cases[name]({ origin, output, project, playwrightModule, theme }));
  if (outcome.status !== 'passed') throw new Error(`${name} (${theme}) failed: ${JSON.stringify(outcome)}`);
  console.log(`installed truth ${name} (${theme}) passed`);
}

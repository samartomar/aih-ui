// Host-owned running-page fixtures built exclusively from installed public package exports.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { readRelease, resolveSelections } from '@aihq/catalog/reader';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { checkCompatibility, listTools, toolBindings } from '@aihq/core/harness';
const bytes = async specifier => readFile(fileURLToPath(import.meta.resolve(specifier)));
const sha = value => createHash('sha256').update(value).digest('hex');
export async function frameworkFixtures(directory, catalogArtifact) {
  await mkdir(directory, { recursive: true });
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const prepared = await readInstalledPreparedContent({ root, frameworkId: 'project-basics', sourceInput: 'fixture-internal' });
  if (!prepared.valid) throw new Error('Pinned prepared fixture is unavailable.');
  const golden = await bytes('@aihq/catalog/fixtures/release-1-7/project-basics-release-1.7.0.json');
  const checked = readRelease(golden, { expectedSha256: sha(golden) });
  if (!checked.valid) throw new Error('Public golden release fixture is refused.');
  const releasePath = join(directory, 'fixture-release.json'); await writeFile(releasePath, golden);
  const entry = { frameworkId: checked.release.framework.id, name: checked.release.framework.name, version: checked.release.framework.version,
    schema: checked.release.schema, sha256: checked.release.sha256, status: 'current', evidence: [], source: { id: 'fixture-index', kind: 'local' }, location: { kind: 'local', input: 'fixture-release' } };
  const index = { schema: 'urn:aihq:catalog:release-index:1.0.0', sourceId: 'fixture-index', version: 1, issuedAt: '2026-01-01T00:00:00Z', expires: '2999-01-01T00:00:00Z', entries: [entry] };
  const indexPath = join(directory, 'fixture-index.json'); await writeFile(indexPath, stable(index) + '\n');
  const source = { sourceId: index.sourceId, trust: 'none', path: indexPath, authorizedFrameworks: [entry.frameworkId], releases: [{ sha256: entry.sha256, path: releasePath, root }] };
  const internal = { root, frameworkId: prepared.release.framework.id, archivePath: catalogArtifact.tarball, archiveSha256: catalogArtifact.sha256, expectedContentSha256: prepared.release.sha256 };
  const additional = await readInstalledPreparedContent({ root, frameworkId: 'extensions', sourceInput: 'fixture-additional' });
  if (!additional.valid) throw new Error('Pinned additional prepared fixture unavailable.');
  const scenarios = { ready: { indexes: [source], prepared: [internal, { ...internal, frameworkId: additional.release.framework.id, expectedContentSha256: additional.release.sha256 }] }, unsigned: { indexes: [source] }, empty: { indexes: [{ ...source, path: join(directory, 'empty-index.json') }] }, unavailable: {}, failed: { indexes: [{ ...source, path: join(directory, 'failed-index.json') }], prepared: [internal] }, missing: { indexes: [{ ...source, path: join(directory, 'missing-index.json') }], prepared: [internal] }, internalFailed: { indexes: [source], prepared: [{ ...internal, expectedContentSha256: '0'.repeat(64) }] } };
  await writeFile(join(directory, 'empty-index.json'), stable({ ...index, entries: [] }) + '\n');
  await writeFile(join(directory, 'failed-index.json'), '{broken');
  const brokenRelease = join(directory, 'failed-release.json'); await writeFile(brokenRelease, '{broken');
  scenarios.releaseFailed = { indexes: [{ ...source, releases: [{ sha256: entry.sha256, path: brokenRelease, root }] }], prepared: [internal] };
  const conflict = JSON.parse(await bytes('@aihq/catalog/fixtures/release-index/conflict-two-sources.json'));
  scenarios.conflicting = { indexes: await Promise.all(conflict.sources.map(async (value, i) => {
    const path = join(directory, `conflict-${i}.json`); await writeFile(path, stable(value.index) + '\n');
    return { sourceId: value.sourceId, trust: value.trust, authorizedFrameworks: value.authorizedFrameworks, path };
  })), prepared: [internal] };
  for (const [name, config] of Object.entries(scenarios)) { config.fixture = true; if (config.indexes?.length) config.indexStatePath = join(directory, `${name}-state.json`); }
  const expected = { prepared: { framework: prepared.release.framework, sha256: prepared.release.sha256, items: prepared.release.items.map(item => ({ id: item.id, name: item.name, label: item.label })), status: prepared.status, provenance: prepared.provenance, archiveSha256: internal.archiveSha256 }, release: { framework: checked.release.framework, sha256: checked.release.sha256 } };
  const starting = release => (release.sets ?? []).filter(set => set.offer === 'pre-ticked').map(set => ({ release: { releaseSha256: release.sha256, scope: 'project' }, setId: set.id, setSha256: set.setSha256, options: {}, members: [] }));
  const members = (release, sets) => resolveSelections({ releases: { [release.sha256]: release }, roots: [], skips: [], sets });
  const defaults = members(additional.release, starting(additional.release));
  expected.additional = { framework: additional.release.framework, sha256: additional.release.sha256, items: additional.release.items.length,
    choosable: additional.release.items.filter(item => item.role !== 'supporting').length,
    defaults: defaults.value.selections.filter(selection => additional.release.items.find(item => item.id === selection.item.itemId)?.role !== 'supporting').length,
    requests: starting(additional.release), grill: additional.release.items.find(item => item.name === 'grill-me') };
  const ecc = await readInstalledPreparedContent({ root, frameworkId: 'ecc', sourceInput: 'fixture-ecc' });
  if (!ecc.valid) throw new Error('Public ECC prepared fixture unavailable.');
  const optionSet = ecc.release.sets.find(set => set.options?.length), option = optionSet.options[0], language = option.choices.find(choice => choice.id === 'typescript') ?? option.choices[0];
  const requests = [{ release: { releaseSha256: ecc.release.sha256, scope: 'project' }, setId: optionSet.id, setSha256: optionSet.setSha256, options: { [option.id]: [language.id] }, members: [] }];
  const selected = members(ecc.release, requests);
  // Keep current public input refusals visible without blocking unrelated source/route cases.
  // The browser proof records this as incomplete, never as a successful language choice.
  const fit = checkCompatibility({ nativeRoutes: ecc.release.nativeRoutes === undefined ? [] : [{ framework: ecc.release.framework.id, lines: ecc.release.nativeRoutes }], tool: 'claude', platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch }, binding: toolBindings.find(binding => binding.tool === 'claude'), items: ecc.release.items.map(item => ({ item })) });
  expected.ecc = { framework: ecc.release.framework, sha256: ecc.release.sha256, optionSet: { id: optionSet.id, name: optionSet.name }, option: { id: option.id, name: option.name }, language: { id: language.id, name: language.name }, requests,
    resolution: selected, pluginRoutes: fit.pluginRoutes, visible: (selected.value?.selections ?? []).filter(selection => ecc.release.items.find(item => item.id === selection.item.itemId)?.role !== 'supporting').filter(selection => { const item = fit.items?.find(item => item.item.itemId === selection.item.itemId); return !item || item.support !== 'none' && !item.notRendered && !item.staticBlockers?.length; }).map(selection => selection.item.itemId) };
  scenarios.browse = { ...scenarios.ready, prepared: [...scenarios.ready.prepared, { ...internal, frameworkId: ecc.release.framework.id, expectedContentSha256: ecc.release.sha256 }], fixture: true, indexStatePath: join(directory, 'browse-state.json') };
  const superpowers = await readInstalledPreparedContent({ root, frameworkId: 'superpowers', sourceInput: 'fixture-superpowers' });
  if (!superpowers.valid) throw new Error('Public Superpowers prepared fixture unavailable.');
  const fallback = superpowers.release.items.find(item => item.fallback);
  expected.fallback = { framework: superpowers.release.framework, sha256: superpowers.release.sha256, itemId: fallback.id, kind: superpowers.release.items.find(item => item.id === fallback.fallback.itemId).kind };
  scenarios.facts = { ...scenarios.browse, prepared: [...scenarios.browse.prepared, { ...internal, frameworkId: superpowers.release.framework.id, expectedContentSha256: superpowers.release.sha256 }], indexStatePath: join(directory, 'facts-state.json') };
  scenarios.facts.fixtureLabel = 'Controlled Scan decision-table and Windows x64 fallback specimens; not Linux host usage.';
  scenarios.hook = { fixture: true };
  scenarios.eccFacts = { ...scenarios.browse, fixtureLabel: 'Actual current ECC set refusal with independent item facts; no acquisition or native use.' };
  scenarios.routes = { ...scenarios.facts, fixtureLabel: 'Public plugin-route guidance and controlled unavailable/refusal presentation fixtures; no native use.' };
  const routeItems = [{ item: superpowers.release.items.find(item => item.role === 'choosable') }];
  const nativeRoutes = [{ framework: superpowers.release.framework.id, lines: superpowers.release.nativeRoutes }];
  expected.routes = { framework: superpowers.release.framework, sha256: superpowers.release.sha256, nativeRoutes,
    byTool: Object.fromEntries(['claude', 'codex', 'copilot', 'antigravity', 'kiro'].map(tool => [tool, checkCompatibility({ tool, platform: { os: 'linux', arch: 'x64' }, items: routeItems, binding: toolBindings.find(binding => binding.tool === tool), nativeRoutes }).pluginRoutes])),
    refusal: checkCompatibility({ tool: 'claude', platform: { os: 'linux', arch: 'x64' }, items: routeItems, binding: toolBindings.find(binding => binding.tool === 'claude'), nativeRoutes: [{ framework: superpowers.release.framework.id, lines: [null] }] }) };

  const supported = release => release.items.filter(item => item.role !== 'supporting').filter(item => {
    const read = checkCompatibility({ tool: 'claude', platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch }, binding: toolBindings.find(binding => binding.tool === 'claude'), items: [{ item }] });
    const fit = read.items?.[0]; return !fit || fit.support !== 'none' && !fit.notRendered && !fit.staticBlockers?.length;
  });
  expected.prepared.items = supported(prepared.release).map(item => ({ id: item.id, name: item.name, label: item.label }));
  expected.additional.choosable = supported(additional.release).length;
  const visibleECC = new Set(supported(ecc.release).map(item => item.id));
  expected.ecc.visible = (selected.value?.selections ?? []).filter(selection => visibleECC.has(selection.item.itemId)).map(selection => selection.item.itemId);
  expected.counts = listTools().map(tool => {
    const result = checkCompatibility({ tool: tool.id, platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch }, binding: toolBindings.find(binding => binding.tool === tool.id), items: prepared.release.items.map(item => ({ item })) });
    return { tool: tool.id, label: tool.label, count: result.status === 'checked' ? result.items.filter(item => item.observedOn).length : null, result };
  });
  return { scenarios, expected };
}

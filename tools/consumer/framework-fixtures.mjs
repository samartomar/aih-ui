// Host-owned running-page fixtures built exclusively from installed public package exports.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { readRelease } from '@aihq/catalog/reader';
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
  expected.additional = { framework: additional.release.framework, sha256: additional.release.sha256, items: additional.release.items.length };
  expected.counts = listTools().map(tool => {
    const result = checkCompatibility({ tool: tool.id, platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch }, binding: toolBindings.find(binding => binding.tool === tool.id), items: prepared.release.items.map(item => ({ item })) });
    return { tool: tool.id, label: tool.label, count: result.status === 'checked' ? result.items.filter(item => item.observedOn).length : null, result };
  });
  return { scenarios, expected };
}

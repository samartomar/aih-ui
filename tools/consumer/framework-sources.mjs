// Host-selected sources only. Browser requests and saved choices cannot name paths or trust.
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as catalogNode from '@aihq/catalog/node';
import * as reader from '@aihq/catalog/reader';
import * as harness from '@aihq/core/harness';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bounded = async (path, limit) => {
  if (!isAbsolute(path) || !(await stat(path)).isFile() || (await stat(path)).size > limit) throw new Error('Host-selected file unavailable or exceeds its bound.');
  const bytes = await readFile(path); if (bytes.length > limit) throw new Error('Source exceeds its bound.'); return bytes;
};
async function materials(root, release) {
  const descriptors = new Map();
  for (const item of release.items) for (const descriptor of [...(item.recipe ? [item.recipe] : Object.values(item.recipes ?? {})), ...item.materials]) {
    const path = descriptor.path ?? descriptor.packagePath;
    descriptors.set(path, { ...descriptor, path });
  }
  return Promise.all([...descriptors.values()].map(async descriptor => {
    const path = resolve(root, descriptor.path);
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Source member escapes package.');
    const bytes = await bounded(path, 32_000_000);
    if (sha(bytes) !== descriptor.sha256 || bytes.length !== descriptor.byteLength) throw new Error('Source member identity mismatch.');
    return { ...descriptor, bytes: new Uint8Array(bytes) };
  }));
}
// Preserve every public per-item result; only observedOn on the current platform contributes to the count.
function observation(release) {
  return (harness.listTools?.() ?? []).map(tool => {
    try {
      const result = harness.checkCompatibility({ tool: tool.id, platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch },
        binding: harness.toolBindings?.find(value => value.tool === tool.id), items: release.items.map(item => ({ item })) });
      return { tool: tool.id, label: tool.label, ...result, count: result.status === 'checked' ? result.items.filter(item => item.observedOn !== null && item.observedOn !== undefined).length : null };
    } catch { return { tool: tool.id, label: tool.label, status: 'failed', count: null }; }
  });
}
export async function readFrameworkSources(configuration) {
  const inventories = [], frameworks = [], sources = [];
  if (!configuration) return { inventories, frameworks, sources: [{ state: 'unavailable', message: 'Release index unavailable: no source configured.' }] };
  if (!Array.isArray(configuration.indexes ?? []) || !Array.isArray(configuration.prepared ?? []) || (configuration.indexes?.length ?? 0) > 16 || (configuration.prepared?.length ?? 0) > 16) throw new Error('Supply bounded host source lists.');
  const requests = await Promise.all((configuration.indexes ?? []).map(async source => {
    try { return { sourceId: source.sourceId, trust: source.trust, authorizedFrameworks: source.authorizedFrameworks, indexBytes: await bounded(source.path, 1_048_576) }; }
    catch { return { sourceId: source.sourceId, trust: source.trust, authorizedFrameworks: source.authorizedFrameworks }; }
  }));
  if (requests.length && typeof reader.readReleaseIndex !== 'function') sources.push({ state: 'unavailable', message: 'Release index unavailable: this Catalog does not publish readReleaseIndex.' });
  else if (requests.length) {
    let state = requests.map(source => ({ sourceId: source.sourceId, lastVersion: 0, lastIndexSha256: null, lastVerifiedAt: null }));
    let result;
    try {
      if (!isAbsolute(configuration.indexStatePath ?? '')) throw new Error('A host-owned index state store is required.');
      try { state = JSON.parse(await bounded(configuration.indexStatePath, 1_048_576)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      result = reader.readReleaseIndex({ evaluatedAt: new Date().toISOString(), state, sources: requests });
      if (result.sources?.length) {
        const path = configuration.indexStatePath;
        await writeFile(`${path}.next`, JSON.stringify(result.sources.map(source => source.state)));
        await rename(`${path}.next`, path);
      }
    } catch { result = { valid: false, entries: [], sources: [], diagnostics: [{ code: 'INPUT_INVALID', reason: 'state-unavailable' }] }; }
    for (const source of result.sources ?? []) {
      const codes = source.diagnostics.map(value => value.code);
      sources.push({ id: source.sourceId, state: codes.some(code => code !== 'unsigned') ? 'failed' : 'read',
        message: codes.length ? `Release index: ${codes.includes('unsigned') ? 'not verified (unsigned). ' : ''}${source.diagnostics.filter(value => value.code !== 'unsigned').map(value => `${value.code}: ${value.message}`).join(' ')}` : 'Release index read.', diagnostics: source.diagnostics });
    }
    if (!result.valid && !result.sources?.length) sources.push({ state: 'failed', message: 'Release index failed.', diagnostics: result.diagnostics });
    for (const entry of result.entries ?? []) {
      const row = { id: entry.frameworkId, name: entry.name, version: entry.version, sha256: entry.sha256, kind: 'release', state: 'unavailable', status: entry.status, observations: [] };
      frameworks.push(row);
      if (entry.status !== 'current') { row.reason = entry.reason ?? `Release is ${entry.status}.`; continue; }
      const location = (configuration.indexes ?? []).flatMap(value => value.releases ?? []).find(value => value.sha256 === entry.sha256);
      if (!location) { row.reason = 'Release unavailable: no exact local release configured by the host.'; continue; }
      try {
        const bytes = await bounded(location.path, 32_000_000);
        const checked = reader.readRelease(bytes, { expectedSha256: entry.sha256 });
        if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
        if (checked.release.framework?.id !== entry.frameworkId || checked.release.framework?.name !== entry.name || checked.release.framework?.version !== entry.version) throw new Error('Index and release framework identities disagree.');
        const inventory = { release: checked.release, family: entry.name, materialSource: { kind: 'local', input: `indexed-${entry.sha256.slice(0,24)}` }, materials: await materials(location.root, checked.release) };
        inventories.push(inventory); row.state = 'ready'; row.observations = observation(checked.release);
      } catch { row.state = 'failed'; row.reason = 'Release failed its exact identity or member checks.'; }
    }
  } else sources.push({ state: 'unavailable', message: 'Release index unavailable: no source configured.' });
  for (const selected of configuration.prepared ?? []) {
    try {
      if (typeof catalogNode.readInstalledPreparedContent !== 'function') { sources.push({ kind: 'internal', state: 'unavailable', message: 'Internal content unavailable: this Catalog does not publish its installed prepared-content reader.' }); continue; }
      const archive = await bounded(selected.archivePath, 256_000_000);
      if (sha(archive) !== selected.archiveSha256) throw new Error('Package archive identity mismatch.');
      const sourceInput = `internal-${selected.frameworkId}-${selected.archiveSha256.slice(0,16)}`;
      let read = await catalogNode.readInstalledPreparedContent({ root: selected.root, frameworkId: selected.frameworkId, sourceInput, ...(selected.expectedContentSha256 ? { expectedContentSha256: selected.expectedContentSha256 } : {}) });
      if (!read.valid) throw new Error('Prepared content refused.');
      // Bind the discovered content on a second public read and bind the installed members to this archive.
      read = await catalogNode.readInstalledPreparedContent({ root: selected.root, frameworkId: selected.frameworkId, sourceInput, expectedContentSha256: selected.expectedContentSha256 ?? read.provenance.contentSha256 });
      if (!read.valid) throw new Error('Pinned prepared content refused.');
      for (const [path, digest] of [[read.provenance.contentPath, read.provenance.contentSha256], [read.provenance.inventoryPath, read.provenance.inventorySha256]]) {
        const bytes = execFileSync('tar', ['-xzOf', '-', `package/${path}`], { input: archive, maxBuffer: 32_000_000, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        if (sha(bytes) !== digest) throw new Error('Installed content does not belong to the selected archive.');
      }
      const archivePackage = JSON.parse(execFileSync('tar', ['-xzOf', '-', 'package/package.json'], { input: archive, maxBuffer: 1_048_576, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }).toString('utf8'));
      if (archivePackage.name !== read.provenance.package.name || archivePackage.version !== read.provenance.package.version) throw new Error('Archive package identity differs from installed content.');
      const internalContent = { status: read.status, provenance: read.provenance, archiveSha256: selected.archiveSha256 };
      const inventory = { release: read.release, family: read.release.framework.name, materialSource: read.source, materials: await materials(selected.root, read.release), internalContent };
      const existing = inventories.find(value => value.release.sha256 === read.release.sha256);
      if (existing) {
        if (JSON.stringify(existing.internalContent) === JSON.stringify(internalContent)) continue;
        inventories.splice(inventories.indexOf(existing), 1);
        for (const row of frameworks.filter(value => value.sha256 === read.release.sha256)) { row.state = 'failed'; row.reason = 'Conflicting source identities; select one exact package source.'; row.observations = []; }
        throw new Error('Conflicting source identities.');
      }
      inventories.push(inventory);
      frameworks.push({ id: read.release.framework.id, name: read.release.framework.name, version: read.release.framework.version, sha256: read.release.sha256, kind: 'internal', state: 'ready', internalContent, observations: observation(read.release) });
      sources.push({ kind: 'internal', state: 'read', message: `Internal content: ${read.release.framework.name}. Not verified; baseline unbound, unauthenticated, non-production.` });
    } catch { sources.push({ kind: 'internal', state: 'failed', message: 'Internal content source failed its package, content or inventory checks.' }); }
  }
  return { inventories, frameworks, sources, fixture: configuration.fixture === true };
}

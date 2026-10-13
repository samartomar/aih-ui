// Synthetic DATA only. Never bind these inventories to an execution host.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { intakeDeclaration } from './intake.mjs';
import { rootFor, crossRef } from './intent-fixtures.mjs';
export { rootFor } from './intent-fixtures.mjs';
export const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = digest('synthetic scale source snapshot').slice(0, 40);

// A seventh framework uses this same producer path and relationship contract.
export async function scaleFramework(number, count, shared) {
  const name = `synthetic-scale-${number}`, files = { 'LICENSE': encode('Synthetic functional fixture; original demonstration data.\n') };
  const items = Array.from({ length: count }, (_, index) => {
    const id = `scale${number}.item${String(index + 1).padStart(3, '0')}`;
    const recipePath = `recipes/${id}.json`, materialPath = `materials/${id}.md`;
    files[materialPath] = encode(`# ${id}\n\nSYNTHETIC — EXECUTION DISABLED.\n${'Portable composition bytes; no native support claimed.\n'.repeat(8 + index % 9)}`);
    const inputs = index === 1 ? { directory: { type: 'string', required: false } } : {};
    files[recipePath] = encode({ schema: 'urn:aihq:core:recipe:1.0.0', id,
      description: 'Synthetic functional data; execution disabled by the proof host.', inputs, materials: [], targets: ['project'], prerequisites: [],
      operations: ['license', 'note'].map(material => ({ id: `write-${material}`, purpose: 'Synthetic bytes', kind: 'file.write', scope: 'project', target: { root: 'project', segments: [{ literal: `${id}-${material}.md` }] }, material, requires: [], checks: [`check-${material}`] })),
      checks: ['license', 'note'].map(material => ({ id: `check-${material}`, purpose: 'Synthetic bytes', kind: 'file.sha256', target: { root: 'project', segments: [{ literal: `${id}-${material}.md` }] }, sha256: { materialSha256: material } })) });
    return { id, source: 'fixture', label: id, description: 'Synthetic scale fixture; not real framework/native support.', kind: 'synthetic-instruction', recipePath,
      materials: [{ id: 'license', path: 'LICENSE' }, { id: 'note', path: materialPath }], configuration: inputs, clientCapabilities: [{ client: 'generic', surface: 'markdown', capability: 'native-loading', support: 'unknown', reason: 'Execution is disabled.' }], activation: [],
      requires: index ? [{ itemId: `scale${number}.item001` }, ...(shared ? [crossRef(shared, 'scale1.item001')] : [])] : [],
      optional: index === 1 ? [{ itemId: `scale${number}.item${String(count - 1).padStart(3, '0')}` }] : [],
      conflicts: index === count - 1 ? [{ itemId: `scale${number}.item002` }] : [] };
  });
  const declarationBytes = encode({ schema: 'urn:aihq:catalog:producer-declaration:3.0.0', format: 'aihq-catalog-producer-declaration', version: 3,
    package: { name, version: '1.0.0' }, sources: [{ id: 'fixture', repository: `example/${name}`, licensePath: 'LICENSE', license: 'LicenseRef-Synthetic' }], items });
  // Explicit host-supplied synthetic snapshots, no network acquisition claims.
  const kind = number % 3 === 1 ? 'local' : number % 3 === 2 ? 'git' : 'organization';
  const input = { id: name, kind, locator: kind === 'local' ? { input: name } : kind === 'git' ? { repository: `example/${name}`, ref: 'synthetic' } : { authorityId: 'synthetic', sourceId: name },
    resolvedIdentity: { ...(kind === 'local' ? {} : { revision }), sha256: digest(declarationBytes) } };
  const sourceFiles = [{ source: 'fixture', revision, files }], materialSource = { kind: 'local', input: name };
  const result = await intakeDeclaration({ input, declarationBytes, sourceFiles, materialSource });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  const snapshot = { input, declarationBytes: [...declarationBytes], sourceFiles: sourceFiles.map(s => ({ ...s, files: Object.fromEntries(Object.entries(s.files).map(([path, bytes]) => [path, [...bytes]])) })), materialSource };
  return { inventory: result.value, snapshot };
}

export async function scaleInventories(maintained, notes) {
  const syntheticCount = 1800 - maintained.release.items.length - notes.release.items.length;
  assert.ok(syntheticCount >= 6 * 51, 'Real inventory leaves insufficient room for the specified selected fixture.');
  const frameworks = [];
  for (let number = 1; number <= 6; number++) frameworks.push(await scaleFramework(number,
    Math.floor(syntheticCount / 6) + (number <= syntheticCount % 6 ? 1 : 0), frameworks[0]?.inventory));
  return { frameworks, inventories: [maintained, notes, ...frameworks.map(f => f.inventory)] };
}

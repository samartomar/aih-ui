// Two controlled fixture client homes (A existing, B added), one saved policy and one shared material folder, for the
// reviewed-batch tests and the browser demo, and a disposable account home (`coreHome`) for the Core state every apply keeps
// (ownership records, recovery manifests, snapshots, run history). Only the folders under `root` are touched; the two scopes
// are project scopes.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHost } from './host.mjs';
import { stable } from './headless.mjs';
import { planBatch } from './batch.mjs';
import { digestMaterial } from './batch-host.mjs';
import { homeEnvironment } from './home-environment.mjs';
const SHARED = 'shared bytes', NOW = '2026-10-16T09:00:00Z';
const sha = text => createHash('sha256').update(text).digest('hex');
const recipe = (id, directory, kind) => ({ schema: 'urn:aihq:core:recipe:1.3.0', id, description: `Batch fixture ${id}`, inputs: {},
  materials: kind === 'material' ? [{ id: 'shared', source: { kind: 'local', input: 'shared' }, path: 'shared.txt', sha256: sha(SHARED), byteLength: SHARED.length }] : [],
  targets: ['project'], prerequisites: [], checks: [],
  operations: [kind === 'process'
    ? { id: 'run', purpose: 'Exit as configured', kind: 'process.run', scope: 'project', executable: { name: 'node' }, args: [{ literal: '-e' }, { literal: 'process.exit(require("fs").existsSync("proc-ok") ? 0 : 3)' }],
      cwd: { root: 'project', segments: [] }, env: {}, acceptedExitCodes: [0], effects: ['exit code only'], requires: [], checks: [] }
    : { id: 'write', purpose: 'Write fixture', kind: 'file.write', scope: 'project', target: { root: 'project', segments: [{ literal: directory }, { literal: `${id}.md` }] },
      ...(kind === 'material' ? { material: 'shared' } : { content: { literal: `content of ${id}` } }), requires: [], checks: [] }] });
const selection = (id, directory, kind, requires = []) => ({ id, managementId: id, scope: 'project', configuration: {}, requires, recipe: { inline: recipe(id, directory, kind) } });
// Runs `work` with this process's account home pointing at `home`, then restores it. Core resolves the home when it is used.
async function inHome(home, work) {
  const layout = homeEnvironment(home), saved = Object.fromEntries(Object.keys(layout).map(key => [key, process.env[key]]));
  Object.assign(process.env, layout);
  try { return await work(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
// `applyEarlier: false` skips applying A's earlier selection through Core (the pure tests need no applied state).
// `conflict` makes B's first action target a file the person already owns. B's process action exits non-zero until the file
// `procMarker` exists in B's home, so a test decides when it succeeds.
export async function batchFixture(root, { conflict = false, applyEarlier = true } = {}) {
  const homes = { a: join(root, 'home-a'), b: join(root, 'home-b') }, materialRoot = join(root, 'material'), coreHome = join(root, 'core-home');
  for (const dir of [coreHome, join(homes.a, '.claude'), join(homes.a, 'notes'), join(homes.b, '.codex'), materialRoot]) await mkdir(dir, { recursive: true });
  await writeFile(join(materialRoot, 'shared.txt'), SHARED);
  const userFiles = { [join(homes.a, 'notes', 'user.md')]: 'my own notes\n', [join(homes.a, '.claude', 'user-settings.json')]: '{"theme":"mine"}\n' };
  for (const [path, text] of Object.entries(userFiles)) await writeFile(path, text);
  const conflictFile = join(homes.b, '.codex', 'b-core.md');
  if (conflict) await writeFile(conflictFile, 'already mine\n');
  const selections = [selection('a-earlier', '.claude', 'text'), selection('a-extra', '.claude', 'material'), selection('b-core', '.codex', 'material'),
    selection('b-dependent', '.codex', 'material', ['b-core']), selection('b-proc', '', 'process'), selection('b-after-proc', '.codex', 'text', ['b-proc'])];
  const savedPolicyBytes = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'vibe', selections }, null, 2));
  // A's earlier setup: applied before the batch, not part of it.
  if (applyEarlier) {
    await inHome(coreHome, async () => {
      const earlier = createHost({ projectRoot: homes.a, controls: { logging: 'off' } });
      const ready = await earlier.prepareSession({ policyText: JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'vibe', selections: [selections[0]] }) });
      if (ready.status !== 'ready') throw new Error(`Fixture setup was not ready: ${JSON.stringify(ready.diagnostics)}`);
      const applied = await earlier.applyApproved({ sessionId: ready.sessionId, reviewDigest: ready.review.reviewDigest });
      if (applied.completion !== 'complete') throw new Error(`Fixture setup did not complete: ${JSON.stringify(applied)}`);
    });
  }
  const selectionDigest = id => sha(stable(selections.find(s => s.id === id)));
  const action = (id, scope, selectionId, requires = [], inputs = []) => ({ id, scope, category: 'client', selection: { id: selectionId, sha256: selectionDigest(selectionId) }, inputs, requires });
  const plan = { savedPolicyBytes, now: NOW, continuation: 'stop', categories: ['client'],
    scopes: [{ id: 'scope-a', role: 'existing', client: 'claude', target: { kind: 'project', root: homes.a } }, { id: 'scope-b', role: 'added', client: 'codex', target: { kind: 'project', root: homes.b } }],
    inputs: [{ id: 'shared', kind: 'material', ...(await digestMaterial(materialRoot)) }],
    actions: [action('b-core', 'scope-b', 'b-core', [], ['shared']), action('b-dependent', 'scope-b', 'b-dependent', ['b-core'], ['shared']),
      action('a-extra', 'scope-a', 'a-extra', [], ['shared']), action('b-proc', 'scope-b', 'b-proc')] };
  const planned = await planBatch(plan);
  if (planned.status !== 'ok') throw new Error(`Fixture plan refused: ${JSON.stringify(planned.diagnostics)}`);
  return { homes, coreHome, materialRoot, userFiles, savedPolicyBytes, plan, envelopeBytes: planned.value.envelopeBytes, batchId: planned.value.record.id, action, materialRoots: { shared: materialRoot }, procMarker: join(homes.b, 'proc-ok'), conflictFile };
}

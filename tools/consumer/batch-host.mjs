// Host-owned execution of a reviewed batch (Node only; package export `aih-ui/batch-host`). Every review, run and recovery
// prepares fresh work through the current host interface; no prepared handle is stored, returned or reloaded, and a batch record
// never holds one. There is no atomic multi-scope promise: each action ends as completed, failed, untouched, cancelled or
// unknown, as Core and the folder reported it. `faults` and `clients` are host configuration, never request input.
// The person's choice to run an opaque process (planning it, or recovering with `rerun`) is single use: the host records it as
// spent, in a superseding batch handed to the caller's `persist`, before the process can run (see runBatch).
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { nativeClientIds } from '@aihq/core/harness';
import { createHost } from './host.mjs';
import { refuse, stable } from './headless.mjs';
import { readBatch, planBatch, isVerifiable } from './batch.mjs';
const MAX_MATERIAL_FILES = 2000, MAX_SNAPSHOT_ENTRIES = 2000, MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const FAULTS = ['stale-target'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
const fileTarget = op => op.kind !== 'process.run' ? op.target : null;
// Digest of a shared material folder: the sorted relative paths with the sha256 and length of every file, and the total bytes.
export async function digestMaterial(directory) {
  const entries = [];
  const walk = async (dir, prefix) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entries.length > MAX_MATERIAL_FILES) throw new RangeError('Shared material has too many files.');
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) { const bytes = await readFile(join(dir, entry.name)); entries.push([`${prefix}${entry.name}`, sha(bytes), bytes.length]); }
    }
  };
  await walk(directory, '');
  return { sha256: sha(stable(entries)), byteLength: entries.reduce((sum, [, , length]) => sum + length, 0) };
}
// Digest of every file under a scope root that no action targets, bounded: beyond the bound the state is unknown, not guessed.
async function snapshot(root, excluded) {
  const files = new Map();
  let entries = 0, bytes = 0;
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (++entries > MAX_SNAPSHOT_ENTRIES) throw new RangeError('bounded');
      if (entry.isDirectory()) await walk(path);
      else if (!excluded.has(normalized(path))) {
        if (entry.isFile()) { const data = await readFile(path); bytes += data.length; if (bytes > MAX_SNAPSHOT_BYTES) throw new RangeError('bounded'); files.set(relative(root, path), sha(data)); }
        else files.set(relative(root, path), entry.isSymbolicLink() ? 'link' : 'special');
      }
    }
  };
  try { await walk(root); return { state: 'known', files }; }
  catch (error) { return { state: 'unknown', reason: error instanceof RangeError ? 'bounded' : 'unreadable' }; }
}
const unrelatedOutcome = (before, after) => before.state === 'known' && after.state === 'known'
  ? (stable([...before.files]) === stable([...after.files]) ? { outcome: 'untouched', files: before.files.size } : { outcome: 'unknown', files: null, reason: 'changed-outside-batch' })
  : { outcome: 'unknown', files: null, reason: before.state === 'unknown' ? before.reason : after.reason };
const codes = diagnostics => (Array.isArray(diagnostics) ? diagnostics : []).map(d => ({ code: d.code, ...(d.reason ? { reason: d.reason } : {}) }));
// One fresh Prepare of the given selections as a policy. Core `requires` are dropped here: the reviewed action order and
// the actions' own requires already carry them, and each action is applied on its own.
async function prepareSelections(host, policy, selections) {
  try { return await host.prepareSession({ policyText: JSON.stringify({ ...policy, selections: selections.map(selection => ({ ...selection, requires: [] })) }) }); }
  catch { return { status: 'invalid', diagnostics: [{ code: 'PREPARE_THREW', reason: 'exception' }] }; }
}
const operationsOf = (prepared, actions) => (prepared.review?.operations ?? []).map(op => ({ action: actions.find(a => a.selection.id === op.id.split('/')[0])?.id ?? null, kind: op.kind,
  target: op.details?.target ?? op.details?.cwd ?? null, effects: op.effects, ownership: op.ownership }));
const managedIds = async host => {
  try { const inventory = await host.managedInventory(); return new Set(inventory.status === 'complete' ? inventory.selections.map(s => s.managementId) : []); } catch { return new Set(); }
};
// Whether an earlier result still stands, judged only from a fresh Prepare and Core's own custody: every operation already
// satisfied, or the person changed what Core manages (an edit is preserved, never re-applied).
async function observeRetained(host, policy, selection) {
  const prepared = await prepareSelections(host, policy, [selection]), operations = prepared.review?.operations ?? [];
  if (prepared.status === 'ready' && operations.length > 0 && operations.every(op => op.effects === 'already-satisfied')) return 'retained-earlier-result';
  if (prepared.status === 'blocked' && operations.length > 0 && operations.every(op => op.effects === 'already-satisfied' || op.effects === 'conflict')
    && (await managedIds(host)).has(selection.managementId ?? selection.id)) return 'retained-earlier-result';
  return 'retained-not-satisfied';
}
// Test fault: swap each file target for a directory after the action's fresh Prepare, so Core genuinely rejects the stale review.
async function staleTargets(operations) {
  const swapped = [];
  for (const target of operations.map(fileTarget).filter(Boolean)) {
    let backup = `${target}.batch-fault`;
    try { await rename(target, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; backup = null; }
    await mkdir(target, { recursive: true });
    swapped.push([target, backup]);
  }
  return async () => { for (const [target, backup] of swapped) { await rm(target, { recursive: true, force: true }); if (backup) await rename(backup, target); } };
}
// Maps Core's run result to what was observed. Anything Core did not classify is unknown, never guessed.
function observed(applied) {
  const operations = (applied.operations ?? []).map(op => ({ id: op.id, application: op.application, ...(op.reason ? { reason: op.reason } : {}), ...(op.effectsUncertain ? { effectsUncertain: true } : {}) }));
  const core = { completion: applied.completion ?? applied.status ?? null, runId: applied.runId ?? null, operations, diagnostics: codes(applied.diagnostics) };
  if (applied.status === 'lost') return { outcome: 'unknown', reason: 'apply-lost', core };
  const uncertain = operations.find(op => op.effectsUncertain);
  if (applied.completion === 'complete' && operations.every(op => op.application !== 'failed')) return { outcome: 'completed', reason: null, core };
  if (uncertain) return { outcome: 'unknown', reason: uncertain.reason ?? 'effects-uncertain', core };
  if (applied.completion === 'rejected' || applied.status === 'rejected') return { outcome: 'failed', reason: core.diagnostics[0]?.code ?? 'rejected', core };
  if (applied.completion === 'incomplete') return { outcome: 'failed', reason: operations.find(op => op.application === 'failed')?.reason ?? 'incomplete', core };
  return { outcome: 'unknown', reason: 'unclassified-completion', core };
}
export function createBatchHost({ clients = nativeClientIds, materialRoots = {}, controls, hostFor, faults = {} } = {}) {
  if (Object.values(faults).some(fault => !FAULTS.includes(fault))) throw new TypeError(`Unknown fault; supported: ${FAULTS.join(', ')}`);
  const hostAt = hostFor ?? (root => createHost({ projectRoot: root, materialRoots, controls }));
  async function open(envelopeBytes, batchId) {
    const read = await readBatch({ envelopeBytes, batchId });
    if (read.status !== 'ok') return read;
    return { status: 'ok', value: { record: read.value.record, current: read.value.current, supported: read.value.supported, diagnostics: read.diagnostics, policy: JSON.parse(new TextDecoder().decode(read.value.savedPolicyBytes)) } };
  }
  // An envelope with a required record this Workbench does not know is read-only: it may be reviewed, never run, recovered or changed.
  function unsupported({ diagnostics }, envelopeBytes) {
    const first = diagnostics.find(diagnostic => diagnostic.code === 'JOURNEY_RECORD_UNSUPPORTED');
    return refuse('JOURNEY_RECORD_UNSUPPORTED', first?.path ?? '/records', first?.message ?? 'The envelope holds a required record this Workbench does not support.', envelopeBytes);
  }
  const selectionOf = (policy, action) => policy.selections.find(selection => selection.id === action.selection.id);
  async function checkInput(record, id) {
    const input = record.inputs.find(candidate => candidate.id === id), root = materialRoots[id];
    if (!root) return { id, ok: false, reason: 'unavailable' };
    try { const found = await digestMaterial(root); return found.sha256 === input.sha256 && found.byteLength === input.byteLength ? { id, ok: true } : { id, ok: false, reason: 'changed' }; }
    catch { return { id, ok: false, reason: 'unavailable' }; }
  }
  // The fresh review: one Prepare per scope of its live actions, and every conflict found across scopes. Writes nothing.
  async function inspect({ record, policy }) {
    const conflicts = [], targets = new Set(), owners = new Map();
    const scopes = await Promise.all(record.scopes.map(async scope => {
      const mine = record.actions.filter(action => action.scope === scope.id), live = [], seen = new Set();
      for (const action of mine.filter(action => action.retain !== true)) {
        if (seen.has(action.selection.id)) conflicts.push({ kind: 'duplicate-selection', scope: scope.id, action: action.id });
        else { seen.add(action.selection.id); live.push(action); }
      }
      const prepared = live.length ? await prepareSelections(hostAt(scope.target.root), policy, live.map(action => selectionOf(policy, action))) : { status: 'skipped', diagnostics: [] };
      return { scope, live, prepared, operations: operationsOf(prepared, live), retained: mine.filter(action => action.retain === true).map(action => action.id) };
    }));
    for (const { scope, prepared, operations } of scopes) {
      if (prepared.status !== 'ready' && prepared.status !== 'skipped') {
        const bad = operations.filter(op => op.effects === 'conflict'), diagnostics = prepared.diagnostics ?? [];
        if (bad.length) for (const op of bad) {
          const diagnostic = diagnostics.find(d => d.path && op.target && normalized(join(scope.target.root, d.path)) === normalized(op.target)) ?? diagnostics[0];
          conflicts.push({ kind: 'core-conflict', scope: scope.id, action: op.action, target: op.target, code: diagnostic?.code ?? 'STATE_CONFLICT', reason: diagnostic?.reason ?? null });
        } else conflicts.push({ kind: 'core-review', scope: scope.id, status: prepared.status, code: diagnostics[0]?.code ?? null, reason: diagnostics[0]?.reason ?? null });
      }
      if (!clients.includes(scope.client)) conflicts.push({ kind: 'client-not-listed', scope: scope.id, client: scope.client });
      for (const op of operations) {
        const target = fileTarget(op);
        if (!target) continue;
        targets.add(normalized(target));
        const other = record.scopes.find(candidate => candidate.id !== scope.id && inside(candidate.target.root, target));
        if (other) conflicts.push({ kind: 'target-in-other-scope', scope: scope.id, action: op.action, target, other: other.id });
        const owner = owners.get(normalized(target));
        if (owner && owner !== op.action) conflicts.push({ kind: 'same-target', scope: scope.id, action: op.action, other: owner, target });
        else owners.set(normalized(target), op.action);
      }
    }
    for (const [index, a] of record.scopes.entries()) for (const b of record.scopes.slice(index + 1))
      if (inside(a.target.root, b.target.root) || inside(b.target.root, a.target.root)) conflicts.push({ kind: 'nested-roots', scopes: [a.id, b.id] });
    const inputs = await Promise.all(record.inputs.map(input => checkInput(record, input.id)));
    for (const input of inputs.filter(entry => !entry.ok)) conflicts.push({ kind: 'shared-input', input: input.id, reason: input.reason });
    const snapshots = await Promise.all(record.scopes.map(scope => snapshot(scope.target.root, targets)));
    const flagged = (kind, subject) => conflicts.some(c => (kind === 'scope' ? c.scope === subject || c.scopes?.includes(subject) : c.action === subject));
    const reviewed = scopes.map(({ scope, prepared, operations, retained }, index) => ({ id: scope.id, role: scope.role, client: scope.client, listed: clients.includes(scope.client), prepare: prepared.status,
      operations: operations.map(({ action, target, effects, ownership }) => ({ action, target, effects, ownership })), retained, unrelated: { files: snapshots[index].state === 'known' ? snapshots[index].files.size : null } }));
    const state = {
      'shared-input': subject => inputs.find(entry => entry.id === subject).ok ? 'passed' : 'failed',
      'unrelated-state': subject => snapshots[record.scopes.findIndex(scope => scope.id === subject)].state === 'known' ? 'passed' : 'unknown',
      conflict: subject => flagged('scope', subject) ? 'failed' : 'passed',
      'core-review': subject => { const action = record.actions.find(candidate => candidate.id === subject); return action.retain === true ? 'skipped' : flagged('action', subject) || flagged('scope', action.scope) ? 'failed' : 'passed'; }
    };
    return { targets, value: { scopes: reviewed, conflicts, checks: record.checks.map(check => ({ ...check, state: state[check.kind](check.subject) })), ready: conflicts.length === 0 } };
  }
  return {
    async reviewBatch({ envelopeBytes, batchId } = {}) {
      const opened = await open(envelopeBytes, batchId);
      if (opened.status !== 'ok') return opened;
      const { value } = await inspect(opened.value);
      return { status: 'ok', diagnostics: opened.value.diagnostics, batchId: opened.value.record.id, ...value, ready: value.ready && opened.value.supported };
    },
    // `persist(envelopeBytes)` makes a superseding batch durable and resolves once it is. It is how the person's consent to run an
    // action Core cannot verify is spent: just before such an action is applied, the host writes the current batch again with that
    // action kept (`retain`), and only if that was persisted does the action run. Without a `persist` that works, it is `failed`
    // (`consent-not-recorded`) and nothing is applied for it. The report's `consumedBy` is the latest batch written that way.
    async runBatch({ envelopeBytes, batchId, approve, persist, now = new Date().toISOString() } = {}) {
      const opened = await open(envelopeBytes, batchId);
      if (opened.status !== 'ok') return opened;
      const { record, policy, current } = opened.value;
      if (!opened.value.supported) return unsupported(opened.value, envelopeBytes);
      if (approve?.batchId !== record.id) return refuse('BATCH_APPROVAL_REQUIRED', '/approve', 'Approval must name the exact batch id that was reviewed.', envelopeBytes);
      if (!current) return refuse('BATCH_SUPERSEDED', '/batchId', 'A later batch superseded this one; review and run the current batch.', envelopeBytes);
      const { value: review, targets } = await inspect(opened.value);
      if (!review.ready) return { ...refuse('BATCH_CONFLICTS', '', 'Conflicts were found before apply; nothing was applied.'), review };
      const before = await Promise.all(record.scopes.map(scope => snapshot(scope.target.root, targets)));
      const hosts = new Map(record.scopes.map(scope => [scope.id, hostAt(scope.target.root)]));
      const results = new Map(), satisfied = result => result.outcome === 'completed' || result.reason === 'retained-earlier-result';
      let broke = false, latest = { bytes: envelopeBytes, record };
      const spend = async action => {
        if (typeof persist !== 'function') return false;
        try {
          const planned = await planBatch({ envelopeBytes: latest.bytes, scopes: latest.record.scopes, inputs: latest.record.inputs, continuation: latest.record.continuation, categories: latest.record.categories,
            actions: latest.record.actions.map(other => other.id === action.id ? { ...other, retain: true } : other), now, supersedes: latest.record.id });
          if (planned.status !== 'ok') return false;
          await persist(planned.value.envelopeBytes);
          latest = { bytes: planned.value.envelopeBytes, record: planned.value.record };
          return true;
        } catch { return false; }
      };
      for (const action of record.actions) {
        const host = hosts.get(action.scope), selection = selectionOf(policy, action);
        const end = (outcome, reason, core) => { const result = { id: action.id, scope: action.scope, outcome, reason: reason ?? null, ...(core ? { core } : {}) }; results.set(action.id, result); broke ||= outcome === 'failed' || outcome === 'unknown'; return result; };
        const unmet = action.requires.map(id => results.get(id)).find(result => !satisfied(result));
        if (unmet) { end('cancelled', unmet.reason === 'retained-unverifiable' ? 'dependency-unverifiable' : `dependency-${unmet.outcome}`); continue; }
        if (record.continuation === 'stop' && broke) { end('untouched', 'stopped-by-choice'); continue; }
        if (action.retain === true) {
          // Only an inspectable result can be shown to stand. One that no longer does is a failure, not a quiet skip.
          if (!isVerifiable(selection)) end('untouched', 'retained-unverifiable');
          else if (await observeRetained(host, policy, selection) === 'retained-earlier-result') end('untouched', 'retained-earlier-result');
          else end('failed', 'retained-result-missing');
          continue;
        }
        const drift = (await Promise.all(action.inputs.map(id => checkInput(record, id)))).find(entry => !entry.ok);
        if (drift) { end('failed', 'shared-input-changed'); continue; }
        const prepared = await prepareSelections(host, policy, [selection]);
        if (prepared.status !== 'ready') { end('failed', `prepare-${prepared.status}`, { completion: null, runId: null, operations: [], diagnostics: codes(prepared.diagnostics) }); continue; }
        if (!isVerifiable(selection) && !await spend(action)) { end('failed', 'consent-not-recorded'); continue; }
        let restore = async () => {}, result;
        try {
          if (faults[action.id] === 'stale-target') restore = await staleTargets(operationsOf(prepared, [action]));
          result = observed(await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest }));
        } catch { result = { outcome: 'unknown', reason: 'apply-threw', core: { completion: null, runId: null, operations: [], diagnostics: [] } }; }
        finally { await restore(); }
        end(result.outcome, result.reason, result.core);
      }
      const after = await Promise.all(record.scopes.map(scope => snapshot(scope.target.root, targets)));
      const actions = record.actions.map(action => results.get(action.id));
      const counts = { completed: 0, failed: 0, untouched: 0, cancelled: 0, unknown: 0 };
      for (const result of actions) counts[result.outcome]++;
      return { status: 'ok', diagnostics: [], batchId: record.id, actions, scopes: record.scopes.map((scope, index) => ({ id: scope.id, unrelated: unrelatedOutcome(before[index], after[index]) })), counts, atomic: false,
        ...(latest.record.id === record.id ? {} : { consumedBy: latest.record.id }) };
    },
    // Reinspects current state and writes a superseding batch. The caller's `outcome` is accepted for display only and never
    // trusted: a verifiable action is retained only when a fresh Prepare shows its result still stands or the person changed what Core
    // manages. An unverifiable one (an opaque process) is retained too, and runs again only if the person names it in `rerun`.
    async recoverBatch({ envelopeBytes, batchId, rerun = [], now } = {}) {
      const opened = await open(envelopeBytes, batchId);
      if (opened.status !== 'ok') return opened;
      const { record, policy, current } = opened.value;
      if (!opened.value.supported) return unsupported(opened.value, envelopeBytes);
      if (!current) return refuse('BATCH_SUPERSEDED', '/batchId', 'Only the current batch can be recovered.', envelopeBytes);
      if (!Array.isArray(rerun)) return refuse('INPUT_INVALID', '/rerun', 'Supply the actions to run again as a list of action ids.', envelopeBytes);
      const hosts = new Map(record.scopes.map(scope => [scope.id, hostAt(scope.target.root)]));
      const stands = action => observeRetained(hosts.get(action.scope), policy, selectionOf(policy, action)).then(seen => seen === 'retained-earlier-result');
      for (const [index, id] of rerun.entries()) {
        const action = record.actions.find(candidate => candidate.id === id);
        if (!action) return refuse('BATCH_RERUN_REFUSED', `/rerun/${index}`, 'No action of this batch has that id.', envelopeBytes);
        if (isVerifiable(selectionOf(policy, action)) && await stands(action)) return refuse('BATCH_RERUN_REFUSED', `/rerun/${index}`, 'Finished work Core can verify is kept, never run again.', envelopeBytes);
      }
      const kept = await Promise.all(record.actions.map(action => isVerifiable(selectionOf(policy, action)) ? stands(action) : !rerun.includes(action.id)));
      const actions = record.actions.map(({ retain: _retain, ...action }, index) => kept[index] ? { ...action, retain: true } : action);
      const planned = await planBatch({ envelopeBytes, scopes: record.scopes, inputs: record.inputs, actions, continuation: record.continuation, categories: record.categories, now, supersedes: record.id });
      if (planned.status !== 'ok') return planned;
      const review = await this.reviewBatch({ envelopeBytes: planned.value.envelopeBytes, batchId: planned.value.record.id });
      return { status: 'ok', diagnostics: [], envelopeBytes: planned.value.envelopeBytes, record: planned.value.record, projection: planned.value.projection, retained: actions.filter(a => a.retain).map(a => a.id), review };
    }
  };
}

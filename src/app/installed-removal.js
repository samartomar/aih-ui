import { applyIfUnchanged, diagnosticWords } from './host-review.js';

const readyPreparation = result => result?.disposition === 'prepared' && result.preparation?.status === 'ready' && result.preparation.sessionId && result.preparation.review
  ? result.preparation : undefined;

// A member another selection or origin still owns, when no set sentence names it.
// Contract amendment 3.2.3 row 38 (owner-approved 2026-10-30).
export const KEPT_FOR_ANOTHER = 'Kept for another selection';

// The sentence for a member Core's removal plan keeps (removal 1.2.0 `keep-*` actions). A Core action or reason is
// never page text.
export function removalMemberWords(member, entry) {
  // The set sentence ("Kept; also part of {set}", or what else keeps it) when Remove this set computed one.
  if ((member.action === 'keep-shared' || member.reason === 'another-origin') && entry?.kept) return entry.kept;
  // Contract amendment 3.2.3 row 11 (owner-approved 2026-10-30).
  if (member.action === 'keep-changed') return 'Kept; you changed it after install';
  // A licence or notice file kept with an item that keeps a changed member; it says nothing about requirements.
  // Contract amendment 3.2.3 row 37 (owner-approved 2026-10-30).
  if (member.action === 'keep-required') return "Kept: the item's licence or notice";
  return KEPT_FOR_ANOTHER;
}

function present(entries, result) {
  const steps = entries.map((entry, index) => {
    const removal = result.removals?.[index];
    if (!removal) return { entry, state: 'blocked', files: [], message: 'Core returned no removal for this item.' };
    const files = (removal.members ?? []).map(member => ({ path: member.path, action: member.action, reason: member.reason }));
    const reason = diagnosticWords(removal, result);
    // Only this origin is released: Core keeps the item, and its files, for the other owner.
    if (removal.disposition === 'prepared' && removal.change === 'remove-origin')
      return { entry, state: 'kept-shared', change: removal.change, files, message: entry.kept ?? KEPT_FOR_ANOTHER };
    const state = removal.disposition === 'prepared' ? 'ready'
      : removal.disposition === 'retained' ? 'kept'
      : removal.disposition === 'absent' ? 'absent' : 'blocked';
    const message = state === 'ready' ? `${files.length} members are reviewed for removal.`
      : state === 'kept' ? `Kept: ${reason || 'Core retained this item.'}`
      : state === 'absent' ? 'Already absent.'
      : `Cannot remove: ${reason || removal.disposition}.`;
    return { entry, state, files, message };
  });
  // One line per kept item and reason (an item's every kept file shares it); an origin-only release is its step's message.
  const kept = [...new Map((result.removals ?? []).flatMap((removal, index) => removal.change === 'remove-origin' ? [] : (removal.members ?? [])
    .filter(member => member.action?.startsWith('keep-'))
    .map(member => ({ name: entries[index]?.name ?? 'An installed item', reason: removalMemberWords(member, entries[index]) })))
    .map(item => [`${item.name}\u0000${item.reason}`, item])).values()];
  const preparation = readyPreparation(result);
  return { steps, kept, canConfirm: Boolean(preparation) && !steps.some(step => step.state === 'blocked'),
    note: 'Core reviews every requested item together. Shared, changed or required members stay when Core says so.',
    selectors: entries.map(entry => ({ managementId: entry.managementId, ...(entry.origin ? { origin: entry.origin } : {}) })),
    scope: entries[0]?.scope,
    ...(preparation ? { sessionId: preparation.sessionId, review: preparation.review } : {}) };
}

export async function previewRemoval({ entries, request, mode }) {
  if (!entries.length) return { steps: [], kept: [], canConfirm: false, note: 'Choose at least one installed item.', selectors: [] };
  const scope = entries[0].scope;
  if (entries.some(entry => entry.scope !== scope)) return { steps: entries.map(entry => ({ entry, state: 'blocked', files: [], message: 'Choose items from one scope for one reviewed removal.' })), kept: [], canConfirm: false, note: '', selectors: [] };
  const result = await request('remove', { removals: entries.map(entry => ({ managementId: entry.managementId, ...(entry.origin ? { origin: entry.origin } : {}) })), scope, mode });
  if (result?.status === 'superseded') return { steps: entries.map(entry => ({ entry, state: 'blocked', files: [], message: 'The page changed while checking. Click Remove again.' })), kept: [], canConfirm: false, note: '', selectors: [] };
  return present(entries, result);
}

// Contract amendment 3.2.3 row 13 (owner-approved 2026-10-30).
const RESTORED = 'put back the way it was before install';
function memberOutcome(entry, run) {
  if (entry.state === 'kept') return { name: entry.entry.name, state: 'kept', message: entry.message };
  // Contract amendment 3.2.3 row 12 (owner-approved 2026-10-30).
  if (entry.state === 'absent') return { name: entry.entry.name, state: 'absent', message: `${entry.entry.name}: removed` };
  if (entry.state === 'kept-shared') {
    if (run?.completion === 'complete') return { name: entry.entry.name, state: 'kept', message: `${entry.entry.name}: ${entry.message}` };
    const reason = diagnosticWords(run);
    // Contract amendment 3.2.3 row 14 (owner-approved 2026-10-30).
    return { name: entry.entry.name, state: 'failed', message: `${entry.entry.name}: Couldn't confirm it's kept.${reason ? ` ${reason}` : ''}` };
  }
  const members = (run?.members ?? []).filter(member => member.managementId === entry.entry.managementId);
  const keptFiles = entry.files.filter(file => file.action?.startsWith('keep-'));
  const keptPaths = new Set(keptFiles.map(file => file.path));
  if (run?.completion === 'complete' && members.length) {
    if (members.every(member => member.outcome === 'restored' && member.check === 'present-matching'))
      return { name: entry.entry.name, state: 'restored', message: `${entry.entry.name}: ${RESTORED}` };
    if (members.every(member => member.check === 'absent' || (member.outcome === 'restored' && member.check === 'present-matching') || (keptPaths.has(member.path) && member.outcome === 'kept'))) {
      const kept = members.filter(member => keptPaths.has(member.path) && member.outcome === 'kept');
      if (kept.length) {
        const reasons = keptFiles.map(file => removalMemberWords(file, entry.entry));
        if (members.length > kept.length) return { name: entry.entry.name, state: 'partially-removed', message: `${entry.entry.name}: Partly removed; kept: ${kept.map(member => member.path).join(', ')}` };
        return { name: entry.entry.name, state: 'kept', message: `${entry.entry.name}: ${[...new Set(reasons)].join('; ')}` };
      }
      const restored = members.some(member => member.outcome === 'restored');
      return { name: entry.entry.name, state: restored ? 'restored' : 'absent', message: `${entry.entry.name}: ${restored ? RESTORED : 'removed'}` };
    }
  }
  const reason = diagnosticWords(run);
  return { name: entry.entry.name, state: 'failed', message: `${entry.entry.name}: Couldn't confirm it's gone.${reason ? ` ${reason}` : ''}` };
}

export async function confirmRemoval({ preview, request, mode }) {
  if (!preview.canConfirm || !preview.sessionId || !preview.review) {
    const results = preview.steps.map(step => ({ name: step.entry.name, state: step.state, message: step.message }));
    return { results, outcome: 'nothing-removed', message: results.map(result => result.message).join(' ') || 'Nothing was removed.' };
  }
  const prepare = () => request('remove', { removals: preview.selectors, scope: preview.scope, mode });
  const attempt = await applyIfUnchanged({ held: preview, prepare, readyPreparation, apply: approval => request('apply', { ...approval, purpose: 'remove' }) });
  // Contract amendment 3.2.3 row 24 (owner-approved 2026-10-30).
  if (attempt.state === 'unknown') return { results: [], outcome: 'unknown', message: `Removal outcome unknown: ${diagnosticWords(attempt.run)}` };
  if (attempt.state !== 'applied') {
    const reason = [attempt.reason, diagnosticWords(attempt.result?.preparation, attempt.result)].filter(Boolean).join(' ');
    const next = attempt.preparation && attempt.result ? present(preview.steps.map(step => step.entry), attempt.result) : undefined;
    return { results: [], outcome: 'failed', message: `Removal was not applied: ${reason || 'Core did not apply the reviewed removal.'}`,
      ...(next ? { next } : {}) };
  }
  const results = preview.steps.map(step => memberOutcome(step, attempt.run));
  const failed = results.some(result => result.state === 'failed');
  return { results, outcome: failed ? 'failed' : results.some(result => ['absent', 'restored', 'partially-removed'].includes(result.state)) ? 'removed' : 'nothing-removed',
    message: results.map(result => result.message).join(' ') };
}

export function cancelRemoval({ preview }) {
  return { outcome: 'nothing-removed', message: `Removal cancelled before Apply. ${preview.steps.map(step => `${step.entry.name}: not attempted`).join(' ')}` };
}

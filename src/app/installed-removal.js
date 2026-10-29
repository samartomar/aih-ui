import { applyIfUnchanged, diagnosticWords } from './host-review.js';

const readyPreparation = result => result?.disposition === 'prepared' && result.preparation?.status === 'ready' && result.preparation.sessionId && result.preparation.review
  ? result.preparation : undefined;

function present(entries, result) {
  const steps = entries.map((entry, index) => {
    const removal = result.removals?.[index];
    if (!removal) return { entry, state: 'blocked', files: [], message: 'Core returned no removal for this item.' };
    const files = (removal.members ?? []).map(member => ({ path: member.path, action: member.action, reason: member.reason }));
    const reason = diagnosticWords(removal, result);
    const state = removal.disposition === 'prepared' ? 'ready'
      : removal.disposition === 'retained' ? 'kept'
      : removal.disposition === 'absent' ? 'absent' : 'blocked';
    const message = state === 'ready' ? `${files.length} members are reviewed for removal.`
      : state === 'kept' ? `Kept: ${reason || 'Core retained this item.'}`
      : state === 'absent' ? 'Already absent.'
      : `Cannot remove: ${reason || removal.disposition}.`;
    return { entry, state, files, message };
  });
  const kept = (result.removals ?? []).flatMap((removal, index) => (removal.members ?? [])
    .filter(member => member.action.startsWith('keep-'))
    .map(member => ({ name: entries[index]?.name ?? removal.managementId, path: member.path, reason: member.reason ?? member.action ?? removal.diagnostics?.map(diagnostic => diagnostic.message).filter(Boolean).join(' ') })));
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

function memberOutcome(entry, run) {
  if (entry.state === 'kept') return { name: entry.entry.name, state: 'kept', message: entry.message };
  if (entry.state === 'absent') return { name: entry.entry.name, state: 'absent', message: `${entry.entry.name}: absent` };
  const members = (run?.members ?? []).filter(member => member.managementId === entry.entry.managementId);
  const keptPaths = new Set(entry.files.filter(file => file.action.startsWith('keep-')).map(file => file.path));
  const keptReasons = entry.files.filter(file => file.action.startsWith('keep-')).map(file => file.reason).filter(Boolean);
  if (run?.completion === 'complete' && !members.length && keptPaths.size)
    return { name: entry.entry.name, state: 'kept', message: `${entry.entry.name}: kept${keptReasons.length ? ` (${keptReasons.join('; ')})` : ''}` };
  if (run?.completion === 'complete' && !members.length) return { name: entry.entry.name, state: 'absent', message: `${entry.entry.name}: absent` };
  if (run?.completion === 'complete' && members.length) {
    if (members.every(member => member.outcome === 'restored' && member.check === 'present-matching'))
      return { name: entry.entry.name, state: 'restored', message: `${entry.entry.name}: restored` };
    if (members.every(member => member.check === 'absent' || (member.outcome === 'restored' && member.check === 'present-matching') || (keptPaths.has(member.path) && member.outcome === 'kept'))) {
      const kept = members.some(member => keptPaths.has(member.path) && member.outcome === 'kept');
      if (kept) return { name: entry.entry.name, state: 'kept', message: `${entry.entry.name}: kept${keptReasons.length ? ` (${keptReasons.join('; ')})` : ''}` };
      const restored = members.some(member => member.outcome === 'restored');
      return { name: entry.entry.name, state: restored ? 'restored' : 'absent', message: `${entry.entry.name}: ${restored ? 'restored' : 'absent'}` };
    }
  }
  const reason = diagnosticWords(run);
  return { name: entry.entry.name, state: 'failed', message: `${entry.entry.name}: Core did not confirm absence or restoration.${reason ? ` ${reason}` : ''}` };
}

export async function confirmRemoval({ preview, request, mode }) {
  if (!preview.canConfirm || !preview.sessionId || !preview.review) {
    const results = preview.steps.map(step => ({ name: step.entry.name, state: step.state, message: step.message }));
    return { results, outcome: 'nothing-removed', message: results.map(result => result.message).join(' ') || 'Nothing was removed.' };
  }
  const prepare = () => request('remove', { removals: preview.selectors, scope: preview.scope, mode });
  const attempt = await applyIfUnchanged({ held: preview, prepare, readyPreparation, apply: approval => request('apply', approval) });
  if (attempt.state !== 'applied') {
    const reason = [attempt.reason, diagnosticWords(attempt.result?.preparation, attempt.result)].filter(Boolean).join(' ');
    const next = attempt.preparation && attempt.result ? present(preview.steps.map(step => step.entry), attempt.result) : undefined;
    return { results: [], outcome: 'failed', message: `Removal was not applied: ${reason || 'Core did not apply the reviewed removal.'}`,
      ...(next ? { next } : {}) };
  }
  const results = preview.steps.map(step => memberOutcome(step, attempt.run));
  const failed = results.some(result => result.state === 'failed');
  return { results, outcome: failed ? 'failed' : results.some(result => ['absent', 'restored'].includes(result.state)) ? 'removed' : 'nothing-removed',
    message: results.map(result => result.message).join(' ') };
}

export function cancelRemoval({ preview }) {
  return { outcome: 'nothing-removed', message: `Removal cancelled before Apply. ${preview.steps.map(step => `${step.entry.name}: not attempted`).join(' ')}` };
}

import { applyIfUnchanged, diagnosticWords } from './host-review.js';

const readyPreparation = result => result?.disposition === 'prepared' && ['ready', 'partial'].includes(result.preparation?.status) && result.preparation.sessionId && result.preparation.review
  ? result.preparation : undefined;

export async function previewUpdate({ entries, request, tool }) {
  const scope = entries[0]?.scope;
  const result = await request('update', { updates: entries.map(entry => ({ ...entry, managementId: entry.managementId, replacement: entry.replacement })), scope, tool });
  const preparation = readyPreparation(result);
  const steps = entries.map((entry, index) => {
    const update = result.updates?.[index];
    if (!update) return { entry, state: 'blocked', members: [], message: 'Core returned no update for this item.' };
    return { entry, state: update.disposition === 'prepared' ? 'ready' : 'blocked', members: update.members ?? [],
      from: update.from, to: update.to,
      message: update.disposition === 'prepared' ? `Replacement reviewed: ${update.to?.name ?? entry.name}.` : `Cannot update: ${diagnosticWords(update, result) || update.disposition}.` };
  });
  return { steps, canConfirm: Boolean(preparation) && !steps.some(step => step.state === 'blocked'),
    entries, scope, allowPartial: preparation?.status === 'partial', ...(preparation ? { sessionId: preparation.sessionId, review: preparation.review } : {}) };
}

function outcome(entry, step, run) {
  const members = (run?.members ?? []).filter(member => member.managementId === entry.managementId);
  const conflictPaths = new Set(step.members.filter(member => member.action === 'conflict').map(member => member.path));
  const reviewedConflictRun = run?.completion === 'incomplete' && members.length && members.every(member => conflictPaths.has(member.path)
    ? member.outcome === 'kept' : member.check === 'present-matching');
  if ((run?.completion === 'complete' || reviewedConflictRun) && members.length) {
    const states = members.map(member => {
      if (conflictPaths.has(member.path) || member.outcome === 'kept') return `${member.path}: kept${conflictPaths.has(member.path) ? ' (local edit conflict)' : ''}`;
      if (member.outcome === 'written' && member.check === 'present-matching') return `${member.path}: updated`;
      if (member.check === 'present-matching') return `${member.path}: unchanged`;
      if (member.check === 'absent') return `${member.path}: absent`;
      return null;
    });
    if (states.every(Boolean)) return { name: entry.name, state: states.some(state => state.endsWith('updated')) ? 'updated' : 'kept', message: `${entry.name}: ${states.join('; ')}` };
  }
  return { name: entry.name, state: 'failed', message: `${entry.name}: Core did not confirm the update members. ${diagnosticWords(run)}` };
}

export async function confirmUpdate({ preview, request, tool }) {
  if (!preview.canConfirm) return { outcome: 'failed', message: preview.steps.map(step => step.message).join(' ') };
  const prepare = () => request('update', { updates: preview.entries.map(entry => ({ ...entry, managementId: entry.managementId, replacement: entry.replacement })), scope: preview.scope, tool });
  const attempt = await applyIfUnchanged({ held: preview, prepare, readyPreparation, apply: approval => request('apply', { ...approval, purpose: 'update', ...(preview.allowPartial ? { allowPartial: true } : {}) }) });
  // Pending owner approval as contract amendment 3.2.3 row 25.
  if (attempt.state === 'unknown') return { outcome: 'unknown', message: `Update outcome unknown: ${diagnosticWords(attempt.run)}` };
  if (attempt.state !== 'applied') return { outcome: 'failed', message: `Update was not applied: ${[attempt.reason, diagnosticWords(attempt.result?.preparation, attempt.result)].filter(Boolean).join(' ')}` };
  const results = preview.entries.map((entry, index) => outcome(entry, preview.steps[index], attempt.run));
  return { results, outcome: results.some(result => result.state === 'failed') ? 'failed' : results.some(result => result.state === 'updated') ? 'updated' : 'kept', message: results.map(result => result.message).join(' ') };
}

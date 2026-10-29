// What Install and Remove share about a Core review: its files in plain words, what the person agreed to,
// Core's reasons as text, and the prepare-again → apply sequence that binds each Apply to the fresh review's
// own digest. Staleness is Core's call alone: a REVIEW_STALE diagnostic from Prepare or Apply is shown in
// Core's words and the person prepares again; the Workbench keeps no stale rule of its own (UI165).

const effectVerb = { 'create-file': 'Add', 'replace-file': 'Replace', 'update-file': 'Update', 'remove-file': 'Remove', 'already-satisfied': 'Already in place' };
export const IN_PLACE = effectVerb['already-satisfied'];

export const fileCount = count => `${count} ${count === 1 ? 'file' : 'files'}`;

/** "a", "a and b", "a, b and c". */
export const listNames = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Core's diagnostic messages as one line, each said once. */
export function diagnosticWords(...results) {
  const messages = results.flatMap(result => result?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean);
  return [...new Set(messages)].join(' ');
}

export function relativeTarget(target, project) {
  if (!target) return '';
  const windows = /^[a-z]:[\\/]/i.test(target) || /^[a-z]:[\\/]/i.test(project ?? '') || target.startsWith('\\\\') || (project ?? '').startsWith('\\\\');
  const normalized = target.replace(/\\/g, '/'), base = (project ?? '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  const fold = value => windows ? value.toLowerCase() : value;
  if (fold(normalized) === fold(base)) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return fold(normalized).startsWith(fold(prefix)) ? normalized.slice(prefix.length) : normalized;
}

/** Readable rows for every operation in a prepared review. */
export function installFiles(review) {
  const project = review?.target?.project;
  return (review?.operations ?? []).map(operation => ({
    action: effectVerb[operation.effects] ?? operation.purpose ?? operation.kind,
    path: relativeTarget(operation.details?.target, project) || operation.purpose || operation.id,
  }));
}

/**
 * Core's REVIEW_STALE reason from any stage's diagnostics, in Core's own words: what changed (a reviewed
 * binding, the prepared handle or a digest) and why. Undefined when Core reported none — a new Scan assessment
 * or changed release-index status alone never invalidates held preparation.
 */
export function staleReason(...results) {
  for (const result of results) {
    const diagnostic = (result?.diagnostics ?? []).find(entry => entry.code === 'REVIEW_STALE');
    if (!diagnostic) continue;
    const changed = diagnostic.changed?.reason ? ` (${diagnostic.changed.reason})` : '';
    return `${diagnostic.message ?? 'The reviewed setup changed.'}${changed}`;
  }
  return undefined;
}

/**
 * Applies the preparation the person actually saw and confirmed (`held`), so the approval binds to the
 * displayed review — never to unseen fresh work. Core alone compares the held handle against what is on
 * disk now:
 * - Core reports REVIEW_STALE: prepare fresh, hand its review back as {state:'stale'} so the caller shows
 *   it and requires a new confirmation.
 * - Core refuses the held handle for any other reason: prepare fresh and return {state:'not-ready'} with
 *   that preparation, so the caller shows a fresh review; nothing is applied.
 * - Otherwise the held run is the result.
 * `readyPreparation(result)` returns the prepared {sessionId, review} or undefined.
 * Returns {state:'not-ready', result, preparation?, reason?} | {state:'stale', preparation, reason, run?} |
 * {state:'superseded', preparation, run} | {state:'applied', preparation, run}.
 */
export async function applyIfUnchanged({ held, prepare, readyPreparation, apply }) {
  if (held?.sessionId && held?.review?.reviewDigest) {
    const run = await apply({ sessionId: held.sessionId, reviewDigest: held.review.reviewDigest });
    const reason = staleReason(run);
    if (!reason && run?.status !== 'refused' && run?.status !== 'superseded') return { state: 'applied', preparation: held, run };
    if (!reason && run?.status === 'superseded') return { state: 'superseded', preparation: held, run };
    if (!reason) {
      // The shown handle no longer applies (e.g. the session moved on): show a fresh review, ask again.
      const result = await prepare();
      const preparation = readyPreparation(result);
      return { state: 'not-ready', result, preparation, reason: `The shown review could not be applied: ${diagnosticWords(run) || run?.status || 'Core refused it.'}` };
    }
    // Core calls the shown review stale: prepare fresh, show its review, require a new confirmation.
    const result = await prepare();
    const preparation = readyPreparation(result);
    if (!preparation) return { state: 'not-ready', result, reason };
    return { state: 'stale', preparation, reason, run };
  }
  // Defensive: nothing was shown, so nothing may be applied; prepare for display only.
  const result = await prepare();
  const preparation = readyPreparation(result);
  if (!preparation) return { state: 'not-ready', result };
  return { state: 'stale', preparation, reason: 'No reviewed preparation was shown.' };
}

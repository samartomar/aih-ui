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
  const lower = target.toLowerCase(), base = project?.toLowerCase();
  const inside = base && lower.startsWith(base) ? target.slice(project.length).replace(/^[\\/]+/, '') : target;
  return inside.replace(/\\/g, '/');
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
 * Prepares again and applies with the fresh review's own digest. Core itself refuses or marks stale what
 * changed; the caller shows the fresh review again when Core reports REVIEW_STALE.
 * `readyPreparation(result)` returns the prepared {sessionId, review} or undefined.
 * Returns {state:'not-ready', result} | {state:'stale', preparation, reason, run?} | {state:'applied', preparation, run}.
 */
export async function applyIfUnchanged({ prepare, readyPreparation, apply }) {
  const result = await prepare();
  const preparation = readyPreparation(result);
  if (!preparation) return { state: 'not-ready', result };
  const reason = staleReason(result, preparation);
  if (reason) return { state: 'stale', preparation, reason };
  const run = await apply({ sessionId: preparation.sessionId, reviewDigest: preparation.review.reviewDigest });
  const stale = staleReason(run);
  if (stale) return { state: 'stale', preparation, reason: stale, run };
  return { state: 'applied', preparation, run };
}

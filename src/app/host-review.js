// What Install and Remove share about a Core review: its files in plain words, what the person agreed to,
// Core's reasons as text, and the prepare-again → compare → apply sequence that binds each Apply to the
// fresh review's own digest.

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
 * What the person agreed to: each operation's kind, effect, target and expected content. Core's
 * review digest differs on every Prepare even for identical effects, so it cannot be compared across two.
 */
export function effectsFingerprint(review) {
  return JSON.stringify((review?.operations ?? []).map(operation => [operation.kind, operation.effects, operation.details?.target ?? null,
    (operation.checks ?? []).map(check => check.details?.content ?? null)]));
}

/**
 * Prepares again and applies only if the fresh review has the effects that were shown.
 * `readyPreparation(result)` returns the prepared {sessionId, review} or undefined.
 * Returns {state: 'not-ready', result} | {state: 'changed', preparation} | {state: 'applied', preparation, run}.
 */
export async function applyIfUnchanged({ prepare, readyPreparation, shown, apply }) {
  const result = await prepare();
  const preparation = readyPreparation(result);
  if (!preparation) return { state: 'not-ready', result };
  if (effectsFingerprint(preparation.review) !== shown) return { state: 'changed', preparation };
  const run = await apply({ sessionId: preparation.sessionId, reviewDigest: preparation.review.reviewDigest });
  return { state: 'applied', preparation, run };
}

// Remove, in two steps, through Core's managed removal: preview what each item's removal takes, then remove
// them one at a time in the order given, each prepared again and applied with its own review digest. Core
// decides what may go; an item it retains is reported in words. Only a complete, verified Apply is "removed";
// a complete Apply whose operations Core left unverified is said as deleted but unverified.

import { effectsFingerprint, installFiles } from './install-panel.js';

const files = count => `${count} ${count === 1 ? 'file' : 'files'}`;
const reasons = result => [...new Set((result?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean))].join(' ');
const and = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const KEPT = 'Core says another installed item still requires it.';

/** Why Core did not prepare a removal, in words. */
function refused(result) {
  const why = reasons(result);
  const said = {
    'reconcile-required': 'needs reconciling by hand: Core found files it cannot safely remove.',
    unavailable: 'cannot be removed here: Core could not read what is installed.',
    invalid: 'cannot be removed: Core refused the request.',
    cancelled: 'was not removed: the check was cancelled.',
  }[result?.disposition] ?? `was not removed: ${result?.preparation?.status ?? result?.status ?? 'Core returned no removal'}.`;
  return why ? `${said} ${why}` : said;
}
const ready = result => result?.disposition === 'prepared' && result.preparation?.status === 'ready' && result.preparation.sessionId && result.preparation.review;
const allRemovals = review => (review?.operations ?? []).every(operation => operation.effects === 'remove-file');

/** The outcome of a removal Apply. Only a complete run with every reviewed file applied and verified counts. */
export function removalOutcome(run, rows) {
  if (!run) return { ok: false, message: 'did not return a result' };
  const operations = run.operations ?? [];
  const applied = operations.filter(operation => ['applied', 'already-satisfied'].includes(operation.application)).length;
  const verified = operations.filter(operation => operation.verification?.status === 'passed').length;
  const total = Math.max(operations.length, rows.length);
  if (run.completion === 'complete' && total && applied === total && verified === total) return { ok: true };
  // Core's removal operations carry no checks: a finished run says each file was deleted but leaves it unverified.
  const unchecked = operations.filter(operation => operation.verification?.status === 'unverified').length;
  if (run.completion === 'complete' && total && applied === total && verified + unchecked === total) return { ok: false, unverified: true };
  const why = reasons(run);
  return { ok: false, message: `did not finish: ${applied} of ${total} removed, ${verified} verified.${why ? ` ${why}` : ''}` };
}

/**
 * Prepares removal of each entry ({name, managementId, scope, memberCount}) without applying anything.
 * An entry Core retains while an earlier entry is still to be removed is checked again after it ('after').
 */
export async function previewRemoval({ entries, host, mode }) {
  const steps = [];
  for (const entry of entries) {
    const pending = steps.filter(step => ['ready', 'after'].includes(step.state));
    const result = await host('remove', { managementId: entry.managementId, scope: entry.scope, mode });
    if (result?.status === 'superseded') { steps.push({ entry, state: 'blocked', message: 'The page changed while checking. Click Remove again.' }); break; }
    if (ready(result)) {
      const review = result.preparation.review;
      steps.push({ entry, state: 'ready', files: installFiles(review), fingerprint: effectsFingerprint(review), message: `${files(review.operations.length)} will be removed.` });
    } else if (result?.disposition === 'retained' && pending.length) {
      steps.push({ entry, state: 'after', files: [], message: `${files(entry.memberCount ?? 0)}. Core checks this after ${and(pending.map(step => step.entry.name))} ${pending.length === 1 ? 'is' : 'are'} removed.` });
    } else if (result?.disposition === 'retained') steps.push({ entry, state: 'kept', files: [], message: `Kept: ${KEPT}` });
    else if (result?.disposition === 'absent') steps.push({ entry, state: 'absent', files: [], message: 'Already gone; nothing to remove.' });
    else steps.push({ entry, state: 'blocked', files: [], message: refused(result) });
  }
  const canConfirm = steps.some(step => step.state === 'ready') && !steps.some(step => step.state === 'blocked');
  return { steps, canConfirm };
}

/** Removes the previewed entries in order. Stops at the first failure, change or superseded request. */
export async function confirmRemoval({ preview, host, mode }) {
  const results = [];
  let stopped = false;
  for (const step of preview.steps) {
    const { name } = step.entry;
    if (stopped) { results.push({ name, state: 'not-attempted' }); continue; }
    if (step.state === 'kept' || step.state === 'absent') { results.push({ name, state: step.state, message: step.message }); continue; }
    const stop = (state, message) => { results.push({ name, state, message }); stopped = true; };
    // Prepare again so the approval is for what is on disk now.
    const fresh = await host('remove', { managementId: step.entry.managementId, scope: step.entry.scope, mode });
    if (fresh?.status === 'superseded') { stop('superseded', `${name} was not removed: the page changed before it was. Check the list.`); continue; }
    if (fresh?.disposition === 'absent') { results.push({ name, state: 'absent', message: 'Already gone; nothing to remove.' }); continue; }
    if (fresh?.disposition === 'retained') { results.push({ name, state: 'kept', message: KEPT }); continue; }
    if (!ready(fresh)) { stop('failed', `${name} ${refused(fresh)}`); continue; }
    const review = fresh.preparation.review;
    const matches = step.state === 'ready' ? effectsFingerprint(review) === step.fingerprint
      : allRemovals(review) && review.operations.length === step.entry.memberCount;
    if (!matches) { stop('changed', `${name} was not removed: its files changed since the list was shown (${files(review.operations.length)} now). Click Remove again to see them.`); continue; }
    const run = await host('apply', { sessionId: fresh.preparation.sessionId, reviewDigest: review.reviewDigest });
    if (run?.status === 'superseded') { stop('superseded', `For ${name} this page cannot tell whether files were removed; check the list.`); continue; }
    const outcome = removalOutcome(run, installFiles(review));
    if (outcome.ok) results.push({ name, state: 'removed' });
    else if (outcome.unverified) results.push({ name, state: 'unverified' });
    else stop('failed', `${name} ${outcome.message}`);
  }
  return { results, message: summary(results) };
}

function summary(results) {
  const named = state => results.filter(result => result.state === state).map(result => result.name);
  const removed = named('removed'), unverified = named('unverified'), kept = named('kept'), gone = named('absent'), skipped = named('not-attempted');
  const problem = results.find(result => ['failed', 'changed', 'superseded'].includes(result.state));
  const deleted = unverified.length ? `Core deleted the files of ${and(unverified)} but did not verify the removal. Check the list below.` : '';
  return [removed.length ? `Removed ${and(removed)}.` : deleted ? '' : 'Nothing was removed.', deleted,
    kept.length ? `Kept ${and(kept)}: ${KEPT}` : '', gone.length ? `${and(gone)} ${gone.length === 1 ? 'was' : 'were'} already gone.` : '',
    problem?.message ?? '', skipped.length ? `Not removed: ${and(skipped)}.` : ''].filter(Boolean).join(' ');
}

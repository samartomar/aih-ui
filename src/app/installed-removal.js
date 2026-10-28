// Remove, in two steps, through Core's managed removal: preview what each item's removal takes, then remove
// them one at a time in the order given, each prepared again and applied with its own review digest. A needed
// item Core holds until the items before it are gone has its own files shown and confirmed before it is removed.
// Core decides what may go; anything it keeps is said in words. Only a complete, verified Apply is "removed";
// a complete Apply whose operations Core left unverified is said as deleted but unverified.

import { applyIfUnchanged, diagnosticWords, fileCount, installFiles, listNames } from './host-review.js';

const STILL_NEEDED = 'Core says another installed item still needs it.';
// The page plans from the current setup's resolved needs; Core's answer also covers items outside it.
const KEEPS_NOTE = 'Core keeps anything another installed item still needs, including items outside your current setup, so some needed items may stay.';

// Every per-item state: whether its files are gone, and the words when the run stops on it.
const STATES = {
  removed: { gone: true },
  unverified: { gone: true },
  kept: { gone: false },
  absent: { gone: false },
  'not-attempted': { gone: false },
  failed: { gone: false, stops: true },
  changed: { gone: false, stops: true },
  superseded: { gone: false, stops: true },
};
const NOT_PREPARED = {
  'reconcile-required': 'needs reconciling by hand: Core found files it cannot safely remove.',
  unavailable: 'cannot be removed here: Core could not read what is installed.',
  invalid: 'cannot be removed: Core refused the request.',
  cancelled: 'was not removed: the check was cancelled.',
};

/** Why Core did not prepare a removal, in words. */
function notPrepared(result) {
  const said = NOT_PREPARED[result?.disposition] ?? `was not removed: ${result?.preparation?.status ?? result?.status ?? 'Core returned no removal'}.`;
  const why = diagnosticWords(result);
  return why ? `${said} ${why}` : said;
}
const preparedRemoval = result => result?.disposition === 'prepared' && result.preparation?.status === 'ready' && result.preparation.sessionId && result.preparation.review
  ? result.preparation : undefined;
const waitingMessage = pending => `Core checks this after ${listNames(pending.map(step => step.entry.name))} ${pending.length === 1 ? 'is' : 'are'} removed; its files are shown before it is removed.`;
// A later round names only the items still to be removed before a waiting one, not those already gone.
const rewordWaiting = steps => steps.map((step, index) => step.state === 'after'
  ? { ...step, message: waitingMessage(steps.slice(0, index).filter(before => ['ready', 'after'].includes(before.state))) } : step);
const shownStep = (entry, review) => ({ entry, state: 'ready', files: installFiles(review), message: `${fileCount(review.operations.length)} will be removed.` });

/** The outcome of a removal Apply: removed, unverified (complete but Core ran no check) or failed. */
export function removalOutcome(run, rows) {
  if (!run) return { state: 'failed', message: 'did not return a result.' };
  const operations = run.operations ?? [];
  const applied = operations.filter(operation => ['applied', 'already-satisfied'].includes(operation.application)).length;
  const verified = operations.filter(operation => operation.verification?.status === 'passed').length;
  const unchecked = operations.filter(operation => operation.verification?.status === 'unverified').length;
  const total = Math.max(operations.length, rows.length);
  const finished = run.completion === 'complete' && total && applied === total;
  if (finished && verified === total) return { state: 'removed' };
  if (finished && verified + unchecked === total) return { state: 'unverified' };
  const why = diagnosticWords(run);
  return { state: 'failed', message: `did not finish: ${applied} of ${total} removed, ${verified} verified.${why ? ` ${why}` : ''}` };
}

/**
 * Prepares removal of each entry ({name, managementId, scope}) without applying anything.
 * An entry Core retains while an earlier entry is still to be removed is shown after it ('after').
 */
export async function previewRemoval({ entries, request, mode }) {
  const steps = [];
  for (const entry of entries) {
    const pending = steps.filter(step => ['ready', 'after'].includes(step.state));
    const result = await request('remove', { managementId: entry.managementId, scope: entry.scope, mode });
    const preparation = preparedRemoval(result);
    if (result?.status === 'superseded') { steps.push({ entry, state: 'blocked', files: [], message: 'The page changed while checking. Click Remove again.' }); break; }
    if (preparation) steps.push(shownStep(entry, preparation.review));
    else if (result?.disposition === 'retained' && pending.length) {
      steps.push({ entry, state: 'after', files: [], message: waitingMessage(pending) });
    } else if (result?.disposition === 'retained') steps.push({ entry, state: 'kept', files: [], message: `Kept: ${STILL_NEEDED}` });
    else if (result?.disposition === 'absent') steps.push({ entry, state: 'absent', files: [], message: 'Already gone; nothing to remove.' });
    else steps.push({ entry, state: 'blocked', files: [], message: notPrepared(result) });
  }
  const canConfirm = steps.some(step => step.state === 'ready') && !steps.some(step => step.state === 'blocked');
  return { steps, canConfirm, note: KEEPS_NOTE };
}

/**
 * Removes the previewed entries in order, adding to `results` from earlier rounds. Stops at the first failure,
 * change or superseded request. Pauses at a needed item whose files were not shown yet: `next` is the preview
 * that shows them, to be confirmed again.
 */
export async function confirmRemoval({ preview, request, mode, results: earlier = [] }) {
  const results = [...earlier];
  const remaining = [...preview.steps];
  while (remaining.length) {
    const step = remaining.shift(), { name } = step.entry;
    const stop = (state, message) => { results.push({ name, state, message }); results.push(...remaining.map(rest => ({ name: rest.entry.name, state: 'not-attempted' }))); remaining.length = 0; };
    if (step.state === 'kept' || step.state === 'absent') { results.push({ name, state: step.state, message: step.message }); continue; }
    const removal = () => request('remove', { managementId: step.entry.managementId, scope: step.entry.scope, mode });
    if (step.state === 'after') {
      // Its files were not shown: show what Core would remove now and ask again.
      const fresh = await removal(), preparation = preparedRemoval(fresh);
      if (preparation) return finish(results, { steps: rewordWaiting([shownStep(step.entry, preparation.review), ...remaining]), canConfirm: true, note: preview.note }, name);
      if (fresh?.disposition === 'retained') { results.push({ name, state: 'kept', message: STILL_NEEDED }); continue; }
      if (fresh?.disposition === 'absent') { results.push({ name, state: 'absent' }); continue; }
      stop(fresh?.status === 'superseded' ? 'superseded' : 'failed', fresh?.status === 'superseded' ? `${name} was not removed: the page changed before it was. Check the list.` : `${name} ${notPrepared(fresh)}`);
      continue;
    }
    // Prepare again so the approval is for what is on disk now; Core itself decides what is stale.
    const attempt = await applyIfUnchanged({ prepare: removal, readyPreparation: preparedRemoval, apply: approval => request('apply', approval) });
    if (attempt.state === 'not-ready') {
      const fresh = attempt.result;
      if (fresh?.status === 'superseded') stop('superseded', `${name} was not removed: the page changed before it was. Check the list.`);
      else if (fresh?.disposition === 'absent') results.push({ name, state: 'absent' });
      else if (fresh?.disposition === 'retained') results.push({ name, state: 'kept', message: STILL_NEEDED });
      else stop('failed', `${name} ${notPrepared(fresh)}`);
    } else if (attempt.state === 'stale') {
      stop('changed', `${name} was not removed: ${attempt.reason} Click Remove again to see what its removal takes now.`);
    } else if (attempt.run?.status === 'superseded') stop('superseded', `For ${name} this page cannot tell whether files were removed; check the list.`);
    else {
      const outcome = removalOutcome(attempt.run, installFiles(attempt.preparation.review));
      if (outcome.state === 'failed') stop('failed', `${name} ${outcome.message}`);
      else results.push({ name, state: outcome.state });
    }
  }
  return finish(results);
}

/** Stops future rounds without undoing results from the confirmations already completed. */
export function cancelRemoval({ preview, results }) {
  const stopped = finish([...results, ...preview.steps.map(step => ({ name: step.entry.name, state: 'not-attempted' }))]);
  return { ...stopped, message: `Removal stopped. ${stopped.message}` };
}

function finish(results, next, waitingFor) {
  const named = state => results.filter(result => result.state === state).map(result => result.name);
  const removed = named('removed'), unverified = named('unverified'), kept = named('kept'), gone = named('absent'), skipped = named('not-attempted');
  const problem = results.find(result => STATES[result.state]?.stops);
  const anyGone = results.some(result => STATES[result.state]?.gone);
  const message = [removed.length ? `Removed ${listNames(removed)}.` : '',
    unverified.length ? `Core deleted the files of ${listNames(unverified)} but did not verify the removal. Check the list below.` : '',
    anyGone || next ? '' : 'Nothing was removed.',
    kept.length ? `Kept ${listNames(kept)}: ${STILL_NEEDED}` : '', gone.length ? `${listNames(gone)} ${gone.length === 1 ? 'was' : 'were'} already gone.` : '',
    problem?.message ?? '', skipped.length ? `Not removed: ${listNames(skipped)}.` : '',
    waitingFor ? `Check the files of ${waitingFor}, then confirm again.` : ''].filter(Boolean).join(' ');
  const outcome = next ? 'needs-confirm' : problem ? 'failed' : !anyGone ? 'nothing-removed' : unverified.length ? 'unverified' : 'removed';
  return { results, message, outcome, ...(next ? { next } : {}) };
}

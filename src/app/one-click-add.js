/*
 * Add in one click (owner decision 6): a card's Add proposes the item through the client, and when the composition
 * validator and Core return the proposal with nothing to decide, accepts it at once. The proposal and Accept stay the
 * client's own; this only decides whether a person needs to review the proposal first.
 *
 *   added       accepted: the item and the items it needs are in the setup
 *   review      the host returned diagnostics with the proposal; it is left pending for the person to review
 *   refused     the validator or Core refused; nothing changed
 *   superseded  another change started first; nothing was accepted
 */
import { dependencyRows } from './dependency-set.js';

const key = ({ releaseSha256, itemId, scope }) => JSON.stringify([releaseSha256, itemId, scope]);

const itemOf = (items, ref) => items.find(item => item.id === ref.itemId && item.root?.releaseSha256 === ref.releaseSha256);

/** Every item this chosen item needs in the proposal, by its label in the installed catalog (else its id), without the item itself. */
function neededOf(candidate, chosen, items) {
  const refs = candidate.envelopeBytes
    ? (candidate.roots.find(value => key(value) === key(chosen))?.dependencies ?? []).filter(value => key(value) !== key(chosen))
    : dependencyRows({ roots: [chosen], inclusions: candidate.inclusions ?? [] })[0].dependencies.map(({ item }) => item);
  return refs.map(ref => itemOf(items, ref)?.label ?? ref.itemId);
}

const said = values => new Set((values ?? []).map(value => JSON.stringify(value)));
// Anything new the host said about the proposal is for the person to read before it is accepted. An open draft
// already carries the availability gaps of its other choices; only a diagnostic it did not carry before, or the
// chosen item itself not resolving, needs review there.
function needsReview(result, candidate, chosen, before) {
  if (result.diagnostics?.length) return true;
  if (!candidate.envelopeBytes) return Boolean(result.value?.diagnostics?.length);
  const known = said(before?.diagnostics);
  if ((candidate.diagnostics ?? []).some(value => !known.has(JSON.stringify(value)))) return true;
  return chosen !== null && candidate.roots.find(value => key(value) === key(chosen))?.status !== 'resolved';
}

/** Proposes adding the item; accepts it when the host returned it with nothing to decide. */
export async function addItem(client, item) {
  const chosen = item.root, before = client.draft, result = await client.propose({ type: 'select', root: chosen });
  if (result.status === 'superseded') return { status: 'superseded', result };
  if (result.status !== 'ok') return { status: 'refused', result };
  const candidate = client.candidate;
  if (!candidate) return { status: 'superseded', result };
  if (needsReview(result, candidate, chosen, before)) return { status: 'review', result };
  const needed = neededOf(candidate, chosen, client.catalog?.items ?? []);
  client.accept();
  return { status: 'added', result, root: chosen, needed, draft: Boolean(candidate.envelopeBytes) };
}

const SHOWN = 3;
/** The confirmation shown after a clean Add: the chosen item and the items it needs (the first few by name). */
export function addedMessage({ name, needed = [], draft = false }) {
  const names = needed.length > SHOWN ? [...needed.slice(0, SHOWN), '…'] : needed;
  const it = needed.length ? ` + ${needed.length} it needs (${names.join(', ')})` : '';
  return draft ? `Added ${name}${it} to your draft. Save the draft to keep it.` : `Added ${name}${it} to your setup.`;
}

const refOf = ({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope });

/** Takes a chosen item back out of the setup through the same remove-root proposal and acceptance the drawer uses. */
export async function undoAdd(client, chosen) {
  const before = client.draft, current = (before?.roots ?? client.intent?.roots ?? []).find(value => key(value) === key(chosen));
  if (!current) return { status: 'refused', result: { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: `${chosen.itemId} is no longer in your setup.` }] } };
  const result = await client.propose({ type: 'remove-root', root: before ? refOf(current) : current, keep: [] });
  if (result.status === 'superseded') return { status: 'superseded', result };
  if (result.status !== 'ok') return { status: 'refused', result };
  const candidate = client.candidate;
  if (!candidate) return { status: 'superseded', result };
  if (needsReview(result, candidate, null, before)) return { status: 'review', result };
  client.accept();
  return { status: 'removed', result };
}

/** The root in the setup (or the open draft) for a catalog item, by its id and release, or undefined when it is not chosen. */
export function chosenRoot(client, item) {
  return (client.draft?.roots ?? client.intent?.roots ?? []).find(root => root.itemId === item?.id && root.releaseSha256 === item?.root?.releaseSha256);
}

/**
 * Remove on a chosen item's card (#144): the same remove-root proposal and acceptance as Undo after Add and the panel's
 * Remove from setup. A removal is `removed` with the root taken out (its configuration kept, so Undo can add it back).
 */
export async function removeItem(client, item) {
  const root = chosenRoot(client, item);
  if (!root) return { status: 'refused', result: { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: `${item?.id} is no longer in your setup.` }] } };
  const outcome = await undoAdd(client, root);
  return outcome.status === 'removed' ? { ...outcome, root } : outcome;
}

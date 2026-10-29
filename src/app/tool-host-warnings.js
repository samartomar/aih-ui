// What Core's inspectToolHost saw about second copies, in plain words. Core alone observes the tool's
// copies; the Workbench only projects the result and never decides what counts as a duplicate (#163).
// An unavailable or failed check always says it could not check — it never implies there is no second copy.

const WHERE = { user: 'your user folder', 'parent-folder': 'a parent folder', plugin: "this tool's plugin folder" };

/** Every second-copy warning Core reported, [{ itemId, key, where, path }]. */
export function secondCopyWarnings(host) {
  if (!['complete', 'incomplete'].includes(host?.status)) return [];
  return (host.warnings ?? []).filter(warning => warning.code === 'same-key-elsewhere')
    .map(warning => ({ itemId: warning.item?.itemId, key: warning.key, where: warning.where, path: warning.path }));
}

/**
 * The check's own state: 'loading' (no answer yet), 'unavailable' (no project folder, nothing chosen,
 * this Core publishes no host inspection, or a requested per-item copy fact is unavailable), 'failed'
 * (the check itself broke), 'empty' (checked, nothing chosen) or 'checked'. Warnings remain visible even
 * when another portion of the inspection is unavailable; only a complete observation may claim no copy.
 */
export function hostCopiesState(host, itemId) {
  if (!host) return { state: 'loading' };
  if (host.status === 'unavailable') return { state: 'unavailable', reason: host.reason };
  if (['failed', 'invalid', 'refused', 'cancelled'].includes(host.status)) return { state: 'failed', reason: host.reason ?? host.status };
  const all = host.items ?? [];
  if (!all.length) return { state: 'empty' };
  const inspected = all.filter(item => itemId === undefined || item.itemId === itemId);
  const unavailable = inspected.flatMap(item => Object.values(item.copies ?? {})).find(copy => copy.state === 'unavailable');
  if (unavailable) return { state: 'unavailable', reason: unavailable.reason };
  return { state: 'checked' };
}

const COULD_NOT = "Couldn't check whether your tool already has this.";
const warningWords = warnings => warnings.map(warning => `Second copy: ${warning.key} is also in ${WHERE[warning.where] ?? warning.where} (${warning.path}).`).join(' ');

/**
 * One item's second-copy line for card, inspector and drawer. `chosen` marks items in the inspected set;
 * an unchosen item was not checked, which is said rather than implied clean. Core's wording, never a
 * Workbench duplicate rule.
 */
export function copiesWords(host, itemId, { chosen = true } = {}) {
  const state = hostCopiesState(host, itemId);
  if (state.state === 'loading') return 'Checking whether your tool already has this…';
  const warning = warningWords(secondCopyWarnings(host).filter(warning => warning.itemId === itemId));
  if (state.state === 'unavailable' || state.state === 'failed') return [warning, `${COULD_NOT} ${state.reason ?? ''}`.trim()].filter(Boolean).join(' ');
  if (state.state === 'empty') return "Couldn't check: nothing is chosen yet.";
  if (!chosen) return "Couldn't check: only your chosen content is checked for a second copy.";
  if (!warning) return 'No second copy reported by your tool.';
  return warning;
}

/** The drawer line over everything chosen: the warnings, or the explicit not-checked wording. */
export function drawerCopiesWords(host) {
  const state = hostCopiesState(host);
  if (state.state === 'loading') return 'Checking whether your tool already has your chosen content…';
  const warning = warningWords(secondCopyWarnings(host));
  if (state.state === 'unavailable' || state.state === 'failed') return [warning, `${COULD_NOT} ${state.reason ?? ''}`.trim()].filter(Boolean).join(' ');
  if (state.state === 'empty') return "Couldn't check for a second copy: nothing is chosen yet.";
  if (!warning) return 'Your tool reported no second copies of your chosen content.';
  return warning;
}

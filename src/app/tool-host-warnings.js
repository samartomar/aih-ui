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
 * The check's own state: 'loading' (no answer yet), 'unavailable' (no project folder, nothing chosen, or
 * this Core publishes no host inspection), 'failed' (the check itself broke), 'empty' (checked, nothing
 * chosen) or 'checked'. Only 'checked' may say anything about copies.
 */
export function hostCopiesState(host) {
  if (!host) return { state: 'loading' };
  if (host.status === 'unavailable') return { state: 'unavailable', reason: host.reason };
  if (['failed', 'invalid', 'refused', 'cancelled'].includes(host.status)) return { state: 'failed', reason: host.reason ?? host.status };
  const inspected = host.items ?? [];
  if (!inspected.length) return { state: 'empty' };
  return { state: 'checked' };
}

const COULD_NOT = "Couldn't check whether your tool already has this.";

/**
 * One item's second-copy line for card, inspector and drawer. `chosen` marks items in the inspected set;
 * an unchosen item was not checked, which is said rather than implied clean. Core's wording, never a
 * Workbench duplicate rule.
 */
export function copiesWords(host, itemId, { chosen = true } = {}) {
  const state = hostCopiesState(host);
  if (state.state === 'loading') return 'Checking whether your tool already has this…';
  if (state.state === 'unavailable' || state.state === 'failed') return `${COULD_NOT} ${state.reason ?? ''}`.trim();
  if (state.state === 'empty') return "Couldn't check: nothing is chosen yet.";
  if (!chosen) return "Couldn't check: only your chosen content is checked for a second copy.";
  const mine = secondCopyWarnings(host).filter(warning => warning.itemId === itemId);
  if (!mine.length) return 'No second copy reported by your tool.';
  return mine.map(warning => `Second copy: ${warning.key} is also in ${WHERE[warning.where] ?? warning.where} (${warning.path}).`).join(' ');
}

/** The drawer line over everything chosen: the warnings, or the explicit not-checked wording. */
export function drawerCopiesWords(host) {
  const state = hostCopiesState(host);
  if (state.state === 'loading') return 'Checking whether your tool already has your chosen content…';
  if (state.state === 'unavailable' || state.state === 'failed') return `${COULD_NOT} ${state.reason ?? ''}`.trim();
  if (state.state === 'empty') return "Couldn't check for a second copy: nothing is chosen yet.";
  const warnings = secondCopyWarnings(host);
  if (!warnings.length) return 'Your tool reported no second copies of your chosen content.';
  return warnings.map(warning => `Second copy: ${warning.key} is also in ${WHERE[warning.where] ?? warning.where} (${warning.path}).`).join(' ');
}

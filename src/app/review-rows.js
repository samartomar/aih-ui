// Named rows for what the person approved, from Core's prepared work 1.6 review. The review's own
// selections name the rows; operations attach by their published selectionId, with preparation.operationSelections
// as the fallback linkage. Core diagnostics without a published row stay global, never invented per item (#165).

const words = diagnostic => diagnostic?.message ?? diagnostic?.code ?? '';

/**
 * [{ selectionId, managementId, scope, heading, item, tool, kind, sets, how, permissionStep, inputs, size,
 *   effects: [{ purpose, target, effect }], blockers: [Core's words] }], plus global: [Core's words].
 * `size` is the review's deliveredSize or null — null means Core reported no size, never zero.
 */
export function reviewRows(review, { operationSelections = [] } = {}) {
  const bySelection = new Map();
  for (const operation of review?.operations ?? []) {
    let selectionId = operation.selectionId ?? null;
    if (!selectionId) selectionId = operationSelections.find(link => link.operationId === operation.id)?.selectionId ?? null;
    if (!selectionId) continue; // Generated lifecycle cleanup names no selection; it stays out of item rows.
    bySelection.set(selectionId, [...(bySelection.get(selectionId) ?? []), operation]);
  }
  const rows = (review?.selections ?? []).map(row => {
    const operations = bySelection.get(row.selectionId) ?? [];
    const sets = (row.origins ?? []).map(origin => origin.set).filter(Boolean);
    const how = (row.origins ?? []).map(origin => origin.reasonIncluded === 'chosen' ? 'Chosen by you'
      : origin.reasonIncluded === 'required-by' ? `Required by ${origin.requiredBy?.itemId ?? 'another item'}` : '').filter(Boolean);
    return {
      selectionId: row.selectionId, managementId: row.managementId, scope: row.scope,
      heading: row.name ?? `Selection ${row.selectionId} (its recorded metadata is unavailable)`,
      item: row.item ?? null, tool: row.tool ?? null, kind: row.kind ?? null,
      sets, how,
      permissionStep: row.permissionStep ?? null,
      inputs: row.inputs ?? [],
      size: row.deliveredSize ?? null,
      hookCommands: row.hookCommands ?? [],
      effects: operations.map(operation => ({ purpose: operation.purpose, target: operation.details?.target ?? null, effect: operation.effects })),
      // Core's own words: conflict/unavailable effects and their reasons, verbatim.
      blockers: operations.filter(operation => operation.effects === 'conflict' || operation.effects === 'unavailable')
        .map(operation => words({ message: operation.details?.reason ? `${operation.purpose}: ${operation.details.reason}` : operation.purpose })),
    };
  });
  // Diagnostics the review publishes without per-row linkage stay global; nothing here associates by guessing.
  const global = [...(review?.conflicts ?? []), ...(review?.omissions ?? [])].map(words).filter(Boolean);
  return { rows, global };
}

/** Core's delivered-size line for one row; absent means unknown, never zero. */
export function sizeWords(size) {
  if (!size) return 'Size unknown: Core reported no delivered size for this item.';
  const used = `When used: ${size.bytes} bytes · ${size.chars} chars`;
  return size.alwaysLoaded ? `${used}; every session: ${size.alwaysLoaded.bytes} bytes · ${size.alwaysLoaded.chars} chars` : used;
}

/**
 * The guidance (user) folder this review writes, from the common directory of its user-scope operation
 * targets. Null when the setup writes no user-folder content — said explicitly, never guessed.
 */
export function guidanceFolder(review) {
  const targets = (review?.operations ?? []).filter(operation => operation.scope === 'user' && operation.details?.target)
    .map(operation => operation.details.target);
  if (!targets.length) return null;
  const dirs = targets.map(target => target.replace(/[\\/][^\\/]*$/, ''));
  // Common ancestry by whole path segments: a raw character prefix would claim '/home/u/.c' for
  // '/home/u/.claude' and '/home/u/.codex', which is not the folder written.
  const segments = value => value.split(/[\\/]/);
  const common = dirs.slice(1).reduce((prefix, dir) => {
    const a = segments(prefix), b = segments(dir);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i).join(targets[0].includes('\\') ? '\\' : '/');
  }, dirs[0]);
  // Preserve actual filesystem roots (Q10 residual): POSIX '/' and a drive root are folders, never null or
  // a drive-relative prefix; UNC ancestry keeps its leading double separator through the segment join.
  const absolute = targets.every(target => target.startsWith('/'));
  const joined = common === '' && absolute ? '/'
    : /^[A-Za-z]:$/.test(common) ? common + (targets[0].includes('\\') ? '\\' : '/')
    : common;
  const trimmed = joined.replace(/[\\/]+$/, '');
  return trimmed === '' && absolute ? '/' : /^[A-Za-z]:$/.test(trimmed) ? joined : trimmed || null;
}

// What is installed in the project folder. Names, kinds, tools and set origins come from Core's redacted
// managed-inventory 1.1 projection as recorded at install time — never from the current draft, so the list is
// the same after a restart and for items outside the setup. The needed-by relation and removal grouping still
// come from the compiled policy (each selection's `requires`, as Catalog resolved it). Nothing here decides a
// dependency, an update state or an admission state itself.

/** Selection ids in an order where every item comes before the items it requires. */
export function removalOrder(ids, byId) {
  const wanted = new Set(ids), done = new Set(), ordered = [];
  const visit = id => {
    if (done.has(id) || !wanted.has(id)) return;
    done.add(id);
    // Anything in the set that requires this one is removed first.
    for (const other of ids) if (byId.get(other)?.requires?.includes(id)) visit(other);
    ordered.push(id);
  };
  for (const id of ids) visit(id);
  return ordered;
}

function closure(id, byId, seen = new Set()) {
  for (const next of byId.get(id)?.requires ?? []) if (!seen.has(next)) { seen.add(next); closure(next, byId, seen); }
  return seen;
}

/** The redacted 1.1 per-selection states, straight from Core's projection; unknown stays unknown. */
export function inventoryState(entry) {
  // Distinct literal Core states stay distinct (Q8): a uniform block-changed/block-missing set is named
  // exactly; a mixed set degrades to the generic 'changed'.
  const fileStates = (entry.members ?? []).map(member => member.fileState);
  const differing = ['changed', 'missing', 'block-changed', 'block-missing'].filter(state => fileStates.includes(state));
  const file = differing.length === 1 ? differing[0]
    : differing.length ? 'changed'
    : fileStates.includes('unchecked') ? 'unchecked'
    : fileStates.length ? 'matches' : 'unknown';
  return {
    file,
    update: entry.updateState ?? 'unknown',
    policy: entry.policyState ?? null,
    approval: entry.approval ?? null,
    install: entry.installState ?? null,
  };
}

/** Every in-set origin a selection recorded, all simultaneous memberships retained. */
export const recordedSets = entry => (entry.origins ?? []).map(origin => origin.set).filter(Boolean);

/**
 * Grouping by the recorded set origins of the installed selections, independent of any draft. Selections with
 * no recorded set origin (legacy metadata or direct installs) fall under `set: null`, said explicitly.
 */
export function originGroups(inventory) {
  const groups = new Map();
  for (const entry of inventory?.selections ?? []) {
    const sets = recordedSets(entry);
    if (!sets.length) {
      const key = 'null';
      if (!groups.has(key)) groups.set(key, { set: null, items: [] });
      groups.get(key).items.push(entry.managementId);
    }
    for (const set of sets) {
      // Exact set provenance identity includes the set digest (Q7): distinct recorded revisions never merge.
      const key = `${set.framework}/${set.setId}/${set.setSha256}`;
      if (!groups.has(key)) groups.set(key, { set, items: [] });
      if (!groups.get(key).items.includes(entry.managementId)) groups.get(key).items.push(entry.managementId);
    }
  }
  return [...groups.values()];
}

/**
 * {readable, reason?, partial, groups, others, notInstalled, setupInstalled}
 * groups: one per installed chosen item: {name, itemId, managementId, scope, needed, removes, kept}
 * removes: what its Remove takes, in removal order; kept: needed items another installed chosen item still needs,
 * each with `neededBy`, the names of those chosen items.
 */
export function groupInstalled({ inventory, policy, intent, label = () => undefined }) {
  if (!inventory || !['complete', 'incomplete'].includes(inventory.status)) {
    const reason = (inventory?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
    return { readable: false, reason: reason || 'Core did not return the installed list.', partial: true, groups: [], others: [], notInstalled: [], setupInstalled: false };
  }
  const installed = new Map(inventory.selections.map(entry => [entry.managementId, entry]));
  const itemByRecipe = new Map((intent?.pins ?? []).map(entry => [entry.recipe?.sha256, entry.itemId]));
  const byId = new Map((policy?.selections ?? []).map(entry => [entry.id, entry]));
  // Recorded 1.1 projection wins for the name; the draft-derived recipe/pin lookup is only a fallback and
  // never changes what Core recorded.
  const describe = entry => {
    const itemId = itemByRecipe.get(entry.recipe?.reference?.sha256);
    const recorded = installed.get(entry.managementId);
    return { id: entry.id, itemId, managementId: entry.managementId, scope: entry.scope,
      name: recorded?.name ?? (itemId && label(itemId)) ?? itemId ?? entry.managementId };
  };
  const withState = item => ({ ...item, state: inventoryState(installed.get(item.managementId) ?? {}) });
  const rootIds = new Set((intent?.roots ?? []).map(root => root.itemId));
  const chosen = [...byId.values()].map(describe).filter(item => item.itemId && rootIds.has(item.itemId));
  const isInstalled = item => installed.has(item.managementId);
  const installedRoots = chosen.filter(isInstalled);
  const grouped = new Set();

  const groups = installedRoots.map(root => {
    const needed = removalOrder([...closure(root.id, byId)], byId).map(id => describe(byId.get(id))).filter(isInstalled);
    const othersNeed = new Set(installedRoots.filter(other => other.id !== root.id).flatMap(other => [other.id, ...closure(other.id, byId)]));
    const removable = [root, ...needed].filter(item => !othersNeed.has(item.id));
    const removes = removalOrder(removable.map(item => item.id), byId).map(id => removable.find(item => item.id === id));
    for (const item of [root, ...needed]) grouped.add(item.managementId);
    const neededBy = item => installedRoots.filter(other => other.id !== root.id && closure(other.id, byId).has(item.id)).map(other => other.name);
    return { ...withState(root), sets: recordedSets(installed.get(root.managementId) ?? {}),
      needed: needed.map(withState).map(item => ({ ...item, sets: recordedSets(installed.get(item.managementId) ?? {}) })),
      removes, kept: needed.filter(item => othersNeed.has(item.id)).map(item => ({ ...withState(item), neededBy: neededBy(item) })) };
  });

  const known = new Map([...byId.values()].map(entry => [entry.managementId, describe(entry)]));
  const others = inventory.selections.filter(entry => !grouped.has(entry.managementId)).map(entry => {
    const item = known.get(entry.managementId);
    return withState({ managementId: entry.managementId, scope: entry.scope,
      name: entry.name ?? item?.name ?? entry.managementId, inSetup: Boolean(item),
      sets: recordedSets(entry) });
  });
  // Core lists every selection of the current setup as installed (matching bytes alone do not show this).
  const setupInstalled = byId.size > 0 && [...byId.values()].every(entry => installed.has(entry.managementId));
  return { readable: true, partial: inventory.status !== 'complete', groups, others, notInstalled: chosen.filter(item => !isInstalled(item)), setupInstalled,
    // Grouping purely from recorded origins, independent of the draft; legacy rows stay explicit under set:null.
    originGroups: originGroups(inventory) };
}

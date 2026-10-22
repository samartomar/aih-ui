// What is installed in the project folder, grouped by the item the person chose. The list comes from Core's
// managed inventory; names and the needed-by relation come from the policy this page compiled (each selection's
// `requires`, as Catalog resolved it) and the saved intent's pins. Nothing here decides a dependency itself.

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

/**
 * {readable, reason?, partial, groups, others, notInstalled}
 * groups: one per installed chosen item: {name, itemId, managementId, scope, needed, removes, kept}
 * removes: what its Remove takes, in removal order; kept: needed items another installed chosen item still needs,
 * each with `neededBy`, the names of those chosen items.
 */
export function groupInstalled({ inventory, policy, intent, label = () => undefined }) {
  if (!inventory || !['complete', 'incomplete'].includes(inventory.status)) {
    const reason = (inventory?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
    return { readable: false, reason: reason || 'Core did not return the installed list.', partial: true, groups: [], others: [], notInstalled: [] };
  }
  const installed = new Map(inventory.selections.map(entry => [entry.managementId, entry]));
  const itemByRecipe = new Map((intent?.pins ?? []).map(entry => [entry.recipe?.sha256, entry.itemId]));
  const byId = new Map((policy?.selections ?? []).map(entry => [entry.id, entry]));
  const describe = entry => {
    const itemId = itemByRecipe.get(entry.recipe?.reference?.sha256);
    return { id: entry.id, itemId, managementId: entry.managementId, scope: entry.scope, name: (itemId && label(itemId)) ?? itemId ?? entry.managementId };
  };
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
    return { ...root, needed, removes, kept: needed.filter(item => othersNeed.has(item.id)).map(item => ({ ...item, neededBy: neededBy(item) })) };
  });

  const known = new Map([...byId.values()].map(entry => [entry.managementId, describe(entry)]));
  const others = inventory.selections.filter(entry => !grouped.has(entry.managementId)).map(entry => {
    const item = known.get(entry.managementId);
    return { managementId: entry.managementId, scope: entry.scope, name: item?.name ?? entry.managementId, inSetup: Boolean(item) };
  });
  return { readable: true, partial: inventory.status !== 'complete', groups, others, notInstalled: chosen.filter(item => !isInstalled(item)) };
}

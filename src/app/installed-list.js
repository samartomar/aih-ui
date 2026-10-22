// What is installed in the project folder, grouped by the item the person chose. The list comes from Core's
// managed inventory; names and the needed-by relation come from the policy this page compiled (each selection's
// `requires`, as Catalog resolved it) and the saved intent's pins. Nothing here decides a dependency itself.
//
// An installed item outside the setup is named by the Catalog item whose Workbench-built id (management-id.js: scope,
// package and item id) is the installed id, when exactly one name maps to it. Otherwise it gets a short name, the
// last segment of its id, for display only; the full id stays on the entry (`managementId`). Core does not yet say
// what each installed selection is (samartomar/aih-core#90).

import { managementIdOf } from './management-id.js';

/** A short, readable name for an id no known item maps to: its last segment. Display only; never used to match. */
export function shortName(managementId) {
  return String(managementId).split(/--|\./).filter(Boolean).at(-1) ?? String(managementId);
}

/** Catalog items keyed by the id the Workbench gives each at `scope`; an id two names map to is left out. */
function catalogNames(items, scope) {
  const names = new Map(), clash = new Set();
  for (const item of items ?? []) {
    const packageName = item?.package?.name;
    if (typeof packageName !== 'string' || typeof item.id !== 'string') continue;
    const id = managementIdOf({ scope, packageName, itemId: item.id }), name = String(item.label ?? item.id), prior = names.get(id);
    if (prior && prior.name !== name) clash.add(id);
    else names.set(id, { name, family: item.family });
  }
  for (const id of clash) names.delete(id);
  return names;
}

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
 * {readable, reason?, partial, groups, others, notInstalled, setupInstalled}
 * groups: one per installed chosen item: {name, itemId, managementId, scope, needed, removes, kept}
 * removes: what its Remove takes, in removal order; kept: needed items another installed chosen item still needs,
 * each with `neededBy`, the names of those chosen items.
 */
export function groupInstalled({ inventory, policy, intent, label = () => undefined, items = [] }) {
  if (!inventory || !['complete', 'incomplete'].includes(inventory.status)) {
    const reason = (inventory?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
    return { readable: false, reason: reason || 'Core did not return the installed list.', partial: true, groups: [], others: [], notInstalled: [], setupInstalled: false };
  }
  const installed = new Map(inventory.selections.map(entry => [entry.managementId, entry]));
  const itemByRecipe = new Map((intent?.pins ?? []).map(entry => [entry.recipe?.sha256, entry.itemId]));
  const byId = new Map((policy?.selections ?? []).map(entry => [entry.id, entry]));
  const describe = entry => {
    const itemId = itemByRecipe.get(entry.recipe?.reference?.sha256);
    return { id: entry.id, itemId, managementId: entry.managementId, scope: entry.scope, name: (itemId && label(itemId)) ?? itemId ?? shortName(entry.managementId) };
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
  const byScope = new Map();
  const catalogName = entry => { if (!byScope.has(entry.scope)) byScope.set(entry.scope, catalogNames(items, entry.scope)); return byScope.get(entry.scope).get(entry.managementId); };
  const others = inventory.selections.filter(entry => !grouped.has(entry.managementId)).map(entry => {
    const item = known.get(entry.managementId);
    if (item) return { managementId: entry.managementId, scope: entry.scope, name: item.name, inSetup: true, known: true };
    const named = catalogName(entry);
    return { managementId: entry.managementId, scope: entry.scope, name: named?.name ?? shortName(entry.managementId), inSetup: false, known: Boolean(named), ...(named ? { family: named.family } : {}) };
  });
  // Core lists every selection of the current setup as installed (matching bytes alone do not show this).
  const setupInstalled = byId.size > 0 && [...byId.values()].every(entry => installed.has(entry.managementId));
  return { readable: true, partial: inventory.status !== 'complete', groups, others, notInstalled: chosen.filter(item => !isInstalled(item)), setupInstalled };
}

/*
 * Which items are in the setup only because a chosen item needs them, so Your choices can fold them under it. The
 * relation is only what Catalog resolved: each compiled selection's `requires` in the policy bytes, matched to the item
 * through the saved intent's pins, or, with a draft open, each recorded choice's resolved dependencies. Nothing here
 * decides one. A recipe-less selection (execution-policy 1.6.0) names its item as `{framework, itemId}`: it matches
 * the one pin of that itemId whose release the catalog `items` name as that framework. A legacy selection matches by recipe.
 */

const entryKey = ref => `${ref.releaseSha256}/${ref.itemId}`;

function readPolicy(policyBytes) {
  if (!policyBytes?.length) return undefined;
  try { return JSON.parse(new TextDecoder().decode(policyBytes)); } catch { return undefined; }
}

/**
 * Map of `<releaseSha256>/<itemId>` to the chosen roots that need that item (directly or through other needed items).
 * A chosen item appears only when another chosen item needs it.
 */
export function setupNeeds({ intent, policyBytes, draft, items = [] } = {}) {
  const needs = new Map();
  const add = (ref, root) => {
    if (entryKey(ref) === entryKey(root)) return;
    const list = needs.get(entryKey(ref)) ?? [];
    if (!list.some(value => entryKey(value) === entryKey(root))) list.push(root);
    needs.set(entryKey(ref), list);
  };
  if (draft) {
    for (const root of draft.roots ?? []) for (const ref of root.dependencies ?? []) add(ref, root);
    return needs;
  }
  const selections = readPolicy(policyBytes)?.selections;
  if (!intent || !Array.isArray(selections)) return needs;
  const pinBySha = new Map((intent.pins ?? []).map(pin => [pin.recipe?.sha256, pin]));
  const byId = new Map(selections.map(selection => [selection.id, selection]));
  const frameworkOf = new Map(items.filter(item => item.framework).map(item => [item.root?.releaseSha256, item.framework]));
  const pinOf = selection => {
    const item = selection?.item;
    const matches = item ? (intent.pins ?? []).filter(pin => pin.itemId === item.itemId && frameworkOf.get(pin.releaseSha256) === item.framework) : [];
    return matches.length === 1 ? matches[0] : pinBySha.get(selection?.recipe?.reference?.sha256);
  };
  for (const root of intent.roots ?? []) {
    const start = selections.find(selection => { const pin = pinOf(selection); return pin && entryKey(pin) === entryKey(root); });
    if (!start) continue;
    const seen = new Set([start.id]), queue = [...(start.requires ?? [])];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const selection = byId.get(id), pin = pinOf(selection);
      if (pin) add(pin, root);
      queue.push(...(selection?.requires ?? []));
    }
  }
  return needs;
}

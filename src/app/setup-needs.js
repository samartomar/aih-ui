/*
 * Which items are in the setup only because a chosen item (or a starting set) needs them (#134, folded into #135), so a
 * card can say so and offer no second Add. The relation is only what Catalog resolved: each compiled selection's
 * `requires` in the policy bytes, matched to the item through the saved intent's pins (the same reading as the
 * installed list), or, with a draft open, each recorded choice's resolved dependencies. Nothing here decides one.
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
export function setupNeeds({ intent, policyBytes, draft } = {}) {
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
  const pinOf = selection => pinBySha.get(selection?.recipe?.reference?.sha256);
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

/** The card's disabled button text for a needed item: "In your setup (needed by <chosen item or set>)". */
export function inSetupLabel(roots, label) {
  const names = roots.map(label);
  const by = names.length <= 2 ? names.join(' and ') : `${names[0]} and ${names.length - 1} more`;
  return `In your setup (needed by ${by})`;
}

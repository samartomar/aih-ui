const digest = /^[a-f0-9]{64}$/;
const exactItem = /^[a-f0-9]{64}\/(.+)$/;

export function savedCatalogChoices(value, ids) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(ids.flatMap(id => exactItem.test(id) && Object.hasOwn(value, id) &&
    typeof value[id] === 'string' && digest.test(value[id]) ? [[id, value[id]]] : []));
}

// This projection only checks browse rows. Every plan and policy still uses the exact saved IDs.
export function browseSelections(data, ids, previous) {
  const saved = savedCatalogChoices(previous, [...ids]);
  const items = new Map(data.items.map(item => [item.id, item]));
  const documents = new Map(data.frameworks.map(framework => [framework.id, framework.browseFingerprint]));
  const candidates = new Map();
  for (const item of items.values()) {
    const fingerprint = documents.get(item.framework);
    if (!fingerprint) continue;
    const key = `${fingerprint}/${item.itemId}`;
    const matches = candidates.get(key) ?? [];
    matches.push(item.id);
    candidates.set(key, matches);
  }
  const replacements = new Map();
  const ambiguous = new Set();
  for (const id of ids) {
    const item = items.get(id);
    if (item) {
      const fingerprint = documents.get(item.framework);
      if (fingerprint) saved[id] = fingerprint;
      else delete saved[id];
      continue;
    }
    const old = exactItem.exec(id);
    if (!old || !saved[id]) continue;
    const matches = candidates.get(`${saved[id]}/${old[1]}`);
    if (matches?.length !== 1 || ids.has(matches[0])) continue;
    const [current] = matches;
    if (replacements.has(current)) ambiguous.add(current);
    else replacements.set(current, id);
  }
  for (const current of ambiguous) replacements.delete(current);
  return { saved, replacements };
}

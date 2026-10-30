export function itemDisplayName(item, fallback) {
  const base = item?.name ?? item?.label ?? fallback ?? item?.id ?? '';
  const namespace = item?.payload?.namespace;
  return namespace && !base.endsWith(` (${namespace})`) ? `${base} (${namespace})` : base;
}

/**
 * What an item replaces, by name: this Catalog's name for an item it still lists, else the name Catalog recorded for
 * the replaced item, each once. Entries Catalog matched by content alone carry no name and are counted. Never an id.
 */
export function replacedNames(supersedes = [], items = []) {
  const names = [];
  let unnamed = 0;
  for (const entry of supersedes) {
    const current = items.find(item => item.id === entry.itemId);
    const name = current ? itemDisplayName({ ...current, name: current.display?.name ?? current.name ?? current.label }) : entry.name;
    if (!name) unnamed++; else if (!names.includes(name)) names.push(name);
  }
  // Pending owner approval as contract amendment 3.2.3 row 35.
  return unnamed ? [...names, `${unnamed} earlier item${unnamed === 1 ? '' : 's'}`] : names;
}

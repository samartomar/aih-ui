const key = ({ releaseSha256, itemId, scope }) => JSON.stringify([releaseSha256, itemId, scope]);

export function dependencyRows({ roots, inclusions = [] }) {
  return roots.map(root => {
    const seen = new Set([key(root)]), dependencies = [];
    for (const inclusion of inclusions) {
      if (key(inclusion.root) !== key(root) || seen.has(key(inclusion.item))) continue;
      seen.add(key(inclusion.item)); dependencies.push({ item: inclusion.item, kind: 'required' });
    }
    return { root, dependencies };
  });
}

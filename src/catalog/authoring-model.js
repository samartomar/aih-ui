// Presentation over checked public release items. Exact roots remain untouched.
export function projectItems(items) {
  return items.map(item => ({
    entryId: `${item.root.releaseSha256}/${item.id}`, authoringItem: item,
    subject: { id: item.id, kind: item.kind, source: subjectSource(item) },
  }));
}
// A GitHub source's items (#125) carry the exact repository, commit and the folder of their SKILL.md, as Catalog compiled them.
export function subjectSource(item) {
  const origin = item.sources?.[0]?.origin;
  if (item.family === 'Personal' && origin?.kind === 'git' && typeof origin.repository === 'string') {
    const path = item.metadata?.sourceFacts?.provenance?.path;
    return { type: 'github', repository: origin.repository.replace(/^https:\/\/github\.com\//, ''), commit: origin.revision,
      path: typeof path === 'string' ? path.replace(/\/?SKILL\.md$/, '') : undefined, release: item.family, revision: item.root.releaseSha256 };
  }
  return { type: item.family === 'Personal' ? 'local' : 'family', release: item.family, revision: item.root.releaseSha256 };
}
export function capabilityFacts(item, target) {
  const declared = item.metadata?.discovery?.clientCapabilities;
  const string = value => typeof value === 'string' && value.trim().length > 0;
  const usable = fact => fact && typeof fact === 'object' && !Array.isArray(fact)
    && ['client', 'surface', 'capability'].every(key => string(fact[key]))
    && ['supported', 'unsupported', 'unknown'].includes(fact.support)
    && (fact.reason === undefined || string(fact.reason))
    && (fact.support !== 'unsupported' || string(fact.reason));
  const facts = Array.isArray(declared) ? declared.filter(usable).filter(fact => !target || fact.client === target) : [];
  if (declared !== undefined && (!Array.isArray(declared) || declared.some(fact => !usable(fact)))) {
    facts.push({ support: 'unknown', capability: 'Unusable declaration', surface: 'Not established', reason: 'Unusable producer declarations establish no target support.' });
  }
  // Nothing declared for the tool is a fact of its own, not an unknown support value the producer never stated.
  return facts.length ? facts : [{ support: 'not-declared', capability: 'Target support', surface: 'Not declared', reason: target ? `Not declared for ${target}.` : 'No tool declared.' }];
}
export function declaredTargets(items) {
  return [...new Set(items.flatMap(item => capabilityFacts(item).map(fact => fact.client).filter(Boolean)))].sort();
}
export function supportedEntries(entries, target, support) {
  return entries.filter(entry => support === 'all' || capabilityFacts(entry.authoringItem, target).some(fact => fact.support === support));
}

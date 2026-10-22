/*
 * Copies of one upstream file, and which Catalog tool an item declares.
 *
 *   - TOOL: an item declares a Catalog tool name only in its own
 *     metadata.discovery.clientCapabilities[].client (claude-code, kiro-ide, ...).
 *     Names are compared exactly; nothing here relates them to Core's ids.
 *   - SOURCE FILE: the file an item was made from, as the Catalog declares it: the
 *     path in metadata.sourceFacts (provenance path, else identifier) or, without
 *     source facts, metadata.upstream.path, in each git origin the item names
 *     (repository and revision). Two items with the same path in the same
 *     repository and revision come from the same source file. That is provenance
 *     only: it does not say the two items install the same thing.
 *
 * Pure and free of browser and Node built-ins. tools/consumer/source-copies.mjs is
 * this same file, because the headless consumer modules don't import from src/;
 * tools/tests/source-copies.test.mjs fails if the two differ.
 */

const usable = value => typeof value === 'string' && value.trim().length > 0;
const ANY_TOOL = 'generic';

/** Every Catalog tool name the item declares, once, in declaration order. */
export function toolsOf(item) {
  const facts = item?.metadata?.discovery?.clientCapabilities;
  return Array.isArray(facts) ? [...new Set(facts.filter(fact => usable(fact?.client)).map(fact => fact.client))] : [];
}

/** Whether the item declares this Catalog tool name, exactly. */
export function declaresTool(item, tool) {
  return usable(tool) && toolsOf(item).includes(tool);
}

/** The declared source files of an item, as `repository@revision:path` keys; none when it declares no path or origin. */
export function sourceFileKeys(item) {
  const facts = item?.metadata?.sourceFacts;
  const path = [facts?.provenance?.path, facts?.identifier, item?.metadata?.upstream?.path].find(usable);
  if (!path) return [];
  const revision = facts?.provenance?.revision;
  return [...new Set((Array.isArray(item?.sources) ? item.sources : []).map(source => source?.origin)
    .filter(origin => origin?.kind === 'git' && usable(origin.repository) && usable(origin.revision) && (!usable(revision) || origin.revision === revision))
    .map(origin => `${origin.repository}@${origin.revision}:${path}`))];
}

const identity = item => `${item?.root?.releaseSha256 ?? ''}\n${item?.id ?? ''}`;

/** Groups of two or more different items that share a declared source file, each in the order given. */
export function sameSourceGroups(items) {
  const unique = [], seen = new Set();
  for (const item of items ?? []) if (item && !seen.has(identity(item))) { seen.add(identity(item)); unique.push(item); }
  const parent = unique.map((_, index) => index);
  const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const firstWith = new Map();
  unique.forEach((item, index) => {
    for (const key of sourceFileKeys(item)) {
      if (firstWith.has(key)) parent[find(index)] = find(firstWith.get(key));
      else firstWith.set(key, index);
    }
  });
  const groups = new Map();
  unique.forEach((item, index) => { const root = find(index); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(item); });
  return [...groups.values()].filter(group => group.length > 1);
}

const nameOf = item => {
  const tools = toolsOf(item).filter(tool => tool !== ANY_TOOL);
  return `${usable(item.label) ? item.label : item.id} (${tools.length ? tools.join(', ') : toolsOf(item).length ? 'any AI tool' : 'no declared tool'})`;
};
const list = names => names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** One sentence per group of chosen items that come from the same declared source file, or ''. */
export function sameSourceWarning(items) {
  return sameSourceGroups(items).map(group => `${list(group.map(nameOf))} come from the same source file.`).join(' ');
}

/**
 * The item to recommend for a rule naming `item` when the person's Catalog tool is `tool`: the item itself when it
 * declares that tool or no copy does; otherwise the first copy (by id) from the same declared source file that
 * declares it.
 */
export function preferredCopy(item, items, tool) {
  if (!item || !usable(tool) || declaresTool(item, tool)) return item;
  const keys = new Set(sourceFileKeys(item));
  if (!keys.size) return item;
  const copies = (items ?? []).filter(other => other && other.id !== item.id && declaresTool(other, tool) && sourceFileKeys(other).some(key => keys.has(key)))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return copies[0] ?? item;
}

// The release list's index status in the contract's exact words, chosen only from what Catalog reported: per-source
// release-index diagnostic codes, and the prepared-content status Catalog labels unauthenticated. Other codes are not
// index statuses and are left to the caller's failure wording.
const WORDS = {
  unsigned: () => 'Release list not signed yet',
  expired: ({ source }) => `${source}'s list has expired; not used`,
  'rollback-refused': ({ source }) => `${source} offered an older list; refused`,
  offline: ({ source, date }) => `Can't reach ${source}; using the copy from ${date}`,
  'root-revoked': ({ source }) => `${source}'s keys were withdrawn; its releases are hidden`,
  conflict: ({ framework, version }) => `Sources disagree about ${framework} ${version}; neither is used`,
};
export const indexStatusCodes = Object.keys(WORDS);

// One line per distinct status, in the order Catalog reported them; `unsigned` is said once for the whole list.
export function indexStatuses(catalog) {
  const lines = [], seen = new Set();
  const add = (code, text, message) => { if (!seen.has(text)) { seen.add(text); lines.push({ code, text, message }); } };
  for (const source of catalog?.frameworkSources ?? []) {
    if (source.kind === 'internal') continue;
    for (const diagnostic of source.diagnostics ?? []) {
      const words = WORDS[diagnostic.code];
      if (!words) continue;
      // An offline copy names the date it was last verified; without one there is no honest wording to show.
      const date = diagnostic.code === 'offline' ? source.lastVerifiedAt : undefined;
      if (diagnostic.code === 'offline' && !date) continue;
      add(diagnostic.code, words({ source: source.id, framework: diagnostic.frameworkId, version: diagnostic.version, date }), diagnostic.message);
    }
  }
  for (const framework of catalog?.frameworks ?? []) {
    if (framework.kind === 'internal' && framework.internalContent?.status?.authenticated === false) add('unsigned', WORDS.unsigned(), 'Catalog labels this prepared content unauthenticated.');
  }
  return lines;
}
// True when a source's diagnostics are all index statuses, so its failure wording would only repeat them.
export const onlyIndexStatuses = source => (source.diagnostics ?? []).length > 0 && source.diagnostics.every(value => value.code in WORDS);

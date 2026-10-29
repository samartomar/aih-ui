// The release list's index status in the contract's exact words, chosen only from what Catalog's release-index reader
// reported for each index source. Prepared content has no index entry, so it never has an index status. Other codes
// are not index statuses and are left to the caller's failure wording.
const WORDS = {
  unsigned: () => 'Release list not signed yet',
  expired: ({ source }) => `${source}'s list has expired; not used`,
  'rollback-refused': ({ source }) => `${source} offered an older list; refused`,
  offline: ({ source, date }) => `Can't reach ${source}; using the copy from ${date}`,
  'root-revoked': ({ source }) => `${source}'s keys were withdrawn; its releases are hidden`,
  conflict: ({ framework, version }) => `Sources disagree about ${framework} ${version}; neither is used`,
};
export const indexStatusCodes = Object.keys(WORDS);

// The one rule: a diagnostic's line in the contract's words, or null when it is not an index status or its wording
// cannot be filled honestly (an offline copy with no recorded date).
function statusLine(source, diagnostic) {
  const words = WORDS[diagnostic.code];
  if (!words || (diagnostic.code === 'offline' && !source.lastVerifiedAt)) return null;
  return words({ source: source.id, framework: diagnostic.frameworkId, version: diagnostic.version, date: source.lastVerifiedAt });
}

// One line per distinct status, in the order Catalog reported them; `unsigned` is said once for the whole list.
export function indexStatuses(catalog) {
  const lines = [], seen = new Set();
  for (const source of catalog?.frameworkSources ?? []) {
    if (source.kind === 'internal') continue;
    for (const diagnostic of source.diagnostics ?? []) {
      const text = statusLine(source, diagnostic);
      if (text && !seen.has(text)) { seen.add(text); lines.push({ code: diagnostic.code, text, message: diagnostic.message }); }
    }
  }
  return lines;
}
// True when every diagnostic of a source has a status line, so its failure wording would only repeat them.
export const onlyIndexStatuses = source => (source.diagnostics ?? []).length > 0 && source.diagnostics.every(diagnostic => statusLine(source, diagnostic) !== null);

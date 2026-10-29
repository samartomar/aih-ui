// How the service composes installed family inventories with configured-framework and explicit fixture
// inventories. Pure: no package imports, so the owning unit test exercises the exact production rule.
//
// Rule: an explicitly supplied fixture inventory REPLACES the installed default for the same
// framework+version (whatever the sha - a pinned golden may equal the installed release or differ).
// The fixture side is then deduplicated by exact sha against the KEPT installed side only, so a
// same-sha fixture is not dropped by a twin the replacement already removed. Two non-fixture releases
// sharing a framework+version are both kept: genuine ambiguity is the resolver's honest job, never
// hidden here. A configured twin carrying the host-verified internal-content identity (the exact Catalog archive the
// same release bytes were bound to) replaces its installed twin whole: its material source and identity travel
// together, so a choice never records one archive while its materials come from another build.

const versionOf = release => `${release.framework?.id}@${release.framework?.version}`;

export function composeFamilyInventories({ installed = [], catalog = [], fixtures = [] } = {}) {
  const fixtureVersions = new Set(fixtures.map(entry => versionOf(entry.release)));
  const identified = new Set(catalog.filter(entry => entry.internalContent).map(entry => entry.release.sha256));
  const keptInstalled = installed.filter(entry => !fixtureVersions.has(versionOf(entry.release)) && !identified.has(entry.release.sha256));
  const keptShas = new Set(keptInstalled.map(entry => entry.release.sha256));
  return [...keptInstalled, ...catalog.filter(entry => !keptShas.has(entry.release.sha256))];
}

// The host's update source: an ordered list of locally packed Catalog package roots, oldest first. Each root is read only
// through the public release reader, one export at a time; nothing else under it is read, nothing is written, no scan runs.
// What is read is a candidate list for the maintenance check, and the position order is the host's declaration of newer.
import { isAbsolute } from 'node:path';
import { readInstalledRelease } from '@aihq/catalog/node';
import { declareReleaseOrder, MAX_ORDERED_SOURCES } from './release-order.mjs';
import { FAMILY_RELEASE_EXPORTS } from './installed-families.mjs';
export const UPDATE_SOURCE_KIND = 'catalog-roots';
export const UPDATE_SOURCE_RELEASE_EXPORTS = ['./release.json', ...FAMILY_RELEASE_EXPORTS];
// The configured roots, or a thrown error that says what to fix. The paths themselves are never echoed.
export function validateCatalogRoots(roots) {
  if (!Array.isArray(roots) || !roots.length) throw new Error('Supply the update source as a list of one or more absolute Catalog package roots.');
  if (roots.length > MAX_ORDERED_SOURCES) throw new Error(`The update source lists ${roots.length} Catalog package roots; at most ${MAX_ORDERED_SOURCES} are allowed.`);
  roots.forEach((root, index) => {
    if (typeof root !== 'string' || !root.trim()) throw new Error(`Update source entry ${index + 1} is empty; list each Catalog package root once, with no empty entries.`);
    if (!isAbsolute(root)) throw new Error(`Update source entry ${index + 1} is not an absolute path.`);
  });
  return roots;
}
export function createCatalogUpdateSource({ roots, installedPackage, readRelease = readInstalledRelease, releaseExports = UPDATE_SOURCE_RELEASE_EXPORTS, now = () => new Date().toISOString() } = {}) {
  validateCatalogRoots(roots);
  if (typeof installedPackage?.name !== 'string') throw new Error('Supply the installed Catalog package.');
  const lastRead = new Map();
  // One root: every export valid and from the installed package, else the first reason it is offline and the export that failed.
  async function readRoot(root) {
    const entries = [];
    for (const release of releaseExports) {
      let read;
      try { read = await readRelease({ root, release, sourceInput: 'maintained' }); }
      catch { return { reason: 'unreadable', export: release }; }
      if (!read?.valid || !read.release) return { reason: 'invalid', export: release };
      if (read.release.package?.name !== installedPackage.name) return { reason: 'package-mismatch', export: release };
      entries.push({ release: read.release, materialSource: read.source });
    }
    return { entries };
  }
  return {
    async read() {
      const readAt = now(), sources = [], positions = [], inventories = [], seen = new Set();
      for (const [index, root] of roots.entries()) {
        const position = index + 1, { entries, reason, export: failed } = await readRoot(root);
        if (!entries) {
          positions.push([]);
          sources.push({ position, state: 'offline', reason, export: failed, ...(lastRead.has(position) ? { lastReadAt: lastRead.get(position) } : {}) });
          continue;
        }
        lastRead.set(position, readAt);
        const [{ release }] = entries;
        sources.push({ position, state: 'read', package: { name: release.package.name, ...(release.package.version !== undefined ? { version: release.package.version } : {}) },
          releaseSha256: release.sha256, readAt });
        positions.push(entries.map(entry => entry.release.sha256));
        for (const entry of entries) if (!seen.has(entry.release.sha256)) { seen.add(entry.release.sha256); inventories.push(entry); }
      }
      return { kind: UPDATE_SOURCE_KIND, inventories: inventories.length ? inventories : null, releaseOrder: declareReleaseOrder(positions), sources };
    }
  };
}

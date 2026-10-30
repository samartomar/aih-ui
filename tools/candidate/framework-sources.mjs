// The candidate's framework sources: the pinned Catalog's own prepared content (the frameworks the manifest names in
// preparedFrameworks), read from the Catalog installed in the candidate's consumer and bound to its pinned archive. This is the
// AIH_FRAMEWORK_SOURCES configuration the README's "Framework sources" describes, with prepared selections only: no index,
// nothing from the network and nothing from the launching shell.
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function preparedFrameworkSources({ frameworks, catalogRoot, catalog }) {
  return { prepared: frameworks.map(frameworkId => ({ root: catalogRoot, frameworkId, archivePath: catalog.tarball, archiveSha256: catalog.sha256 })) };
}

// Returns the written file's path, or undefined (and writes nothing) when the manifest names no framework.
export function writePreparedFrameworkSources({ frameworks, consumerDir, runDir, catalog }) {
  if (!frameworks?.length) return undefined;
  const catalogRoot = realpathSync(join(consumerDir, 'node_modules', '@aihq', 'catalog'));
  const path = join(runDir, 'framework-sources.json');
  writeFileSync(path, `${JSON.stringify(preparedFrameworkSources({ frameworks, catalogRoot, catalog }), null, 2)}\n`);
  return path;
}

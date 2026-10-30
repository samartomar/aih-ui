// A Workbench restarted on a newer Catalog: a copy of the packed consumer with only its installed Catalog package
// replaced by a Catalog pack built with Catalog's own generator, checked by Catalog's own reader to change exactly one
// item. Used by check-installed-truth (update-one, update-requirement) and check-installed-workbench (UI168 update).
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * @param consumerDir the packed consumer the case installs from
 * @param fixtureDir  where the two prepared-content sources are written
 * @param sources     the prepared-content sources file the installed Catalog is read through
 * @param name        a name for this staging (its consumer copy and sources files)
 * @param pack        the newer Catalog pack
 * @param changes     the one changed `framework:itemId` must match this
 */
export async function stageNewerCatalog({ consumerDir, fixtureDir, sources, name, pack, changes }) {
  const catalogManifest = createRequire(join(consumerDir, 'package.json')).resolve('@aihq/catalog/package.json');
  const nodeEntry = JSON.parse(readFileSync(catalogManifest, 'utf8')).exports['./node'].import;
  const { readInstalledPreparedContent } = await import(pathToFileURL(join(dirname(catalogManifest), nodeEntry)).href);
  const updatedConsumer = join(consumerDir, `${name}-consumer`);
  await rm(updatedConsumer, { recursive: true, force: true }); await mkdir(updatedConsumer, { recursive: true });
  for (const entry of ['package.json', 'package-lock.json', 'node_modules', 'consumer', 'service', 'workbench', 'schemas', 'page'])
    if (existsSync(join(consumerDir, entry))) await cp(join(consumerDir, entry), join(updatedConsumer, entry), { recursive: true, verbatimSymlinks: true });
  const baseRoot = dirname(catalogManifest), newRoot = join(updatedConsumer, 'node_modules/@aihq/catalog');
  await rm(newRoot, { recursive: true, force: true }); await mkdir(newRoot, { recursive: true });
  execFileSync('tar', ['-xzf', pack, '-C', newRoot, '--strip-components=1'], { windowsHide: true });
  const base = JSON.parse(readFileSync(sources, 'utf8'));
  const frameworks = [...new Set(base.prepared.map(entry => entry.frameworkId))];
  const identities = async root => Object.fromEntries((await Promise.all(frameworks.map(async frameworkId => {
    const read = await readInstalledPreparedContent({ root, frameworkId, sourceInput: `${name}-${frameworkId}` });
    if (!read.valid) throw new Error(`Catalog refused ${frameworkId} at ${root}: ${JSON.stringify(read.diagnostics).slice(0, 400)}`);
    return read.release.items.map(item => [`${frameworkId}:${item.id}`, `${item.contentSha256}/${item.behaviourSha256}`]);
  }))).flat());
  const before = await identities(baseRoot), after = await identities(newRoot);
  if (JSON.stringify(Object.keys(before).sort()) !== JSON.stringify(Object.keys(after).sort())) throw new Error(`the ${name} pack adds or removes items`);
  const changed = Object.keys(before).filter(key => before[key] !== after[key]);
  if (changed.length !== 1 || !changes.test(changed[0])) throw new Error(`the ${name} pack must change exactly one item matching ${changes}; it changes ${changed.join(', ') || 'nothing'}`);
  // Only the Catalogs' prepared content, as a person's Workbench has it: Core reports update states only when every
  // offered release names its items' hashes, which the fixture release index does not.
  const installSources = join(fixtureDir, `${name}-installed-sources.json`), updateSources = join(fixtureDir, `${name}-newer-sources.json`);
  const archiveSha256 = sha256(readFileSync(pack));
  await writeFile(installSources, JSON.stringify({ prepared: base.prepared }));
  await writeFile(updateSources, JSON.stringify({ prepared: base.prepared.map(({ expectedContentSha256: _pinned, ...entry }) => ({ ...entry, root: newRoot, archivePath: pack, archiveSha256 })) }));
  return { itemId: changed[0].slice(changed[0].indexOf(':') + 1), updatedConsumer, installSources, updateSources };
}

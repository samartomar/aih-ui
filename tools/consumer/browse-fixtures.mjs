// Separate public golden specimens; never an ECC hook or a production index.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readReleaseContent, readReleaseSets } from '@aihq/catalog/reader';
const bytes = specifier => readFile(fileURLToPath(import.meta.resolve(specifier)));
const sha256 = value => createHash('sha256').update(value).digest('hex');
export async function optionalHookFixture() {
  const inventories = [];
  for (const name of ['superpowers', 'extensions']) {
    const data = await bytes(`@aihq/catalog/fixtures/release-sets/${name}-release-1.6.0.json`);
    const read = readReleaseContent(data, { expectedSha256: sha256(data) });
    if (!read.valid) throw new Error(`Public ${name} set fixture refused: ${JSON.stringify(read.diagnostics)}`);
    let release = read.release;
    if (name === 'superpowers') {
      const sets = await bytes('@aihq/catalog/fixtures/release-sets-1.0.0-valid.json');
      const checked = readReleaseSets(sets, { expectedSha256: sha256(sets), release });
      if (checked.valid !== true) throw new Error(`Public optional-hook set fixture refused: ${JSON.stringify(checked.diagnostics)}`);
      release = checked.value?.release ?? checked.release;
    }
    inventories.push({ release, family: release.framework.name, materialSource: { kind: 'local', input: `fixture-${name}` }, materials: [], fixture: 'Selection-only public golden specimen. Material acquisition, Prepare and execution are not part of this fixture.' });
  }
  return inventories;
}

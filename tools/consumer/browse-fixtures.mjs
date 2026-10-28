// Separate public golden specimens; never an ECC hook or a production index.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { readReleaseContent, readReleaseSets } from '@aihq/catalog/reader';
import { compileReleaseSets } from '@aihq/catalog/producer';
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
    if (name === 'extensions') {
      const parent = inventories[0].release;
      const hook = parent.items.find(item => item.kind === 'hook');
      const runtime = parent.items.find(item => item.id === hook.dependencies.requires[0].itemId);
      const ordinary = release.items.find(item => item.id === 'extensions.skill.security-and-hardening');
      const built = compileReleaseSets({ release, sets: [{ id: 'cross-hook', name: 'Cross-framework hook fixture', description: 'Selection-only cross-framework configurable hook exclusion.', offer: 'pre-ticked', members: [
        { item: { framework: release.framework.id, itemId: ordinary.id }, optional: false, defaultOn: true },
        { item: { framework: parent.framework.id, itemId: hook.id, releaseVersion: parent.framework.version, contentSha256: hook.contentSha256, behaviourSha256: hook.behaviourSha256 }, optional: true, defaultOn: false },
        { item: { framework: parent.framework.id, itemId: runtime.id, releaseVersion: parent.framework.version, contentSha256: runtime.contentSha256, behaviourSha256: runtime.behaviourSha256 }, optional: true, defaultOn: false }
      ] }] });
      if (built.status !== 'ok') throw new Error(`Cross-hook fixture compilation refused: ${JSON.stringify(built)}`);
      const checked = readReleaseSets(built.value.bytes, { expectedSha256: built.value.sha256, release });
      if (!checked.valid) throw new Error(`Cross-hook fixture reader refused: ${JSON.stringify(checked.diagnostics)}`);
      inventories.push({ release: checked.release ?? checked.value.release, family: release.framework.name, materialSource: { kind: 'local', input: 'fixture-cross-hook' }, materials: [], fixture: 'Cross-framework optional-hook selection-only fixture; no execution or production release.' });
      continue;
    }
    inventories.push({ release, family: release.framework.name, materialSource: { kind: 'local', input: `fixture-${name}` }, materials: [], fixture: 'Selection-only public golden specimen. Material acquisition, Prepare and execution are not part of this fixture.' });
  }
  const alternateDocument = JSON.parse(await bytes('@aihq/catalog/release-superpowers.content.json'));
  // A declared test version of public content, admitted by the real reader.
  // No producer file, index entry, baseline or trust statement is changed.
  alternateDocument.framework.version = '999.0.0';
  const alternateBytes = new TextEncoder().encode(stable(alternateDocument) + '\n');
  const alternate = readReleaseContent(alternateBytes, { expectedSha256: sha256(alternateBytes) });
  if (!alternate.valid) throw new Error('Public alternate framework content refused.');
  inventories.unshift({ release: alternate.release, family: alternate.release.framework.name, materialSource: { kind: 'local', input: 'fixture-other-version' }, materials: [], fixture: 'Distinct checked TEST version of the same framework; generated selection-only fixture, not a production release, no execution.' });
  const independentBytes = await bytes('@aihq/catalog/release-project-basics.content.json');
  const independent = readReleaseContent(independentBytes, { expectedSha256: sha256(independentBytes) });
  if (!independent.valid) throw new Error('Public independent framework content refused.');
  inventories.push({ release: independent.release, family: independent.release.framework.name, materialSource: { kind: 'local', input: 'fixture-independent-choice' }, materials: [], fixture: 'Independent checked framework for unrelated-choice fixture; no execution.' });
  return inventories;
}

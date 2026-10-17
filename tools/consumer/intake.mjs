// Acquisition is host-owned. Only explicit snapshots enter this portable adapter.
import { compileProducerDeclaration } from '@aihq/catalog/producer';
import { readRelease } from '@aihq/catalog/reader';
import { digestBytes, ok, refuse } from './primitives.mjs';
import { checkInput } from './intent-shape.mjs';
// The ./intake entry has always exported these names; they come from the shared modules below it.
export { digestBytes, hash, object, only } from './primitives.mjs';
export { checkInput } from './intent-shape.mjs';
export async function intakeDeclaration({ input, declarationBytes, sourceFiles, materialSource, archiveBytes }) {
  const fail = message => refuse('SOURCE_IDENTITY_MISMATCH', '/inputs', message, declarationBytes);
  if (!checkInput(input, false) || !(declarationBytes instanceof Uint8Array) || declarationBytes.length > 850_000) return fail('Supply a bounded declaration and portable exact source identity.');
  if (await digestBytes(declarationBytes) !== input.resolvedIdentity.sha256) return fail('Declaration snapshot does not match its acquired identity.');
  if (input.kind === 'npm') {
    if (!(archiveBytes instanceof Uint8Array)) return fail('Supply the acquired npm archive bytes to verify integrity.');
    const [algorithm, expected] = input.resolvedIdentity.integrity.split('-');
    const actual = new Uint8Array(await crypto.subtle.digest(algorithm.toUpperCase().replace('SHA', 'SHA-'), archiveBytes));
    let binary = ''; for (const byte of actual) binary += String.fromCharCode(byte);
    if (btoa(binary) !== expected) return fail('Acquired npm archive differs from resolved integrity.');
  }
  if (['git', 'organization'].includes(input.kind) && (!Array.isArray(sourceFiles) || sourceFiles.some(source => source.revision !== input.resolvedIdentity.revision))) return fail('Source file revisions differ from the acquired snapshot.');
  let declaration;
  try { declaration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(declarationBytes)); }
  catch { return refuse('INPUT_INVALID', '/declarationBytes', 'Declaration is not UTF-8 JSON.', declarationBytes); }
  let compiled;
  try { compiled = compileProducerDeclaration({ declaration, sourceFiles }); }
  catch { return refuse('INPUT_INVALID', '/sourceFiles', 'Supply explicit source files and required bytes.', declarationBytes); }
  if (compiled.status !== 'ok') return { ...compiled, originalBytes: declarationBytes.slice() };
  const checked = readRelease(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  if (!checked.valid) return refuse('INPUT_INVALID', '/release', 'Catalog refused its compiled release.', declarationBytes, { owner: 'catalog', diagnostics: checked.diagnostics });
  // configureItem/Core validate the separately supplied material source. Portable
  // locators never become filesystem roots and no source code is executed here.
  return ok({ release: checked.release, materialSource, input: { ...structuredClone(input), releaseSha256: checked.release.sha256 },
    materials: compiled.value.materials, declarationBytes: declarationBytes.slice() });
}

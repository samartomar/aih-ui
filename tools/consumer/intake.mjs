// Acquisition is host-owned. Only explicit snapshots enter this portable adapter.
import { compileProducerDeclaration } from '@aihq/catalog/producer';
import { readRelease } from '@aihq/catalog/reader';
import { ok, refuse } from './headless.mjs';
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const only = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\x00-\x1f]/.test(value);
const name = value => text(value) && /^[\w.-]{1,180}$/.test(value);
export async function digestBytes(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function checkInput(input, resolved = true) {
  if (!only(input, ['id', 'kind', 'locator', 'resolvedIdentity'], ['releaseSha256']) || !name(input.id) || (resolved && !hash(input.releaseSha256))) return false;
  const { kind, locator: l, resolvedIdentity: r } = input;
  if (!object(r) || !hash(r.sha256)) return false;
  if (kind === 'local') return only(l, ['input']) && name(l.input) && only(r, ['sha256']);
  if (kind === 'git') return only(l, ['repository'], ['ref']) && text(l.repository) && !/[@?#\\]|:\/\/[^/]*:/.test(l.repository)
    && (l.ref === undefined || text(l.ref)) && only(r, ['revision', 'sha256']) && /^[a-f0-9]{40,64}$/.test(r.revision);
  if (kind === 'npm') return only(l, ['name'], ['range']) && /^(@[\w.-]+\/)?[\w.-]+$/.test(l.name) && (l.range === undefined || text(l.range))
    && only(r, ['version', 'integrity', 'sha256']) && /^\d+\.\d+\.\d+[-+\w.]*$/.test(r.version) && /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(r.integrity);
  return kind === 'organization' && only(l, ['authorityId', 'sourceId']) && name(l.authorityId) && name(l.sourceId)
    && only(r, ['revision', 'sha256']) && text(r.revision);
}
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

// The candidate manifest: which three package tarballs (and optionally an older or newer Catalog) one owner-testing
// candidate is built from, each pinned by digest and source commit. Nothing here knows which versions are named.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { MANIFEST_SCHEMA } from './layout.mjs';

const SHA256 = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{7,40}$/;
const REQUIRED = ['core', 'catalog', 'scan'];
// The most update-source Catalogs one candidate can name (the Workbench host's own limit).
const MAX_UPDATE_SOURCE_CATALOGS = 8;
// The most prepared selections the Workbench host reads from one framework-source file.
const MAX_PREPARED_FRAMEWORKS = 16;
const FRAMEWORK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// The order the candidate is printed and checked in.
const IDENTITY_ORDER = ['core', 'scan', 'catalog'];
const refusal = (code, message) => Object.assign(new Error(message), { code });
const invalid = message => refusal('CANDIDATE_MANIFEST_INVALID', message);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);

function readEntry(label, entry, directory) {
  if (!plain(entry)) throw invalid(`${label} must be an object with tarball, sha256 and commit.`);
  const unknown = Object.keys(entry).filter(key => !['tarball', 'sha256', 'commit'].includes(key));
  if (unknown.length) throw invalid(`${label} has unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}.`);
  if (typeof entry.tarball !== 'string' || entry.tarball === '') throw invalid(`${label}.tarball must name a tarball file.`);
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) throw invalid(`${label}.sha256 must be 64 lowercase hex characters.`);
  if (typeof entry.commit !== 'string' || !COMMIT.test(entry.commit)) throw invalid(`${label}.commit must be 7 to 40 lowercase hex characters.`);
  return { tarball: isAbsolute(entry.tarball) ? entry.tarball : resolve(directory, entry.tarball), sha256: entry.sha256, commit: entry.commit };
}

export function readManifest(path) {
  const file = resolve(path);
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw invalid(error.code === 'ENOENT' ? `The manifest ${file} does not exist.` : `The manifest ${file} could not be read as JSON: ${error.message}`); }
  if (!plain(manifest)) throw invalid('The manifest must be a JSON object.');
  if (manifest.schema !== MANIFEST_SCHEMA) throw invalid(`The manifest schema must be ${MANIFEST_SCHEMA} (found ${JSON.stringify(manifest.schema)}).`);
  const unknown = Object.keys(manifest).filter(key => !['schema', 'candidate', 'packages', 'ui', 'hostInputs', 'previousCatalog', 'updateSourceCatalogs', 'preparedFrameworks'].includes(key));
  if (unknown.length) throw invalid(`The manifest has unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}.`);
  if (manifest.candidate !== undefined && typeof manifest.candidate !== 'string') throw invalid('candidate must be a text label.');
  if (!plain(manifest.packages)) throw invalid('The manifest must name packages core, catalog and scan.');
  const extra = Object.keys(manifest.packages).filter(key => !REQUIRED.includes(key));
  if (extra.length) throw invalid(`packages has unknown ${extra.length === 1 ? 'key' : 'keys'}: ${extra.join(', ')}.`);
  const directory = dirname(file), packages = {};
  const hostInputs = {};
  if (manifest.hostInputs !== undefined) {
    if (!plain(manifest.hostInputs) || Object.keys(manifest.hostInputs).some(key => !['evidenceSources', 'reviewTrust'].includes(key))) throw invalid('hostInputs may name only evidenceSources and reviewTrust.');
    for (const [key, entry] of Object.entries(manifest.hostInputs)) {
      if (!plain(entry) || Object.keys(entry).some(key => !['path', 'sha256'].includes(key)) || typeof entry.path !== 'string' || !entry.path || !SHA256.test(entry.sha256)) throw invalid(`hostInputs.${key} needs path and lowercase sha256.`);
      hostInputs[key] = { path: resolve(directory, entry.path), sha256: entry.sha256 };
    }
  }
  if (manifest.ui !== undefined) packages.ui = readEntry('ui', manifest.ui, directory);
  for (const name of REQUIRED) {
    if (manifest.packages[name] === undefined) throw invalid(`The manifest names no ${name} package.`);
    packages[name] = readEntry(`packages.${name}`, manifest.packages[name], directory);
  }
  if (manifest.previousCatalog !== undefined) packages.previousCatalog = readEntry('previousCatalog', manifest.previousCatalog, directory);
  // `updateSourceCatalogs` is the order this host's update source declares, oldest first: later entries are newer because the
  // manifest author lists them so, not because of any version or Catalog fact. Listing the installed pack among them places it.
  if (manifest.updateSourceCatalogs !== undefined) {
    const list = manifest.updateSourceCatalogs;
    if (!Array.isArray(list)) throw invalid(`updateSourceCatalogs must be a list of 1 to ${MAX_UPDATE_SOURCE_CATALOGS} entries, each with tarball, sha256 and commit.`);
    if (list.length < 1 || list.length > MAX_UPDATE_SOURCE_CATALOGS) throw invalid(`updateSourceCatalogs must list 1 to ${MAX_UPDATE_SOURCE_CATALOGS} entries (found ${list.length}).`);
    packages.updateSourceCatalogs = list.map((entry, index) => readEntry(`updateSourceCatalogs[${index}]`, entry, directory));
  }
  // Framework ids of the pinned Catalog's own prepared content (tools/candidate/framework-sources.mjs); the launcher's one framework-source input.
  const list = manifest.preparedFrameworks;
  if (list !== undefined && (!Array.isArray(list) || list.length < 1 || list.length > MAX_PREPARED_FRAMEWORKS
    || list.some(id => typeof id !== 'string' || !FRAMEWORK_ID.test(id)) || new Set(list).size !== list.length)) {
    throw invalid(`preparedFrameworks must list 1 to ${MAX_PREPARED_FRAMEWORKS} distinct framework ids (lowercase letters, digits and hyphens), such as ["extensions", "ecc", "superpowers"].`);
  }
  return { manifest, packages, hostInputs, ...(list ? { preparedFrameworks: [...list] } : {}) };
}

const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');

// Every tarball is hashed before anything is installed or written: a candidate is the bytes named, or it is refused.
export async function verifyManifest({ packages, hostInputs = {} }) {
  const { updateSourceCatalogs = [], ...named } = packages;
  for (const [name, entry] of [...Object.entries(named), ...updateSourceCatalogs.map((entry, index) => [`updateSourceCatalogs[${index}]`, entry]), ...Object.entries(hostInputs).map(([name, entry]) => [name, { ...entry, tarball: entry.path }])]) {
    let bytes;
    try { bytes = await readFile(entry.tarball); }
    catch (error) { throw refusal('CANDIDATE_TARBALL_MISSING', `The ${name} tarball ${entry.tarball} could not be read: ${error.code ?? error.message}`); }
    const actual = digestOf(bytes);
    if (actual !== entry.sha256) throw refusal('CANDIDATE_DIGEST_MISMATCH', `The ${name} tarball ${basename(entry.tarball)} has sha256 ${actual}, not the ${entry.sha256} the manifest names.`);
  }
}

export function candidateIdentity({ manifest, packages, hostInputs = {}, preparedFrameworks }) {
  return { candidate: manifest.candidate ?? null,
    ...(Object.keys(hostInputs).length ? { hostInputs } : {}),
    ...(packages.ui ? { ui: { ...packages.ui, tarball: basename(packages.ui.tarball) } } : {}),
    packages: IDENTITY_ORDER.map(name => ({ name: `@aihq/${name}`, sha256: packages[name].sha256, commit: packages[name].commit, tarball: basename(packages[name].tarball) })),
    // Only when configured, so the printed identity says exactly which packs the update source uses, by position.
    ...(packages.updateSourceCatalogs ? { updateSource: packages.updateSourceCatalogs.map((entry, index) => ({ position: index + 1, sha256: entry.sha256, commit: entry.commit, tarball: basename(entry.tarball) })) } : {}),
    ...(preparedFrameworks ? { preparedFrameworks } : {}) };
}

// The manifest as the candidate keeps it: the same document with every tarball path made absolute.
export function absoluteManifest({ manifest, packages, hostInputs = {} }) {
  const named = { ...manifest.packages }, out = { ...manifest, packages: named };
  if (manifest.hostInputs) out.hostInputs = hostInputs;
  if (packages.ui) out.ui = { ...manifest.ui, tarball: packages.ui.tarball };
  for (const name of REQUIRED) named[name] = { ...manifest.packages[name], tarball: packages[name].tarball };
  if (packages.previousCatalog) out.previousCatalog = { ...manifest.previousCatalog, tarball: packages.previousCatalog.tarball };
  if (packages.updateSourceCatalogs) out.updateSourceCatalogs = manifest.updateSourceCatalogs.map((entry, index) => ({ ...entry, tarball: packages.updateSourceCatalogs[index].tarball }));
  return out;
}

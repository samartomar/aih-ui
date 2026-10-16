// The candidate manifest: which three package tarballs (and optionally an older or newer Catalog) one owner-testing
// candidate is built from, each pinned by digest and source commit. Nothing here knows which versions are named.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { MANIFEST_SCHEMA } from './layout.mjs';

const SHA256 = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{7,40}$/;
const REQUIRED = ['core', 'catalog', 'scan'];
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
  const unknown = Object.keys(manifest).filter(key => !['schema', 'candidate', 'packages', 'previousCatalog'].includes(key));
  if (unknown.length) throw invalid(`The manifest has unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}.`);
  if (manifest.candidate !== undefined && typeof manifest.candidate !== 'string') throw invalid('candidate must be a text label.');
  if (!plain(manifest.packages)) throw invalid('The manifest must name packages core, catalog and scan.');
  const extra = Object.keys(manifest.packages).filter(key => !REQUIRED.includes(key));
  if (extra.length) throw invalid(`packages has unknown ${extra.length === 1 ? 'key' : 'keys'}: ${extra.join(', ')}.`);
  const directory = dirname(file), packages = {};
  for (const name of REQUIRED) {
    if (manifest.packages[name] === undefined) throw invalid(`The manifest names no ${name} package.`);
    packages[name] = readEntry(`packages.${name}`, manifest.packages[name], directory);
  }
  if (manifest.previousCatalog !== undefined) packages.previousCatalog = readEntry('previousCatalog', manifest.previousCatalog, directory);
  return { manifest, packages };
}

const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');

// Every tarball is hashed before anything is installed or written: a candidate is the bytes named, or it is refused.
export async function verifyManifest({ packages }) {
  for (const [name, entry] of Object.entries(packages)) {
    let bytes;
    try { bytes = await readFile(entry.tarball); }
    catch (error) { throw refusal('CANDIDATE_TARBALL_MISSING', `The ${name} tarball ${entry.tarball} could not be read: ${error.code ?? error.message}`); }
    const actual = digestOf(bytes);
    if (actual !== entry.sha256) throw refusal('CANDIDATE_DIGEST_MISMATCH', `The ${name} tarball ${basename(entry.tarball)} has sha256 ${actual}, not the ${entry.sha256} the manifest names.`);
  }
}

export function candidateIdentity({ manifest, packages }) {
  return { candidate: manifest.candidate ?? null,
    packages: IDENTITY_ORDER.map(name => ({ name: `@aihq/${name}`, sha256: packages[name].sha256, commit: packages[name].commit, tarball: basename(packages[name].tarball) })) };
}

// The manifest as the candidate keeps it: the same document with every tarball path made absolute.
export function absoluteManifest({ manifest, packages }) {
  const named = { ...manifest.packages }, out = { ...manifest, packages: named };
  for (const name of REQUIRED) named[name] = { ...manifest.packages[name], tarball: packages[name].tarball };
  if (packages.previousCatalog) out.previousCatalog = { ...manifest.previousCatalog, tarball: packages.previousCatalog.tarball };
  return out;
}

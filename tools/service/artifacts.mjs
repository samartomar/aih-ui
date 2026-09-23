/**
 * Artifact I/O for the backend worker.
 *
 * Exact bytes in, exact bytes out. Core's parsers require the canonical bytes
 * and refuse a re-serialization, so nothing here ever goes through
 * JSON.stringify on an artifact: a pretty-printed copy of a valid document is
 * not a valid document.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative as pathRelative, sep } from "node:path";

export const b64 = (bytes) => Buffer.from(bytes).toString("base64");
export const fromB64 = (value) => Buffer.from(value, "base64");

/**
 * Where an operator-side file sits, named relative to its session.
 *
 * The page holds a session id and never a path, so what it is shown is the
 * session-relative name `/api/operator-file` answered with when the file was
 * stored - `operator/authority-bundle.json` - and never where the run
 * directory happens to be on this machine. A path outside the session, or no
 * path at all, is null: there is no session-relative name for it.
 */
export function sessionRelativePath(sessionDir, path) {
  if (typeof path !== "string" || path.length === 0) return null;
  const relative = posix.normalize(pathRelative(sessionDir, path).split(sep).join("/"));
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith("../")) return null;
  if (posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return null;
  return relative;
}

/** Writes the bytes exactly as given, creating the directory if it is new. */
export function writeExactBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(bytes));
}

export function readExactBytes(path) {
  return readFileSync(path);
}

/**
 * Removes a directory and creates it empty again.
 *
 * A consumption root is rebuilt rather than added to, so what Core reads is
 * exactly what this consume placed there and never a leftover from an earlier
 * attempt with different inputs.
 */
export function recreateDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

/**
 * Copies every regular file under `fromDir` into `toDir`, byte for byte, with
 * its relative path intact. Nothing is renamed, flattened or rewritten: the
 * bytes and the paths are the whole point of what Core then checks.
 *
 * Returns the relative paths copied, in the order they were read.
 */
export function copyExactTree(fromDir, toDir) {
  const copied = [];
  const walk = (prefix) => {
    for (const item of readdirSync(prefix === "" ? fromDir : join(fromDir, prefix), { withFileTypes: true })) {
      const relative = prefix === "" ? item.name : posix.join(prefix, item.name);
      const segments = relative.split("/");
      if (item.isDirectory()) {
        walk(relative);
        continue;
      }
      if (!item.isFile()) continue;
      writeExactBytes(join(toDir, ...segments), readFileSync(join(fromDir, ...segments)));
      copied.push(relative);
    }
  };
  walk("");
  return copied;
}

/**
 * Operator-supplied configuration read as JSON: the authority bundle path, the
 * trust file, the attestation material. These are configuration, not artifacts,
 * so JSON parsing is the right reader for them.
 */
export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Configuration this worker writes for its own validation mode only. */
export function writeJsonFile(path, value) {
  writeExactBytes(path, Buffer.from(JSON.stringify(value, null, 1), "utf8"));
}

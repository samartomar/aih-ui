/**
 * Artifact I/O for the backend worker.
 *
 * Exact bytes in, exact bytes out. Core's parsers require the canonical bytes
 * and refuse a re-serialization, so nothing here ever goes through
 * JSON.stringify on an artifact: a pretty-printed copy of a valid document is
 * not a valid document.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const b64 = (bytes) => Buffer.from(bytes).toString("base64");
export const fromB64 = (value) => Buffer.from(value, "base64");

/** Writes the bytes exactly as given, creating the directory if it is new. */
export function writeExactBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(bytes));
}

export function readExactBytes(path) {
  return readFileSync(path);
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

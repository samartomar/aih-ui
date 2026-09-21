/*
 * Moving exact bytes between a file, the backend and a download.
 *
 * Base64 is the transport; the bytes themselves are never re-serialized. Core's
 * parsers require the exact canonical bytes and refuse a pretty-printed or
 * re-encoded copy, so a JSON round trip here would corrupt the artifact in a
 * way that only shows up as a refusal much later.
 */

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Hands the browser the exact bytes the server read back off disk. */
export function downloadBase64(name, base64) {
  const url = URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

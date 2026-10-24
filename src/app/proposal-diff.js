const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const equal = (before, after) => JSON.stringify(stable(before)) === JSON.stringify(stable(after));
const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
// Display-only comparison of the exact proposed artifact. Never interprets policy validity.
export function artifactDiff(before, after, path = '') {
  if (equal(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => artifactDiff(before[key], after[key], `${path}/${pointer(key)}`));
  }
  return [{ path: path || '/', before, after }];
}
export function readArtifact(bytes) {
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))); } catch { return undefined; }
}

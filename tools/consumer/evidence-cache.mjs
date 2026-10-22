import { createHash } from 'node:crypto';

export const evidenceDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const evidenceKey = value => evidenceDigest(JSON.stringify(value));

// Owned by one page's host, never shared across trust configurations or sessions.
// Large parsed results have a byte budget as well as an entry limit.
export function createEvidenceCache({ maxEntries = 64, maxBytes = 128 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = key => { bytes -= entries.get(key).size; entries.delete(key); };
  return {
    has(key) { return entries.has(key); },
    async read(key, load, size) {
      if (entries.has(key)) {
        const entry = entries.get(key); entries.delete(key); entries.set(key, entry);
        return entry.value;
      }
      const value = await load();
      if (entries.has(key)) return entries.get(key).value;
      // Charge serialized size conservatively; this is an estimated retention
      // budget, not a promise about JavaScript engine heap overhead.
      size ??= Buffer.byteLength(JSON.stringify(value)) * 2 + 256;
      if (size > maxBytes) return value;
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
      entries.set(key, { value, size }); bytes += size;
      return value;
    },
  };
}

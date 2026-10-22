/*
 * The Advanced sections: each opens closed for a new viewer and then remembers, in this browser only, whether that
 * viewer left it open. Storage can be missing or refuse; the section still opens and closes, it just forgets.
 */
const PREFIX = 'aih-workbench-advanced-';
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

export function rememberOpen(details, key, storage = browserStorage()) {
  try { details.open = storage?.getItem(PREFIX + key) === 'open'; } catch { details.open = false; }
  details.addEventListener('toggle', () => {
    try { if (details.open) storage?.setItem(PREFIX + key, 'open'); else storage?.removeItem?.(PREFIX + key); } catch { /* Forgetting is harmless. */ }
  });
  return details;
}

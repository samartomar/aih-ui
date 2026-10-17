// Private data primitives shared by the portable journey records and the headless
// authoring, intake and host modules. Pure: no imports, no Node built-ins and no
// browser globals; digests use the shared Web Crypto. Everything above imports
// these from here, so this module must stay at the bottom of the graph.
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const only = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
// Canonical JSON: object keys sorted by code unit, arrays kept in order.
export const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
export const ok = (value, diagnostics = []) => ({ status: 'ok', value, diagnostics });
export const refuse = (code, path, message, originalBytes, details) => ({ status: 'refused', diagnostics: [{ code, path, message, ...(details ? { details } : {}) }], ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) });
export async function digestBytes(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
// SHA-256 of a value's canonical JSON.
export const digestJson = async value => digestBytes(new TextEncoder().encode(stable(value)));

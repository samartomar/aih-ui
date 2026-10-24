// Session-only recovery contains bounded artifact bytes, never execution handles.
const RECOVERY = 'aih.workbench.accepted.v1';
const HANDOFF = 'aih.workbench.handoff.v1';
const ORGANIZATION = 'aih.workbench.organization.v1';
const LIMIT = 2_000_000;
function write(key, bytes, dirty = true) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LIMIT) return false;
  try {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
    sessionStorage.setItem(key, JSON.stringify({ base64: btoa(binary), dirty })); return true;
  } catch { return false; }
}
function read(key, consume = false) {
  try {
    const raw = sessionStorage.getItem(key);
    if (consume) sessionStorage.removeItem(key);
    if (!raw || raw.length > Math.ceil(LIMIT / 3) * 4 + 100) return;
    const value = JSON.parse(raw);
    if (typeof value.base64 !== 'string' || !value.base64.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) return;
    const binary = atob(value.base64);
    if (!binary.length || binary.length > LIMIT) return;
    return { bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), dirty: value.dirty !== false };
  } catch { return; }
}
export const saveDraftHandoff = bytes => write(HANDOFF, bytes);
export const takeDraftHandoff = () => read(HANDOFF, true)?.bytes;
export const recoverDraftSession = () => read(RECOVERY);
export const saveDraftSession = (bytes, dirty) => write(RECOVERY, bytes, dirty);
export const recoverOrganizationSession = () => read(ORGANIZATION);
export const saveOrganizationSession = (bytes, dirty) => write(ORGANIZATION, Uint8Array.from(bytes), dirty);

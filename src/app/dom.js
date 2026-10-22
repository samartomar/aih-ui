/*
 * The smallest DOM primitives the components share.
 *
 * Catalog and Core strings are always inserted with textContent: nothing that
 * comes out of a package or off disk is ever parsed as HTML.
 */

/** A non-empty string, or null. Empty string and undefined are both absence. */
export function text(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

export function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (className?.split(/\s+/).includes("material-symbols-outlined")) node.setAttribute("aria-hidden", "true");
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

/**
 * Looks up every id and returns them keyed camelCase, failing loudly on the
 * first one the page does not carry.
 *
 * A missing element is a blank pane, so it is a thrown error here rather than a
 * silent null three components later. tools/check-page-contract.mjs reads these
 * id lists straight out of the source, so the page and the modules cannot drift.
 */
export function collectIds(ids) {
  const found = {};
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`page is missing #${id}`);
    found[id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = node;
  }
  return found;
}

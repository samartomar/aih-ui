/*
 * Supporting material (#133): licenses, notices, references, starting templates and a hook's script files. The Catalog
 * lists them as requirements of the content that needs them, so adding that content brings them; they are not cards of
 * their own on the default path, and Advanced shows them.
 *
 * The Catalog publishes no role for this (samartomar/aih-catalog#127), so the page decides from published facts only:
 * an item's declared kind, its declared capabilities, and the `dependencies.requires` edges of the other items in the
 * same release. Labels and ids are never read.
 */

import { capabilityFacts } from './authoring-model.js';

// Kinds that are supporting material whatever else they declare.
const SUPPORTING_KINDS = new Set(['notice', 'reference', 'template']);

const entryKey = (releaseSha256, itemId) => `${releaseSha256}/${itemId}`;
const supportedAnywhere = item => capabilityFacts(item).some(fact => fact.support === 'supported');

/** The items that require each item in their own release (a requirement naming another release is not counted). */
function requiredBy(items) {
  const by = new Map();
  for (const item of items) for (const ref of item.dependencies?.requires ?? []) {
    if (typeof ref?.itemId !== 'string' || (ref.release !== undefined || (ref.releaseSha256 !== undefined && ref.releaseSha256 !== item.root?.releaseSha256))) continue;
    const key = entryKey(item.root?.releaseSha256, ref.itemId);
    by.set(key, [...(by.get(key) ?? []), item]);
  }
  return by;
}

/**
 * Whether one item is supporting material:
 *   1. its declared kind is notice, reference or template; or
 *   2. it is an instruction that other content in its release requires (notices, shared references, pinned runtime
 *      source). Instructions nothing requires, such as rules and steering files, stay choosable content. This holds
 *      even where the Catalog marks the instruction supported for a tool, as it does for `ecc.notices`; or
 *   3. an item of the same kind that the Catalog supports for some tool requires it, while the Catalog supports it for
 *      no tool: the part of a hook that holds its script files.
 * Content that other content needs (a skill another skill uses, an agent a command uses) is not supporting material.
 */
function isSupporting(item, requirers) {
  if (SUPPORTING_KINDS.has(item.kind)) return true;
  if (!requirers.length) return false;
  if (item.kind === 'instruction') return true;
  return !supportedAnywhere(item) && requirers.some(other => other.kind === item.kind && supportedAnywhere(other));
}

/** The entry ids (`<releaseSha256>/<itemId>`) of the supporting material among the catalog's items. */
export function supportingMaterial(items) {
  const by = requiredBy(items);
  return new Set(items.filter(item => isSupporting(item, by.get(entryKey(item.root?.releaseSha256, item.id)) ?? []))
    .map(item => entryKey(item.root?.releaseSha256, item.id)));
}

/**
 * What an item's details say comes with it, as lines: `needs` are the items the Catalog's resolver brings with it
 * (its required closure, without the item itself), `supporting` the catalog's supporting material (supportingMaterial).
 * Each needed item is named by its label in the installed catalog, else its id.
 */
export function comesWith({ needs, items, supporting }) {
  if (!needs.length) return ['Needs no other items.'];
  const itemOf = ref => items.find(item => item.id === ref.itemId && item.root?.releaseSha256 === ref.releaseSha256);
  const name = ref => String(itemOf(ref)?.label ?? ref.itemId);
  const files = needs.filter(ref => supporting.has(entryKey(ref.releaseSha256, ref.itemId))), others = needs.filter(ref => !files.includes(ref));
  return [
    files.length ? `Comes with ${files.length} supporting ${files.length === 1 ? 'file' : 'files'}: ${files.map(name).join(', ')}.` : '',
    others.length ? `Also adds ${others.length} ${others.length === 1 ? 'item' : 'items'} it needs: ${others.map(name).join(', ')}.` : '',
  ].filter(Boolean);
}

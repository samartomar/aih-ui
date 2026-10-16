/*
 * The AI clients Core publishes, as the preview summary's coreTargets carries them.
 *
 * Core's `nativeClientIds` (via @aihq/core/harness) name the clients, in Core's order,
 * which is not a ranking. Harness publishes a display label for each; one is used only
 * when it is published, and an id without a label displays as its id. A client in the
 * list is not thereby installed, connected or admitted.
 */

import { el } from "./dom.js";

/**
 * @param coreTargets the summary's { state, targets, labels } or { state, reason }
 * @returns { ids, labels } or null when Core publishes no list
 */
export function publishedClients(coreTargets) {
  if (coreTargets?.state !== "published" || !Array.isArray(coreTargets.targets)) return null;
  const ids = coreTargets.targets.filter((target) => typeof target === "string" && target !== "");
  const labels = {};
  for (const id of ids) {
    const label = coreTargets.labels && Object.hasOwn(coreTargets.labels, id) ? coreTargets.labels[id] : null;
    if (typeof label === "string" && label !== "") labels[id] = label;
  }
  return { ids, labels };
}

/** The published label for an id, or null. */
export function clientLabel(labels, id) {
  return Object.hasOwn(labels, id) ? labels[id] : null;
}

/** Plain text for an option or tooltip: "Claude Code (claude)", or the bare id. */
export function clientText(labels, id) {
  const label = clientLabel(labels, id);
  return label ? `${label} (${id})` : id;
}

/** Nodes for a row: the label, then the id in mono; the bare mono id when no label is published. */
export function clientNodes(labels, id) {
  const label = clientLabel(labels, id);
  return label
    ? [el("span", "", label), el("span", "font-mono text-on-surface-variant", id)]
    : [el("span", "font-mono", id)];
}

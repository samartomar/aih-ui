/**
 * The AI clients Core supports as targets, from the installed @aihq/core's
 * public `nativeClientIds` export in `@aihq/core/harness`, with the display
 * labels Harness publishes for the same ids in its `targets`.
 *
 * This is Core's canonical list, not a copy: updating and reinstalling Core
 * updates it with no UI edit. It establishes target identities only, in Core's
 * order, which is not a ranking. Whether a tool is installed, connected or
 * admitted is a separate fact this list does not carry, and nothing here runs a
 * tool or reads its help. A label is used only when Harness publishes one; an id
 * without a label displays as its id.
 *
 * Loaded on demand by core-service.mjs, so an installed Core that does not
 * export the list fails this one operation instead of every operation.
 */
import { nativeClientIds, targets as harnessTargets } from "@aihq/core/harness";

const TARGET = /^[a-z][a-z0-9-]{0,63}$/;

export function coreTargets() {
  if (!Array.isArray(nativeClientIds) || nativeClientIds.length === 0) {
    throw new Error("@aihq/core/harness exported nativeClientIds, but it is not a non-empty list");
  }
  for (const target of nativeClientIds) {
    if (typeof target !== "string" || !TARGET.test(target)) {
      throw new Error(`@aihq/core/harness nativeClientIds holds an unexpected value: ${JSON.stringify(target)}`);
    }
  }
  if (new Set(nativeClientIds).size !== nativeClientIds.length) {
    throw new Error("@aihq/core/harness nativeClientIds lists a client twice");
  }
  const labels = {};
  for (const target of Array.isArray(harnessTargets) ? harnessTargets : []) {
    if (nativeClientIds.includes(target?.id) && typeof target.label === "string" && target.label !== "") {
      labels[target.id] = target.label;
    }
  }
  return { targets: [...nativeClientIds], labels };
}

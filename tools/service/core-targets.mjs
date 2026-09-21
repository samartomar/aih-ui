/**
 * The AI CLIs Core supports as targets, from the installed @aihq/core's public
 * `SUPPORTED_CLIS` export.
 *
 * This is Core's canonical list, not a copy: updating and reinstalling Core
 * updates it with no UI edit. It establishes target identities only. Whether a
 * tool is installed, connected or selected is a separate fact this list does
 * not carry, and nothing here runs a tool or reads its help.
 *
 * Loaded on demand by core-service.mjs, so an installed Core that does not
 * export the list fails this one operation instead of every operation.
 */
import { SUPPORTED_CLIS } from "@aihq/core";

const TARGET = /^[a-z][a-z0-9-]{0,63}$/;

export function coreTargets() {
  if (!Array.isArray(SUPPORTED_CLIS) || SUPPORTED_CLIS.length === 0) {
    throw new Error("@aihq/core exported SUPPORTED_CLIS, but it is not a non-empty list");
  }
  for (const target of SUPPORTED_CLIS) {
    if (typeof target !== "string" || !TARGET.test(target)) {
      throw new Error(`@aihq/core SUPPORTED_CLIS holds an unexpected value: ${JSON.stringify(target)}`);
    }
  }
  if (new Set(SUPPORTED_CLIS).size !== SUPPORTED_CLIS.length) {
    throw new Error("@aihq/core SUPPORTED_CLIS lists a target twice");
  }
  return { targets: [...SUPPORTED_CLIS] };
}

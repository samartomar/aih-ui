/*
 * Which AI client a Catalog adapter is for, kept apart from two other facts.
 *
 *   - TARGET: the `clientId` Catalog's release format 1.4 puts on a `client-adapter`
 *     item. It names the target only. An adapter from an earlier release format
 *     carries none, so its target is not declared: it is never read out of the
 *     item id (`aihq.client.<x>` is just a name).
 *   - CORE-SUPPORTED: membership in the clients @aihq/core lists in its public
 *     nativeClientIds. An adapter for a client Core does not list is shown, not
 *     hidden and not an error. With no list, support is unknown.
 *   - INSTALLED / CONNECTED: observed evidence only (a readiness check's tool state
 *     for that client, in the vocabulary Core's diagnostic contract defines: runnable,
 *     binary, broken, config-only, absent). Neither the target nor the Core list ever
 *     implies it, and a value outside that vocabulary is "unknown", not "absent".
 *
 * Pure and free of browser and Node built-ins. tools/consumer/client-identity.mjs is
 * this same file, because the headless consumer modules don't import from src/;
 * tools/tests/client-identity.test.mjs fails if the two differ.
 */

export const CLIENT_ADAPTER_KIND = "client-adapter";

const CLIENT_ID = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * @returns null for an item that is not a client adapter, otherwise
 *   { state: "declared", clientId } or { state: "undeclared" }.
 */
export function adapterTargetOf(item) {
  if (item?.kind !== CLIENT_ADAPTER_KIND) return null;
  return typeof item.clientId === "string" && CLIENT_ID.test(item.clientId)
    ? { state: "declared", clientId: item.clientId }
    : { state: "undeclared" };
}

/** The first adapter, in the order the items were supplied, whose declared target is `clientId`. */
export function adapterFor(items, clientId) {
  return (items ?? []).find((item) => adapterTargetOf(item)?.clientId === clientId);
}

/** Every declared adapter target once, sorted. */
export function adapterClientIds(items) {
  const ids = (items ?? []).map((item) => adapterTargetOf(item)?.clientId).filter((id) => id !== undefined);
  return [...new Set(ids)].sort();
}

const INSTALLED = {
  "not-checked": "Installed or connected: not checked.",
  found: "Installed or connected: found by a check on this machine.",
  "found-not-run": "Installed or connected: found by a check on this machine, but not run.",
  "found-failed": "Installed or connected: found by a check on this machine, but its check failed.",
  "config-only": "Installed or connected: only its configuration was found, not the program.",
  "not-found": "Installed or connected: the last check did not find it.",
  unknown: "Installed or connected: the check could not tell.",
};
const FROM_CORE = { runnable: "found", binary: "found-not-run", broken: "found-failed", "config-only": "config-only", absent: "not-found" };

/**
 * The installed state a readiness check's tool state stands for. Only Core's own words count:
 * its explicit "absent" is "not-found", and any other or unrecognised string is "unknown".
 * Nothing at all (or a non-string) means no check observed the client.
 */
export function installedStateOf(observation) {
  if (typeof observation !== "string" || observation === "") return "not-checked";
  return Object.hasOwn(FROM_CORE, observation) ? FROM_CORE[observation] : "unknown";
}

/** True when the check found the program itself (runnable, binary or broken), which configuration alone does not. */
export function programWasFound(observation) {
  return ["found", "found-not-run", "found-failed"].includes(installedStateOf(observation));
}

/**
 * The three facts for one adapter item, each stated on its own.
 *
 * @param coreClients Core's nativeClientIds as an array, or anything else when Core publishes none
 * @param observation a readiness check's tool state for the target client (see installedStateOf), or nothing
 * @returns null for an item that is not a client adapter, otherwise { target, core, installed } where each is { state, text }
 */
export function describeClientIdentity({ item, coreClients, observation } = {}) {
  const target = adapterTargetOf(item);
  if (target === null) return null;
  const listed = Array.isArray(coreClients);
  let core;
  if (target.state !== "declared" || !listed) {
    core = { state: "unknown", text: target.state !== "declared"
      ? "Core support: unknown, because the target is not declared."
      : "Core support: unknown, because Core publishes no client list here." };
  } else if (coreClients.includes(target.clientId)) {
    core = { state: "supported", text: `Core-supported: Core lists ${target.clientId}.` };
  } else {
    core = { state: "not-supported", text: `Not Core-supported: Core does not list ${target.clientId}.` };
  }
  const seen = installedStateOf(observation);
  return {
    target: target.state === "declared"
      ? { ...target, text: `Adapter target: ${target.clientId}.` }
      : { ...target, text: "Adapter target: not declared by this release format." },
    core,
    installed: { state: seen, text: INSTALLED[seen] },
  };
}

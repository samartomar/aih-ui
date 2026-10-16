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
 *   - INSTALLED / CONNECTED: observed evidence only (a readiness check's presence
 *     for that client). Neither the target nor the Core list ever implies it.
 *
 * Pure and free of browser and Node built-ins. tools/consumer/client-identity.mjs is
 * this same file, because the headless readers cannot import the page modules;
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
  "found-failed": "Installed or connected: found by a check on this machine, but its check failed.",
  "not-found": "Installed or connected: the last check did not find it.",
};

/**
 * The three facts for one adapter item, each stated on its own.
 *
 * @param coreClients Core's nativeClientIds as an array, or anything else when Core publishes none
 * @param observation a readiness check's presence for the target client ("present", "broken", other), or nothing
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
  const seen = typeof observation !== "string" || observation === ""
    ? "not-checked"
    : observation === "present" ? "found" : observation === "broken" ? "found-failed" : "not-found";
  return {
    target: target.state === "declared"
      ? { ...target, text: `Target: ${target.clientId}.` }
      : { ...target, text: "Target: not declared by this release format." },
    core,
    installed: { state: seen, text: INSTALLED[seen] },
  };
}

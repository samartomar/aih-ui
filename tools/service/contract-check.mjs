/**
 * Whether the installed @aihq/core publishes `checkContracts`, the contract
 * check that runs every package's fixtures against every reader.
 *
 * Only the public entries are looked at, and only for the name: nothing is
 * called, so a Core that has the check is reported as offering it, and running
 * it waits until Core publishes its result format. A Core without it (every
 * Core so far) is reported as `absent`, which the page words as the contract
 * says: "This Core can't check contracts yet."
 *
 * Loaded on demand by core-service.mjs.
 */
const ENTRIES = ["@aihq/core/contracts", "@aihq/core"];

export async function contractCheck() {
  const unreadable = [];
  for (const entry of ENTRIES) {
    let module;
    try {
      module = await import(entry);
    } catch (error) {
      unreadable.push(`${entry}: ${error?.message ?? String(error)}`);
      continue;
    }
    if (typeof module.checkContracts === "function") return { state: "available", entry };
  }
  // An entry that could not be read might hold the check, so its absence is not established.
  if (unreadable.length) return { state: "unknown", reason: unreadable.join("; ") };
  return { state: "absent", entries: ENTRIES };
}

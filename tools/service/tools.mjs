/**
 * The header's Your tool control reads two Core answers, each through its public
 * export in the installed package:
 *
 *   tools()          Harness `listTools({ includeUnobserved: true })` from
 *                    `@aihq/core/harness`: every registry tool in registry order.
 *                    A tool is observed when `listTools()` also lists it; an
 *                    unobserved tool carries the refusal `selectTool` gives for it
 *                    (its code and reason), never a reason written here.
 *   toolInspection() Core `inspect({ network: 'off' })` from `@aihq/core`: each
 *                    tool's existence/run `state` and `selection`, and the
 *                    observations for its target. Offline, so no network probe
 *                    runs; read-only, so nothing is repaired or recorded.
 *
 * The harness module is imported as a namespace, so a Core that predates
 * `listTools` answers "unavailable" instead of failing to load. Nothing here
 * names a tool, decides observation or interprets a state: the page shows what
 * Core returned.
 */
import * as harness from "@aihq/core/harness";

const text = value => typeof value === "string" ? value : undefined;

export function tools() {
  if (typeof harness.listTools !== "function") {
    return { state: "unavailable", reason: "The installed @aihq/core/harness does not export listTools." };
  }
  const all = harness.listTools({ includeUnobserved: true });
  const observed = new Set(harness.listTools().map(entry => entry.id));
  return {
    state: "published",
    tools: all.map(entry => {
      const row = { id: entry.id, label: entry.label, surface: entry.surface, observed: observed.has(entry.id) };
      if (row.observed || typeof harness.selectTool !== "function") return row;
      const refusal = harness.selectTool(entry.id);
      return refusal?.status === "refused" ? { ...row, refusal: { code: text(refusal.code), reason: text(refusal.reason) } } : row;
    }),
  };
}

// Inspection runs local version commands; a short budget keeps the header from waiting on a slow machine.
const BUDGET_MS = 30_000;

export async function toolInspection() {
  const { inspect } = await import("@aihq/core");
  const result = await inspect({ network: "off" }, { budgetMs: BUDGET_MS });
  return {
    status: result.status,
    package: result.package,
    // A tool's `config` trace is a home-relative path; the header does not need it, so it never leaves the host.
    tools: (result.tools ?? []).map(entry => ({ id: entry.id, label: entry.label, state: entry.state, selection: entry.selection })),
    observations: (result.observations ?? []).map(entry => ({ id: entry.id, target: entry.target, detail: entry.detail })),
    diagnostics: (result.diagnostics ?? []).map(entry => ({ code: entry.code, reason: entry.reason, message: entry.message })),
  };
}

/**
 * The header's Your tool control reads two Core answers, each through its public
 * export in the installed package:
 *
 *   tools()          Harness `listTools({ includeUnobserved: true })` from
 *                    `@aihq/core/harness`: every registry tool in registry order.
 *                    A tool is observed when `listTools()` also lists it; an
 *                    unobserved tool carries the refusal `selectTool` gives for it
 *                    (its code and reason), never a reason written here.
 *   toolInspection() Harness `inspectToolHost` from its runtime export:
 *                    bounded read-only filesystem/configuration facts, with
 *                    unknown versions kept unchecked. No client is launched.
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
    return { state: "unavailable", reason: "The installed Core does not publish its tool list." };
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

// Header observations read local files only. Check this machine retains its own explicit diagnostic action.

export async function toolInspection() {
  const { inspectToolHost } = await import('@aihq/core/harness/runtime');
  const observations = [];
  for (const tool of harness.listTools()) {
    try { observations.push({ id: tool.id, host: await inspectToolHost({ tool: tool.id, project: process.env.AIH_CONSUMER_PROJECT ?? process.cwd(), items: [] }, { budgetMs: 3000 }) }); }
    catch { observations.push({ id: tool.id, host: { status: 'failed' } }); }
  }
  return { state: 'inspected', method: 'read-only-host', status: 'complete', tools: observations, observations: [], diagnostics: [] };
}

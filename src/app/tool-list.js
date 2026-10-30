/*
 * Core's tool list: the one list every tool choice on the page reads.
 *
 * It is Harness `listTools({ includeUnobserved: true })` as the host answers
 * GET /api/tools (tools/service/tools.mjs), in Core's order with Core's labels.
 * Setup's Your tools step, the header's Your tools and the rail all show these
 * tools by these labels, so an id setup saves is the id the header chooses.
 *
 * A tool Core does not support yet (one plain `listTools()` does not offer) is
 * still listed and can be chosen; the page says so in words, never by a code.
 */

export const NOT_SUPPORTED_YET = "Not supported yet";

/** GET /api/tools: { state: "published", tools } or { state, reason }; a failure is the failed state, never an empty list. */
export async function readToolList() {
  try {
    const response = await fetch("/api/tools", { cache: "no-store" });
    const answer = await response.json();
    return response.ok && answer.ok === true ? answer : { state: "failed", reason: answer?.error ?? `the host answered ${response.status}` };
  } catch (error) {
    return { state: "failed", reason: error?.message ?? String(error) };
  }
}

/** The listed tools, or null while the list is loading or unavailable. */
export const listedTools = (list) => (list?.state === "published" && Array.isArray(list.tools) ? list.tools : null);

/** Core's label for each listed id. */
export function toolLabels(list) {
  return Object.fromEntries((listedTools(list) ?? []).map((tool) => [tool.id, tool.label ?? tool.id]));
}

/**
 * Chosen ids by Core's label, in the order given. Ids the list no longer holds are counted, never shown raw.
 * @returns e.g. "Claude Code, Cursor" or "Claude Code and 1 tool Core no longer lists"
 */
export function toolNames(labels, ids) {
  const named = ids.filter((id) => Object.hasOwn(labels, id)).map((id) => labels[id]);
  const gone = ids.length - named.length;
  const rest = gone ? `${gone} tool${gone === 1 ? "" : "s"} Core no longer lists` : "";
  return named.length && rest ? `${named.join(", ")} and ${rest}` : named.join(", ") || rest;
}

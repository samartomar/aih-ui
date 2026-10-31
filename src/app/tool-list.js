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

// A read that has not answered within this long is a failure: the page says so in words and keeps listening.
export const TOOL_LIST_TIMEOUT_MS = 20_000;

/**
 * One GET /api/tools: { state: "published", tools } or { state, reason }. A failure, or no answer (body included) within
 * the timeout, is the failed state, never an empty list.
 */
export async function readToolList({ timeoutMs = TOOL_LIST_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { controller?.abort(); resolve({ state: "failed", reason: `the host did not answer within ${Math.round(timeoutMs / 1000)}s` }); }, timeoutMs);
  });
  const read = (async () => {
    try {
      const response = await fetch("/api/tools", { cache: "no-store", signal: controller?.signal });
      const answer = await response.json();
      return response.ok && answer.ok === true ? answer : { state: "failed", reason: answer?.error ?? `the host answered ${response.status}` };
    } catch (error) {
      return { state: "failed", reason: error?.message ?? String(error) };
    }
  })();
  try { return await Promise.race([read, timedOut]); } finally { clearTimeout(timer); }
}

/**
 * The page's one read of Core's tool list, shared by setup, the header, the rail, the catalog and the authoring
 * workspace, so they can never disagree. `load()` starts a read unless one is on its way or a list is already here; a
 * failed read is retried once before anyone hears of it, so a list that comes on the retry shows with no failure first.
 * Every answer reaches every subscriber, so a list that arrives late, or on a later load (setup re-opened after a
 * failure), updates whatever already showed the failure.
 */
export function createToolListStore({ read = readToolList } = {}) {
  let answer;           // the latest answer published, undefined until the first
  let pending = null;   // the read on its way
  const listeners = new Set();
  const publish = (value) => {
    // A failure never replaces a list already published.
    if (value.state === "failed" && listedTools(answer)) return;
    answer = value;
    for (const listener of [...listeners]) listener(value);
  };
  function load() {
    if (pending) return pending;
    if (answer && answer.state !== "failed") return Promise.resolve(answer);
    pending = (async () => {
      let value = await read();
      if (value.state === "failed") value = await read();
      publish(value);
      return answer;
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    load,
    /** Calls `listener` with every answer from now on, and at once with the current one if there is one. */
    subscribe(listener) {
      listeners.add(listener);
      if (answer) listener(answer);
      return () => listeners.delete(listener);
    },
    get current() { return answer; },
  };
}

/** The page's shared tool list. */
export const toolList = createToolListStore();

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

// Setup's words when it has no tools to offer: fixed, so no raw error text reaches the page. The header's alert keeps
// the reason for whoever needs it. Both say the person can go on and choose later.
export const SETUP_TOOLS_LOADING = "Loading your tools… You can continue and choose them later from Settings.";
const SETUP_TOOLS_NOTICE = "Your tools couldn't be loaded. Tools you already chose stay chosen; you can continue and choose them later from Settings.";
/** The notice setup shows in place of its tool list: loading before any answer, the failure sentence, or null when there are tools to offer. */
export const setupToolsNotice = (list) => (list === undefined ? SETUP_TOOLS_LOADING : listedTools(list)?.length ? null : SETUP_TOOLS_NOTICE);

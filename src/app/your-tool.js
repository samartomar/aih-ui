/*
 * The header's Your tools control: every AI tool the person works in. It is
 * always a multi-select; people use several tools.
 *
 * Each fact on it comes from Core, read by the host through public exports
 * (tools/service/tools.mjs):
 *
 *   - THE LIST: Core's tool list (src/app/tool-list.js), Harness
 *     `listTools({ includeUnobserved: true })` in registry order, with Harness's
 *     labels and surfaces: the same list setup offers. The page keeps no tool names.
 *   - SUPPORTED: a tool `listTools()` also offers (an observed binding). Every
 *     other tool stays listed and choosable, greyed and marked "Not supported
 *     yet" in words; Core's refusal code is never shown.
 *   - THE READY ICON: the tool's existence/run state from Core's offline
 *     `inspect`, matched by the registry id. A tool the inspection does not
 *     report says so; nothing is assumed.
 *
 * The choice is a per-viewer convenience kept in this browser's local storage
 * (only the tool ids), so it survives a restart of the Workbench. Every tool
 * chosen in setup is chosen here: until the person changes it here, the choice
 * is setup's tools with an older single choice from this browser, and a tool
 * setup newly chooses later joins a saved choice. A tool unticked here stays
 * unticked until setup's choice changes. It is not a policy. Tools Core does not
 * support yet stay chosen and say so; the page claims no fit for them.
 *
 * States: loading (no answer yet), empty (Core lists no tools), unavailable
 * (this Core publishes no listTools), failed (the host could not read it).
 */

import { el } from "./dom.js";
import { iconFor, iconSpan } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { NOT_SUPPORTED_YET, readToolList } from "./tool-list.js";

// The older single-tool choice; read once as part of the starting set, never written.
export const YOUR_TOOL_KEY = "wb-your-tool";
export const YOUR_TOOLS_KEY = "wb-your-tools";
// Setup's tools as this browser last took them in, so only a tool setup newly chooses joins a saved choice.
export const YOUR_TOOLS_SETUP_KEY = "wb-your-tools-setup";
const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const KEPT = "Kept in this browser only.";
const NOT_PROOF = "Finding a tool is not proof that it loads content.";
const SURFACE = { cli: "CLI", ide: "IDE" };

function savedChoice(key = YOUR_TOOLS_KEY) {
  try {
    const value = JSON.parse(storage()?.getItem(key) ?? "null");
    return Array.isArray(value) && value.every((id) => typeof id === "string") ? value : null;
  } catch { return null; }
}

/**
 * @param elements { yourToolTrigger, yourToolIcon, yourToolName, yourToolPop, yourToolList, yourToolNote }
 * @param onList receives Core's tool list once read, for every other control that shows tools (setup's step)
 */
export function createYourTool({ elements, onChange = () => {}, onList = () => {} }) {
  let list;              // undefined while loading; then the /api/tools answer
  let inspection;        // undefined while checking; then the /api/tool-inspection answer
  // A group of checkboxes, never a radio group: everyone uses several tools.
  elements.yourToolList.setAttribute("role", "group");
  let saved = savedChoice();
  let legacy = null;
  try { legacy = storage()?.getItem(YOUR_TOOL_KEY) ?? null; } catch { legacy = null; }
  let setupClients = [];
  // The chosen ids: the saved multi-tool choice, else setup's tools with the older single choice.
  const chosenIds = () => saved ?? [...new Set([...(legacy ? [legacy] : []), ...setupClients])];
  // Chosen registry tools in Core's registry order; ids the registry does not list are reported in the note.
  const chosenTools = () => (list?.state === "published" ? list.tools.filter((tool) => chosenIds().includes(tool.id)) : []);

  const isOpen = () => !elements.yourToolPop.hidden;
  function setOpen(open) {
    elements.yourToolPop.hidden = !open;
    elements.yourToolTrigger.setAttribute("aria-expanded", String(open));
    if (open) (elements.yourToolList.querySelector('[aria-checked="true"]') ?? elements.yourToolList.querySelector("button"))?.focus();
  }

  // The ready state of one registry tool: its key in the icon map and the words Core's answer supports.
  function ready(tool) {
    if (inspection === undefined) return { key: "checking", words: "Checking this machine with Core's inspection…" };
    if (inspection.state !== "inspected") return { key: "inspection-failed", words: `Core's inspection didn't run: ${inspection.reason ?? "no reason was given"}.` };
    if (inspection.method === 'read-only-host') {
      const host = inspection.tools.find(row => row.id === tool.id)?.host;
      return { key: host?.installedVersion?.state === 'known' ? 'binary' : 'not-reported', words: host?.installedVersion?.state === 'known' ? `Version ${host.installedVersion.version} found in local files. Read-only host inspection; the client was not launched.` : `Host version unchecked: ${host?.installedVersion?.reason ?? host?.status ?? 'unavailable'}. No client was launched.` };
    }
    const found = inspection.tools.find((row) => row.id === tool.id);
    if (!found) {
      // A cancelled or invalid inspection reports no tools at all; say so on the row, not only in the note.
      const ran = !inspection.status || ["complete", "incomplete"].includes(inspection.status) ? "" : ` (the inspection was ${inspection.status})`;
      return { key: "not-reported", words: `Core's inspection doesn't report ${tool.label ?? tool.id}${ran}.` };
    }
    const shown = iconFor("tool", found.state);
    const named = found.label && found.label !== tool.label ? ` (as ${found.label})` : "";
    const details = inspection.observations.filter((row) => row.target === tool.id && row.detail).map((row) => row.detail);
    return { key: found.state, words: [`Core's inspection${named}: ${shown.known ? shown.label : `state ${found.state}`}.`, ...details].join(" ") };
  }

  const UNSUPPORTED = "Not supported yet: Core can't check fit or install content for it yet, so no fit is shown for it. It stays chosen.";

  function keep(key, value) {
    try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* Local storage may be unavailable; the choice still applies here. */ }
  }

  function toggle(tool) {
    const ids = chosenIds();
    saved = ids.includes(tool.id) ? ids.filter((id) => id !== tool.id) : [...ids, tool.id];
    keep(YOUR_TOOLS_KEY, saved);
    render();
    // The list stays open: ticking one tool is often followed by the next.
    onChange(chosenTools());
  }

  function row(tool) {
    const state = ready(tool);
    const button = el("button", "your-tool-option");
    button.type = "button";
    button.setAttribute("role", "checkbox");
    button.dataset.tool = tool.id;
    button.setAttribute("aria-checked", String(chosenIds().includes(tool.id)));
    const surface = SURFACE[tool.surface] ?? tool.surface;
    const words = el("span", "your-tool-option-words");
    words.append(el("span", "your-tool-option-name", tool.label ?? tool.id));
    if (!tool.observed) words.append(el("span", "your-tool-option-reason", NOT_SUPPORTED_YET));
    button.append(iconSpan("tool", state.key, { size: "text-[16px]" }), words);
    if (surface) button.append(el("span", "your-tool-option-surface", surface));
    const head = `${tool.label ?? tool.id}${surface ? ` (${surface})` : ""}.`;
    // A tool Core does not support yet can still be one of yours; it is shown greyed and says so.
    if (!tool.observed) button.dataset.unobserved = "true";
    attachTooltip(button, tool.observed ? `${head} ${state.words} ${NOT_PROOF}` : `${head} ${UNSUPPORTED} ${state.words}`);
    button.addEventListener("click", () => toggle(tool));
    return button;
  }

  function note(words, className = "") {
    const node = el("p", className, words);
    elements.yourToolNote.append(node);
    return node;
  }

  function trigger(key, name, words) {
    elements.yourToolIcon.replaceChildren(iconSpan("tool", key, { size: "text-[14px]" }));
    elements.yourToolName.textContent = name;
    attachTooltip(elements.yourToolTrigger, words);
  }

  function render() {
    elements.yourToolList.replaceChildren();
    elements.yourToolNote.replaceChildren();
    const state = list === undefined ? "loading" : list.state === "published" ? (list.tools.length ? "listed" : "empty") : list.state === "unavailable" ? "unavailable" : "failed";
    elements.yourToolTrigger.dataset.yourTool = state;
    if (state === "loading") {
      trigger("checking", "Loading…", "Your tools: loading the tools Core knows…");
      note("Loading the tools Core knows…").setAttribute("role", "status");
      return;
    }
    if (state === "empty") {
      trigger("none", "None listed", "Your tools: Core lists no tools, so there is nothing to choose.");
      note("Core lists no tools.");
      return;
    }
    if (state === "unavailable") {
      const reason = list.reason ?? "The installed Core does not publish its tool list.";
      trigger("none", "Not published", `Your tools: not published. ${reason}`);
      note(`Not published: ${reason}`);
      return;
    }
    if (state === "failed") {
      const reason = list.reason ?? "no reason was given";
      trigger("inspection-failed", "Couldn't load", `Your tools: the tool list couldn't be read: ${reason}.`);
      note(`The tool list couldn't be read: ${reason}.`, "text-error").setAttribute("role", "alert");
      return;
    }

    elements.yourToolList.append(...list.tools.map(row));
    const current = chosenTools(), names = current.map((tool) => tool.label ?? tool.id).join(", ");
    const lead = current.find((tool) => tool.observed);
    if (current.length) {
      const shown = lead ? ready(lead) : { key: "none", words: "" };
      trigger(shown.key, names, `Your tools: ${names}. ${lead ? shown.words : ""} ${KEPT}`);
    } else {
      trigger("none", "Choose", `Your tools: none chosen. Choose every AI tool you work in. ${KEPT}`);
    }
    const observed = list.tools.filter((tool) => tool.observed).length;
    note(`Choose every tool you use. Core supports ${observed} of these ${list.tools.length} tools so far. ${KEPT}`);
    const unobserved = current.filter((tool) => !tool.observed), one = unobserved.length === 1;
    if (unobserved.length) note(`${unobserved.map((tool) => tool.label ?? tool.id).join(", ")}: not supported yet. Core can't check fit or install content for ${one ? "it" : "them"} yet, so no fit is shown and nothing is installed for ${one ? "it" : "them"}. ${one ? "It stays" : "They stay"} chosen.`);
    const unknown = chosenIds().filter((id) => !list.tools.some((tool) => tool.id === id)).length;
    if (unknown) note(`${unknown} chosen tool${unknown === 1 ? " is" : "s are"} no longer in Core's list.`);
    if (inspection === undefined) note("Checking this machine with Core's inspection…").setAttribute("role", "status");
    else if (inspection.state !== "inspected") note(`Core's inspection didn't run: ${inspection.reason ?? "no reason was given"}.`, "text-error");
    else note(`Icons: Core's offline inspection of this machine${inspection.package?.version ? ` (${inspection.package.name ?? "@aihq/core"} ${inspection.package.version})` : ""}${inspection.status && inspection.status !== "complete" ? `, ${inspection.status}` : ""}. ${NOT_PROOF}`);
  }

  elements.yourToolTrigger.addEventListener("click", () => setOpen(!isOpen()));
  // Arrow keys move between the tools; Tab still reaches each one, greyed ones included.
  elements.yourToolList.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const buttons = [...elements.yourToolList.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[(at + step + buttons.length) % buttons.length].focus();
  });
  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    // A tick re-renders the list, so the clicked row is already detached here; it was inside, not outside.
    if (event.target?.isConnected === false) return;
    if (elements.yourToolPop.contains(event.target) || elements.yourToolTrigger.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      elements.yourToolTrigger.focus();
    }
  });

  async function readInspection(path) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      const answer = await response.json();
      return response.ok && answer.ok === true ? answer : { state: "failed", reason: answer?.error ?? `the host answered ${response.status}` };
    } catch (error) {
      return { state: "failed", reason: error?.message ?? String(error) };
    }
  }

  render();

  return {
    /** Reads the tool list, then the inspection; each answer re-renders as it arrives. */
    async start() {
      list = await readToolList();
      onList(list);
      render();
      onChange(chosenTools());
      if (list.state !== "published" || list.tools.length === 0) return;
      inspection = await readInspection("/api/tool-inspection");
      render();
    },
    /** The chosen tools' registry entries, in registry order (each with Core's `observed`). */
    current: () => chosenTools(),
    /** Setup's tools: every one is chosen here; one setup newly chooses joins a saved choice. */
    setSetupClients(clients) {
      setupClients = Array.isArray(clients) ? clients : [];
      if (saved) {
        const known = savedChoice(YOUR_TOOLS_SETUP_KEY) ?? [];
        const added = setupClients.filter((id) => !known.includes(id) && !saved.includes(id));
        if (added.length) { saved = [...saved, ...added]; keep(YOUR_TOOLS_KEY, saved); }
      }
      keep(YOUR_TOOLS_SETUP_KEY, setupClients);
      render();
      if (list?.state === "published") onChange(chosenTools());
    },
  };
}

/*
 * The header's Your tool control: the one AI tool the person works in.
 *
 * Each fact on it comes from Core, read by the host through public exports
 * (tools/service/tools.mjs):
 *
 *   - THE LIST: Harness `listTools({ includeUnobserved: true })`, in registry
 *     order, with Harness's labels and surfaces. The page keeps no tool names.
 *   - CHOOSABLE: a tool `listTools()` also offers (an observed binding). Every
 *     other tool stays listed, greyed, with the refusal Core's `selectTool`
 *     gives for it as its reason.
 *   - THE READY ICON: the tool's existence/run state from Core's offline
 *     `inspect`, matched by the registry id. A tool the inspection does not
 *     report says so; nothing is assumed.
 *
 * The choice is a per-viewer convenience kept in this browser's local storage
 * (only the tool id), so it survives a restart of the Workbench. It is not a
 * policy and not the workspace setup's AI clients.
 *
 * States: loading (no answer yet), empty (Core lists no tools), unavailable
 * (this Core publishes no listTools), failed (the host could not read it).
 */

import { el } from "./dom.js";
import { iconFor, iconSpan } from "./icons.js";
import { attachTooltip } from "./tooltip.js";

export const YOUR_TOOL_KEY = "wb-your-tool";
const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const KEPT = "Kept in this browser only.";
const NOT_PROOF = "Finding a tool is not proof that it loads content.";
const SURFACE = { cli: "CLI", ide: "IDE" };

/** @param elements { yourToolTrigger, yourToolIcon, yourToolName, yourToolPop, yourToolList, yourToolNote } */
export function createYourTool({ elements, onChange = () => {} }) {
  let list;              // undefined while loading; then the /api/tools answer
  let inspection;        // undefined while checking; then the /api/tool-inspection answer
  let chosen = null;
  try { chosen = storage()?.getItem(YOUR_TOOL_KEY) ?? null; } catch { chosen = null; }

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

  function refusalWords(tool) {
    const reason = tool.refusal?.reason;
    if (reason === "tool-not-observed") return `Can't be chosen: Core hasn't observed it working (${reason}).`;
    return reason ? `Can't be chosen: Core refuses it (${reason}).` : "Can't be chosen: Core's listTools() does not offer it, and Core gave no reason.";
  }

  function choose(tool) {
    chosen = tool.id;
    try { storage()?.setItem(YOUR_TOOL_KEY, tool.id); } catch { /* Local storage may be unavailable; the choice still applies here. */ }
    render();
    setOpen(false);
    elements.yourToolTrigger.focus();
    onChange(tool);
  }

  function row(tool) {
    const state = ready(tool);
    const button = el("button", "your-tool-option");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.tool = tool.id;
    button.setAttribute("aria-checked", String(tool.observed && tool.id === chosen));
    const surface = SURFACE[tool.surface] ?? tool.surface;
    const words = el("span", "your-tool-option-words");
    words.append(el("span", "your-tool-option-name", tool.label ?? tool.id));
    if (!tool.observed) words.append(el("span", "your-tool-option-reason", "Not observed by Core"));
    button.append(iconSpan("tool", state.key, { size: "text-[16px]" }), words);
    if (surface) button.append(el("span", "your-tool-option-surface", surface));
    const head = `${tool.label ?? tool.id}${surface ? ` (${surface})` : ""}.`;
    if (tool.observed) {
      attachTooltip(button, `${head} ${state.words} ${NOT_PROOF}`);
      button.addEventListener("click", () => choose(tool));
    } else {
      // Greyed but still focusable, so its reason is reachable by keyboard and touch.
      button.setAttribute("aria-disabled", "true");
      attachTooltip(button, `${head} ${refusalWords(tool)} ${state.words}`);
    }
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
      trigger("checking", "Loading…", "Your tool: loading the tools Core knows…");
      note("Loading the tools Core knows…").setAttribute("role", "status");
      return;
    }
    if (state === "empty") {
      trigger("none", "None listed", "Your tool: Core's tool registry lists no tools, so there is nothing to choose.");
      note("Core's tool registry lists no tools.");
      return;
    }
    if (state === "unavailable") {
      const reason = list.reason ?? "The installed Core does not publish its tool registry.";
      trigger("none", "Not published", `Your tool: not published. ${reason}`);
      note(`Not published: ${reason}`);
      return;
    }
    if (state === "failed") {
      const reason = list.reason ?? "no reason was given";
      trigger("inspection-failed", "Couldn't load", `Your tool: the tool list couldn't be read: ${reason}.`);
      note(`The tool list couldn't be read: ${reason}.`, "text-error").setAttribute("role", "alert");
      return;
    }

    elements.yourToolList.append(...list.tools.map(row));
    const current = list.tools.find((tool) => tool.id === chosen && tool.observed);
    if (current) {
      const shown = ready(current);
      trigger(shown.key, current.label ?? current.id, `Your tool: ${current.label ?? current.id}. ${shown.words} ${KEPT}`);
    } else {
      trigger("none", "Choose", `Your tool: not chosen. Choose the AI tool you work in. ${KEPT}`);
    }
    const observed = list.tools.filter((tool) => tool.observed).length;
    note(`${observed} of ${list.tools.length} tools in Core's registry can be chosen. ${KEPT}`);
    if (chosen && !current) note(`Your saved tool "${chosen}" is not one Core offers now; choose again.`);
    if (inspection === undefined) note("Checking this machine with Core's inspection…").setAttribute("role", "status");
    else if (inspection.state !== "inspected") note(`Core's inspection didn't run: ${inspection.reason ?? "no reason was given"}.`, "text-error");
    else note(`Icons: Core's offline inspection of this machine${inspection.package?.version ? ` (${inspection.package.name ?? "@aihq/core"} ${inspection.package.version})` : ""}${inspection.status && inspection.status !== "complete" ? `, ${inspection.status}` : ""}. ${NOT_PROOF}`);
  }

  elements.yourToolTrigger.addEventListener("click", () => setOpen(!isOpen()));
  // Arrow keys move between the tools, as in a radio group; Tab still reaches each one, greyed ones included.
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
    if (elements.yourToolPop.contains(event.target) || elements.yourToolTrigger.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      elements.yourToolTrigger.focus();
    }
  });

  async function read(path) {
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
      list = await read("/api/tools");
      render();
      onChange(list?.state === "published" ? list.tools.find(tool => tool.id === chosen && tool.observed) ?? null : null);
      if (list.state !== "published" || list.tools.length === 0) return;
      inspection = await read("/api/tool-inspection");
      render();
    },
    /** The chosen tool's registry entry, or null. */
    current: () => (list?.state === "published" ? list.tools.find((tool) => tool.id === chosen && tool.observed) ?? null : null),
  };
}

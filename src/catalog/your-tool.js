/*
 * The header's one "Your tool" control (owner decision 3 on samartomar/aih-ui#96).
 *
 * It holds the Catalog tool name the person chose (claude-code, kiro-ide, ...), in the Catalog's own names: that is
 * what filters the content. It is the only tool list where people work (samartomar/aih-ui#136): the Core tools the
 * person chose are under Settings, Advanced, as "Tools to set up on this machine", and their labels show there. Neither
 * is derived from the other: no published contract relates the two vocabularies (samartomar/aih-ui#95). The tool line
 * it replaces on the default path is kept under Advanced with the same controls, and both write the same choice.
 */

import { el } from "../app/dom.js";
import { clientLabel } from "../app/core-targets.js";

// The Catalog's name for "any AI tool": not one tool, so it is not offered as a choice.
const ANY_TOOL = "generic";

/**
 * @param declared      the tool names the installed Catalog declares
 * @param tool          the chosen Catalog tool name, or ''
 * @param mode          'mine' (filter by the tool) or 'all' (Show all, from Advanced)
 * @param coreIds / coreLabels / coreSelected  Core's published clients, their labels and the person's Settings choice
 * @param undeclared / showUndeclared          the items that declare no specific tool, and whether they are shown
 * @param notSupported / showUnsupported      the items that declare the tool but are not marked supported for it, and whether shown
 * @param coreHidden    what the Core tools chosen in Settings also hide, in words, or ''
 * @param place         this page's address (host and port): a choice is remembered per browser and address
 * @param forgotten     a saved tool the Catalog no longer declares, cleared on this load, or ''
 */
export function yourToolModel({ declared = [], tool = "", mode = "mine", coreIds = [], coreLabels = {}, coreSelected = [], undeclared = 0, showUndeclared = false, notSupported = 0, showUnsupported = false, coreHidden = "", place = "", forgotten = "" }) {
  const options = declared.filter((name) => name !== ANY_TOOL).map((name) => ({ value: name, label: name, checked: name === tool }));
  const core = coreSelected.filter((id) => coreIds.includes(id)).map((id) => clientLabel(coreLabels, id) ?? id);
  const noDeclared = `${undeclared} with no declared tool`;
  const here = place ? `this browser for this address (${place})` : "this browser";
  const status = !tool
    ? forgotten
      ? `Your saved tool ${forgotten} is no longer in the Catalog, so it was cleared. Choose your tool in the header.`
      : `No tool chosen, so content is not filtered by tool. Choose your tool in the header; it is remembered in ${here}.`
    : mode !== "mine"
      ? `Showing content for every tool (Show all, under Advanced). Your tool: ${tool}.`
      : [`Showing content supported for ${tool} according to the Catalog.`,
        notSupported ? `${notSupported} not marked supported for ${tool} ${showUnsupported ? "are shown." : "are hidden; Advanced shows them."}` : "",
        `${noDeclared} ${showUndeclared ? "are shown" : "are hidden"}.`].filter(Boolean).join(" ");
  return {
    value: tool || "Choose your tool",
    status: [status, mode === "mine" ? coreHidden : ""].filter(Boolean).join(" "),
    core: core.length ? `Core: ${core.join(", ")}` : "",
    options,
    undeclaredLabel: `${showUndeclared ? "Hide" : "Show"} ${noDeclared}`,
    undeclaredShown: showUndeclared,
    rememberNote: `Your choice is remembered in ${here} only.`,
    genericNote: declared.includes(ANY_TOOL)
      ? "generic is not offered: the Catalog uses it for items meant for any AI tool, not one tool. They count as items with no declared tool."
      : "",
  };
}

/**
 * @param elements  { trigger, value, core, pop, list, undeclared, note, status }
 * @param onChoose  called with the chosen Catalog tool name, or '' for none
 * @param onToggleUndeclared  called when the "no declared tool" switch is used
 */
export function createYourTool({ elements, onChoose, onToggleUndeclared }) {
  const isOpen = () => !elements.pop.hidden;
  function setOpen(open) {
    elements.pop.hidden = !open;
    elements.trigger.setAttribute("aria-expanded", String(open));
    if (open) (elements.list.querySelector('[aria-checked="true"]') ?? elements.list.querySelector("button"))?.focus();
  }
  elements.trigger.addEventListener("click", () => setOpen(!isOpen()));
  elements.undeclared.addEventListener("click", () => onToggleUndeclared());
  document.addEventListener("click", (event) => {
    if (isOpen() && !elements.pop.contains(event.target) && !elements.trigger.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) { setOpen(false); elements.trigger.focus(); }
  });

  const choice = (value, label, checked, title) => {
    const button = el("button", `your-tool-option${checked ? " is-chosen" : ""}`, label);
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(checked));
    button.dataset.tool = value;
    button.title = title;
    button.addEventListener("click", () => { setOpen(false); onChoose(value); elements.trigger.focus(); });
    return button;
  };

  return {
    render(model) {
      elements.value.textContent = model.value;
      elements.core.textContent = model.core;
      elements.core.hidden = !model.core;
      elements.trigger.title = `Your tool, in the Catalog's own name: ${model.value}. It chooses the content you see.`;
      elements.list.replaceChildren(
        ...model.options.map((option) => choice(option.value, option.label, option.checked, `Show content supported for ${option.value} according to the Catalog.`)),
        choice("", "No tool: show all content", !model.options.some((option) => option.checked), "Content is not filtered by tool."),
      );
      elements.undeclared.textContent = model.undeclaredLabel;
      elements.undeclared.setAttribute("aria-pressed", String(model.undeclaredShown));
      elements.undeclared.hidden = !model.options.some((option) => option.checked);
      elements.note.replaceChildren(...[model.genericNote, model.rememberNote, "Tools to set up on this machine are a separate list, under Settings, Advanced."].filter(Boolean).map((line) => el("p", "", line)));
      elements.status.textContent = model.status;
    },
  };
}

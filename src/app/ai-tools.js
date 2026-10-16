/*
 * The header's AI tools control: which AI clients to set up for.
 *
 * Three different facts, kept apart:
 *
 *   - SUPPORTED: the clients @aihq/core lists in its public nativeClientIds
 *     (from @aihq/core/harness), read by the backend from the installed package,
 *     with the labels Harness publishes for them. The page keeps no list of its
 *     own, so a reinstalled Core changes this with no UI edit. The list's order
 *     is Core's, not a ranking.
 *   - SELECTED: the user's explicit choice in the workspace's local setup file.
 *   - CONNECTED: whether a tool is installed or connected. Nothing here checks
 *     a tool, so it reads "not checked" and is never implied - not by the dot,
 *     not by the count.
 *
 * The count reads "<selected> of <supported>", as the design source lays it
 * out, and its tooltip says what each number is. The design source's "3 of 11"
 * was sample data; it is not restored as state.
 */

import { el, text } from "./dom.js";
import { NOT_PUBLISHED } from "./absence.js";
import { clientNodes, publishedClients } from "./core-targets.js";

/** @param elements { aiToolsTrigger, aiToolsCount, aiToolsPop, aiToolsList, aiToolsNote } */
export function createAiTools({ elements, onSelectionChange }) {
  let supported = null;
  let labels = {};
  let unavailableReason = null;
  let selected = [];
  let saving = false;
  let saveError = null;

  const isOpen = () => !elements.aiToolsPop.classList.contains("hidden");
  function setOpen(open) {
    elements.aiToolsPop.classList.toggle("hidden", !open);
    elements.aiToolsTrigger.setAttribute("aria-expanded", String(open));
  }

  function note(value) {
    elements.aiToolsNote.appendChild(el("p", "", value));
  }

  function render() {
    elements.aiToolsList.replaceChildren();
    elements.aiToolsNote.replaceChildren();

    if (supported === null) {
      elements.aiToolsCount.textContent = NOT_PUBLISHED;
      elements.aiToolsTrigger.title =
        `AI tools: ${NOT_PUBLISHED}. ${unavailableReason ?? "The installed @aihq/core lists no supported targets."}`;
      elements.aiToolsList.appendChild(el("div", "px-1.5 py-1 text-outline", NOT_PUBLISHED));
      note(`The installed @aihq/core does not publish its supported targets${unavailableReason ? `: ${unavailableReason}` : "."}`);
      return;
    }

    const chosen = supported.filter((target) => selected.includes(target));
    elements.aiToolsCount.textContent = `${chosen.length} of ${supported.length}`;
    elements.aiToolsTrigger.title =
      `${supported.length} AI clients @aihq/core supports as targets; ${chosen.length} selected in this workspace's local setup. ` +
      "Installed or connected: not checked.";

    for (const target of supported) {
      const row = el("label", "flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-container cursor-pointer text-on-surface");
      const box = el("input", "rounded-sm w-3.5 h-3.5 accent-primary");
      box.type = "checkbox";
      box.checked = selected.includes(target);
      box.disabled = saving;
      box.dataset.target = target;
      box.addEventListener("change", async () => {
        const previous = [...selected];
        selected = box.checked ? [...selected.filter((item) => item !== target), target] : selected.filter((item) => item !== target);
        saving = true;
        saveError = null;
        render();
        try { await onSelectionChange([...selected]); }
        catch (error) { selected = previous; saveError = error.message; }
        finally { saving = false; }
        render();
        elements.aiToolsList.querySelector(`input[data-target="${CSS.escape(target)}"]`)?.focus();
      });
      row.appendChild(box);
      row.append(...clientNodes(labels, target));
      elements.aiToolsList.appendChild(row);
    }

    note(`Supported: the ${supported.length} AI clients @aihq/core lists (nativeClientIds).`);
    note(saving ? "Saving client selection…" : "Selected: saved in this workspace's local setup file. It is not a policy.");
    if (saveError) {
      const failure = el("p", "text-error", `Selection was not saved: ${saveError}`);
      failure.setAttribute("role", "alert");
      elements.aiToolsNote.appendChild(failure);
    }
    note("Installed or connected: not checked. Nothing here checks a tool.");
    // A saved choice this Core no longer lists stays saved, but is not counted.
    const unknown = selected.filter((item) => !supported.includes(item));
    if (unknown.length > 0) {
      note(`${unknown.length} saved choice${unknown.length === 1 ? " is" : "s are"} not in this Core's list: ${unknown.join(", ")}.`);
    }
  }

  elements.aiToolsTrigger.addEventListener("click", () => setOpen(!isOpen()));
  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (elements.aiToolsPop.contains(event.target) || elements.aiToolsTrigger.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      elements.aiToolsTrigger.focus();
    }
  });

  render();

  return {
    setSelection(clients) {
      selected = [...clients];
      render();
    },
    /** @param coreTargets the summary's { state, targets, labels } or { state, reason } */
    setTargets(coreTargets) {
      const published = publishedClients(coreTargets);
      if (published) {
        supported = published.ids;
        labels = published.labels;
        unavailableReason = null;
      } else {
        supported = null;
        labels = {};
        unavailableReason = text(coreTargets?.reason);
      }
      render();
    },
  };
}

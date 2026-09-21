/*
 * The header's AI tools control: which AI CLIs to set up for.
 *
 * Three different facts, kept apart:
 *
 *   - SUPPORTED: the targets @aihq/core lists in its public SUPPORTED_CLIS
 *     export, read by the backend from the installed package. The page keeps
 *     no list of its own, so a reinstalled Core changes this with no UI edit.
 *   - SELECTED:  the user's choice, a draft kept in this browser.
 *   - CONNECTED: whether a tool is installed or connected. Nothing supplies
 *     that yet, so it is never implied - not by the dot, not by the count.
 *
 * The count reads "<selected> of <supported>", as the design source lays it
 * out, and its tooltip says what each number is. The design source's "3 of 11"
 * was sample data; it is not restored as state.
 */

import { el, text } from "./dom.js";
import { NOT_CONNECTED, NOT_PUBLISHED } from "./absence.js";

const STORAGE_KEY = "aih-ui-ai-tools-draft";
const DRAFT_VERSION = 1;

function loadSelection() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value === null || typeof value !== "object" || value.version !== DRAFT_VERSION) return [];
    return Array.isArray(value.selected) ? value.selected.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSelection(selected) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: DRAFT_VERSION, selected }));
    return true;
  } catch {
    return false;
  }
}

/** @param elements { aiToolsTrigger, aiToolsCount, aiToolsPop, aiToolsList, aiToolsNote } */
export function createAiTools({ elements }) {
  let supported = null;
  let unavailableReason = null;
  let selected = loadSelection();

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
      `${supported.length} AI CLIs @aihq/core supports as targets; ${chosen.length} selected as a draft in this browser. ` +
      `Installed or connected: ${NOT_CONNECTED}.`;

    for (const target of supported) {
      const row = el("label", "flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-container cursor-pointer text-on-surface font-mono");
      const box = el("input", "rounded-sm w-3.5 h-3.5 accent-primary");
      box.type = "checkbox";
      box.checked = selected.includes(target);
      box.dataset.target = target;
      box.addEventListener("change", () => {
        selected = box.checked
          ? [...selected.filter((item) => item !== target), target]
          : selected.filter((item) => item !== target);
        saveSelection(selected);
        render();
        elements.aiToolsList.querySelector(`input[data-target="${CSS.escape(target)}"]`)?.focus();
      });
      row.appendChild(box);
      row.appendChild(el("span", "", target));
      elements.aiToolsList.appendChild(row);
    }

    note(`Supported: the ${supported.length} targets @aihq/core lists (SUPPORTED_CLIS).`);
    note("Selected: your draft, kept in this browser. It is not a policy.");
    note(`Installed or connected: ${NOT_CONNECTED}. Nothing here checks a tool.`);
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
    /** @param coreTargets the summary's { state, targets } or { state, reason } */
    setTargets(coreTargets) {
      if (coreTargets?.state === "published" && Array.isArray(coreTargets.targets)) {
        supported = coreTargets.targets.filter((target) => typeof target === "string");
        unavailableReason = null;
      } else {
        supported = null;
        unavailableReason = text(coreTargets?.reason);
      }
      render();
    },
  };
}

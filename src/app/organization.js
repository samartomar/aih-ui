/*
 * Your organization: the header's setup popup.
 *
 * Organization details are USER INPUT, not missing Catalog data, so the header
 * control is always enabled - including before anything has been saved.
 *
 * What it is:
 *   - a draft the user types, kept in this browser (localStorage) so it
 *     survives a reload, and shown by name in the header;
 *   - validated on Save; Cancel, the close button, a click outside and Escape
 *     all discard the edits and leave the saved draft exactly as it was.
 *
 * What it is NOT, and never says it is:
 *   - read from git. Nothing here inspects a repository, so no field claims to
 *     have been "filled in from git";
 *   - policy authority. A name, a short id, a repository reference, an email or
 *     a posture preference establishes no decision and no approval. Policy
 *     artifacts still go through Core's preparation and consumption contracts;
 *   - signing. The Vibe / Enterprise choice is recorded as a preference only.
 *     Signing and verifying policies is not implemented here.
 *
 * Layout and labels come from prototype/screens/admin-sources.html. Its Acme
 * sample values are not carried over: fields start empty or hold what the user
 * saved.
 */

import { el } from "./dom.js";
import { NOT_SUPPLIED } from "./absence.js";

const STORAGE_KEY = "aih-ui-organization-draft";
const DRAFT_VERSION = 1;
const MAX_EMAILS = 20;

const SHORT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// host/owner/name, optionally as an https URL and optionally ending in .git
const POLICY_REPO = /^(?:https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(?:\.git)?\/?$/;

const POSTURES = [
  {
    value: "vibe",
    title: "Vibe",
    aside: "git push",
    description: "Trust follows who can push to your policy repo.",
  },
  {
    value: "enterprise",
    title: "Enterprise",
    aside: null,
    description: "Policies signed with an organization key.",
  },
];

function emptyDraft() {
  return { version: DRAFT_VERSION, name: "", shortId: "", policyRepo: "", emails: [], posture: null };
}

/** Reads the saved draft. Anything malformed is treated as no draft at all. */
function loadDraft() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== "object" || value.version !== DRAFT_VERSION) return null;
    return {
      version: DRAFT_VERSION,
      name: typeof value.name === "string" ? value.name : "",
      shortId: typeof value.shortId === "string" ? value.shortId : "",
      policyRepo: typeof value.policyRepo === "string" ? value.policyRepo : "",
      emails: Array.isArray(value.emails) ? value.emails.filter((email) => typeof email === "string") : [],
      posture: POSTURES.some((posture) => posture.value === value.posture) ? value.posture : null,
    };
  } catch {
    return null;
  }
}

function saveDraft(draft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Every problem with a draft, by field. An empty object means it can be saved. */
export function validateDraft(draft) {
  const errors = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = "Enter your organization's name.";
  else if (name.length > 120) errors.name = "Keep the name to 120 characters or fewer.";

  const shortId = draft.shortId.trim();
  if (shortId.length === 0) errors.shortId = "Enter a short id.";
  else if (shortId.length > 40) errors.shortId = "Keep the short id to 40 characters or fewer.";
  else if (!SHORT_ID.test(shortId)) {
    errors.shortId = "Use lower case letters, digits and single hyphens only, with no spaces.";
  }

  const repo = draft.policyRepo.trim();
  if (repo.length > 0 && !POLICY_REPO.test(repo)) {
    errors.policyRepo = "Give the repository as host/owner/name, for example github.com/your-org/ai-policies.";
  }

  if (draft.emails.length > MAX_EMAILS) errors.emails = `List at most ${MAX_EMAILS} people.`;
  return errors;
}

/**
 * @param elements  the header trigger and every node of the popup
 * @param onChange  called with the saved draft (or null) whenever it changes
 */
export function createOrganization({ elements, onChange }) {
  let saved = loadDraft();
  let working = null;
  let restoreFocus = null;

  function renderTrigger() {
    const name = saved?.name?.trim() || null;
    elements.orgTriggerLabel.textContent = name ?? NOT_SUPPLIED;
    elements.orgModalTrigger.title = name === null
      ? "Your organization: not supplied yet. Open to enter it."
      : `Your organization: ${name}. Entered by you, kept in this browser.`;
  }

  function showError(field, message) {
    const node = {
      name: elements.orgErrorName,
      shortId: elements.orgErrorId,
      policyRepo: elements.orgErrorRepo,
      emails: elements.orgErrorEmail,
    }[field];
    node.textContent = message ?? "";
    node.classList.toggle("hidden", !message);
  }

  function clearErrors() {
    for (const field of ["name", "shortId", "policyRepo", "emails"]) showError(field, null);
  }

  function renderEmails() {
    elements.orgEmailList.replaceChildren();
    if (working.emails.length === 0) {
      elements.orgEmailList.appendChild(el("span", "text-[11px] text-outline font-mono", NOT_SUPPLIED));
      return;
    }
    working.emails.forEach((email, index) => {
      const chip = el("div", "flex items-center gap-1 px-2.5 py-1 rounded bg-[#141822] border border-surface-container-high/60 text-[11.5px] font-mono text-on-surface");
      chip.appendChild(el("span", "material-symbols-outlined text-[13px] text-outline", "mail"));
      chip.appendChild(el("span", "", email));
      const remove = el("button", "ml-0.5 p-0.5 rounded hover:bg-surface-container-high text-outline hover:text-on-surface flex items-center cursor-pointer");
      remove.type = "button";
      remove.title = `Remove ${email}`;
      remove.setAttribute("aria-label", `Remove ${email}`);
      remove.appendChild(el("span", "material-symbols-outlined text-[12px]", "close"));
      remove.addEventListener("click", () => {
        working.emails.splice(index, 1);
        renderEmails();
      });
      chip.appendChild(remove);
      elements.orgEmailList.appendChild(chip);
    });
  }

  function renderPosture() {
    elements.orgPosture.replaceChildren();
    for (const posture of POSTURES) {
      const selected = working.posture === posture.value;
      const tile = el(
        "button",
        selected
          ? "p-2.5 rounded bg-surface-container border border-primary text-primary cursor-pointer flex flex-col justify-between shadow-xs text-left"
          : "p-2.5 rounded bg-[#141822] border border-surface-container-high/50 cursor-pointer hover:border-surface-container-high flex flex-col justify-between text-left",
      );
      tile.type = "button";
      tile.setAttribute("role", "radio");
      tile.setAttribute("aria-checked", String(selected));
      const head = el("div", "flex items-center justify-between");
      const title = el("span", `text-[12px] font-semibold ${selected ? "text-white" : "text-on-surface-variant"} flex items-center gap-1`);
      if (selected) title.appendChild(el("span", "w-1.5 h-1.5 rounded-full bg-secondary"));
      title.appendChild(document.createTextNode(posture.title));
      head.appendChild(title);
      head.appendChild(
        posture.aside === null
          ? el("span", "material-symbols-outlined text-[14px] text-primary", "verified_user")
          : el("span", "text-[10px] font-mono text-outline", posture.aside),
      );
      tile.appendChild(head);
      tile.appendChild(el("p", `text-[10.5px] ${selected ? "text-on-surface-variant" : "text-outline"} mt-1 leading-snug`, posture.description));
      tile.addEventListener("click", () => {
        // Selecting the chosen tile again clears the preference.
        working.posture = working.posture === posture.value ? null : posture.value;
        renderPosture();
      });
      elements.orgPosture.appendChild(tile);
    }
  }

  function readInputs() {
    working.name = elements.orgInputName.value;
    working.shortId = elements.orgInputId.value;
    working.policyRepo = elements.orgInputRepo.value;
  }

  function addEmail() {
    const email = elements.orgInputEmail.value.trim();
    if (email.length === 0) {
      showError("emails", "Type an email address first.");
      return;
    }
    if (!EMAIL.test(email)) {
      showError("emails", `"${email}" is not an email address.`);
      return;
    }
    if (working.emails.some((existing) => existing.toLowerCase() === email.toLowerCase())) {
      showError("emails", `${email} is already listed.`);
      return;
    }
    if (working.emails.length >= MAX_EMAILS) {
      showError("emails", `List at most ${MAX_EMAILS} people.`);
      return;
    }
    working.emails.push(email);
    elements.orgInputEmail.value = "";
    showError("emails", null);
    renderEmails();
  }

  function open() {
    // Edits happen on a copy. Nothing touches the saved draft until Save.
    working = structuredClone(saved ?? emptyDraft());
    elements.orgInputName.value = working.name;
    elements.orgInputId.value = working.shortId;
    elements.orgInputRepo.value = working.policyRepo;
    elements.orgInputEmail.value = "";
    clearErrors();
    renderEmails();
    renderPosture();
    restoreFocus = document.activeElement;
    setPageInert(true);
    elements.orgModalOverlay.classList.remove("hidden");
    elements.orgInputName.focus();
  }

  function close() {
    working = null;
    elements.orgModalOverlay.classList.add("hidden");
    // The page has to be reachable again before focus can go back to it.
    setPageInert(false);
    if (restoreFocus && typeof restoreFocus.focus === "function") restoreFocus.focus();
    restoreFocus = null;
  }

  /**
   * While the popup is open the page behind it is inert: nothing there can be
   * focused, clicked or read, so Tab and a screen reader stay in the dialog.
   */
  function setPageInert(inert) {
    // Every node that is not the popup or one of its ancestors: at each level
    // from the popup up to <body>, the popup's line stays live and its
    // siblings do not.
    for (let node = elements.orgModalOverlay; node.parentElement !== null && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node) sibling.inert = inert;
      }
    }
  }

  /** What Tab can reach inside the popup, in document order. */
  function focusableInDialog() {
    return [...elements.orgModalOverlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.disabled && node.getClientRects().length > 0);
  }

  function isOpen() {
    return !elements.orgModalOverlay.classList.contains("hidden");
  }

  function save() {
    readInputs();
    const draft = {
      version: DRAFT_VERSION,
      name: working.name.trim(),
      shortId: working.shortId.trim(),
      policyRepo: working.policyRepo.trim(),
      emails: [...working.emails],
      posture: working.posture,
    };
    clearErrors();
    const errors = validateDraft(draft);
    for (const [field, message] of Object.entries(errors)) showError(field, message);
    if (Object.keys(errors).length > 0) {
      const first = { name: elements.orgInputName, shortId: elements.orgInputId, policyRepo: elements.orgInputRepo, emails: elements.orgInputEmail }[Object.keys(errors)[0]];
      first?.focus();
      return;
    }
    if (!saveDraft(draft)) {
      showError("name", "This browser would not store the draft, so nothing was saved.");
      return;
    }
    saved = draft;
    renderTrigger();
    onChange(saved);
    close();
  }

  // ----------------------------------------------------------- listeners ---
  elements.orgModalTrigger.addEventListener("click", open);
  elements.closeOrgModalBtn.addEventListener("click", close);
  elements.cancelOrgModalBtn.addEventListener("click", close);
  elements.orgModalOverlay.addEventListener("click", (event) => {
    if (event.target === elements.orgModalOverlay) close();
  });
  elements.orgForm.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });
  elements.orgAddEmailBtn.addEventListener("click", addEmail);
  elements.orgInputEmail.addEventListener("keydown", (event) => {
    // Enter in the email field adds the address; it does not submit the form.
    if (event.key === "Enter") {
      event.preventDefault();
      addEmail();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) close();
  });
  // Tab wraps at either end of the dialog rather than leaving it.
  elements.orgModalOverlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = focusableInDialog();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  renderTrigger();

  return {
    /** The saved draft, or null when nothing has been saved. */
    current() {
      return saved;
    },
  };
}

/*
 * One way to give an element its tooltip.
 *
 * attachTooltip(element, text) sets the element's `title` (the hover tooltip)
 * and links a description for assistive technology through
 * `aria-describedby`. The description lives in one hidden container at the end
 * of the page, one node per distinct text, so a re-rendered grid does not grow
 * it without bound. A hidden node is still read when aria-describedby names it,
 * and it is not read a second time in browse mode.
 *
 * Hover uses the browser's own title tooltip. Keyboard focus and touch, which
 * never show a title, show the same text in one shared bubble instead; it is
 * aria-hidden, because the description already carries the words.
 *
 * An icon-only control gets its accessible name with { label }.
 *
 * Keyboard focus is how a keyboard user reaches the text, so an element that
 * cannot take focus (an icon, a pill, a count) is put in the tab order. A
 * decorative icon that carries a tooltip is no longer decorative: it becomes an
 * image named by its words. A greyed control stays focusable: callers mark it
 * aria-disabled rather than disabled, which would take it out of the tab order.
 *
 * Outside a page (no document.body, as in the offline unit tests' minimal DOM)
 * only the title and label are set.
 */

const HOST_ID = "wb-tooltip-texts";
const BUBBLE_ID = "wb-tooltip";
const TOUCH_MS = 4000;
const PRUNE_AT = 256;

let sequence = 0;
const nodesByText = new Map();
let touchTimer = null;
// The element a touch showed the bubble for: its own blur or mouseleave (a tap selects a card and redraws it) leaves
// the bubble up until the touch timer ends.
let touchOwner = null;
// A tap that redraws focuses the replacement of the tapped element: it keeps the touch bubble. Focus elsewhere ends it.
const redrawnOwner = (element) => Boolean(touchOwner) && (element === touchOwner || (!touchOwner.isConnected && touchOwner.dataset?.tooltip === element.dataset?.tooltip));
// The element the bubble shows words for; only its own exit hides them.
let shownFor = null;

function page() {
  return typeof document !== "undefined" && document.body && typeof document.getElementById === "function" ? document : null;
}

function host(doc) {
  let node = doc.getElementById(HOST_ID);
  if (!node) {
    node = doc.createElement("div");
    node.id = HOST_ID;
    node.hidden = true;
    doc.body.appendChild(node);
  }
  return node;
}

/*
 * Drop descriptions nothing on the page refers to any more. One pass reads every reference on the page, and it runs
 * once after the current task, when a grid built off-page has been attached; pruning on every new text, with one page
 * query per description, made a large grid quadratic.
 */
let pruneQueued = false;
function prune(doc) {
  pruneQueued = false;
  if (nodesByText.size < PRUNE_AT) return;
  const referenced = new Set();
  for (const element of doc.querySelectorAll("[aria-describedby]")) for (const id of element.getAttribute("aria-describedby").split(/\s+/)) referenced.add(id);
  for (const [text, node] of nodesByText) {
    if (!referenced.has(node.id)) {
      node.remove();
      nodesByText.delete(text);
    }
  }
}

function schedulePrune(doc) {
  if (pruneQueued || nodesByText.size < PRUNE_AT) return;
  pruneQueued = true;
  setTimeout(() => prune(doc), 0);
}

function descriptionId(doc, text) {
  const container = host(doc);
  const known = nodesByText.get(text);
  if (known && known.isConnected) return known.id;
  schedulePrune(doc);
  const node = doc.createElement("span");
  node.id = `wb-tip-${++sequence}`;
  node.textContent = text;
  container.appendChild(node);
  nodesByText.set(text, node);
  return node.id;
}

function bubble(doc) {
  let node = doc.getElementById(BUBBLE_ID);
  if (!node) {
    node = doc.createElement("div");
    node.id = BUBBLE_ID;
    node.className = "wb-tooltip";
    node.setAttribute("aria-hidden", "true");
    node.hidden = true;
    doc.body.appendChild(node);
  }
  return node;
}

function show(element) {
  const doc = page();
  const text = element.dataset?.tooltip;
  if (!doc || !text) return;
  const node = bubble(doc);
  node.textContent = text;
  node.hidden = false;
  shownFor = element;
  const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
  if (!rect) return;
  const width = node.offsetWidth || 0;
  const height = node.offsetHeight || 0;
  const viewportWidth = doc.documentElement?.clientWidth || 0;
  const viewportHeight = doc.documentElement?.clientHeight || 0;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const below = rect.bottom + 6;
  const top = below + height > viewportHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

function hide() {
  const doc = page();
  const node = doc?.getElementById(BUBBLE_ID);
  if (node) node.hidden = true;
}

const FOCUSABLE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

/* Put the element where the keyboard reaches it, and give a decorative icon its words. */
function reachable(element, wording) {
  if (typeof element.setAttribute !== "function") return;
  const tag = String(element.tagName ?? "").toUpperCase();
  if (!FOCUSABLE.has(tag) && element.getAttribute?.("tabindex") === null && element.tabIndex !== 0) element.setAttribute("tabindex", "0");
  if (element.getAttribute?.("aria-hidden") === "true") {
    element.removeAttribute?.("aria-hidden");
    element.setAttribute("role", "img");
    if (!element.getAttribute?.("aria-label")) element.setAttribute("aria-label", wording);
  }
}

function listen(element) {
  if (element.dataset.tooltipBound === "true") return;
  element.dataset.tooltipBound = "true";
  element.addEventListener("focus", () => {
    // Keyboard focus only: a mouse click already had the hover tooltip.
    if (typeof element.matches !== "function" || element.matches(":focus-visible")) { touchOwner = redrawnOwner(element) ? element : null; show(element); }
  });
  const leave = () => { if (element === shownFor && element !== touchOwner) hide(); };
  element.addEventListener("blur", leave);
  element.addEventListener("mouseleave", leave);
  element.addEventListener("keydown", (event) => { if (event.key === "Escape") { touchOwner = null; hide(); } });
  element.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    show(element);
    touchOwner = element;
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { touchOwner = null; hide(); }, TOUCH_MS);
  });
}

/**
 * @param element the element the tooltip belongs to
 * @param text    the full wording, shown on hover, focus and touch and read as its description
 * @param options { label } an accessible name for an icon-only control
 * @returns the element
 */
export function attachTooltip(element, text, { label } = {}) {
  const wording = typeof text === "string" ? text.trim() : "";
  if (label) element.setAttribute("aria-label", label);
  if (!wording) return element;
  element.title = wording;
  if (element.dataset) element.dataset.tooltip = wording;
  reachable(element, wording);
  const doc = page();
  if (!doc) return element;
  const id = descriptionId(doc, wording);
  const others = (element.getAttribute?.("aria-describedby") ?? "").split(/\s+/).filter((value) => value && !value.startsWith("wb-tip-"));
  element.setAttribute("aria-describedby", [...others, id].join(" "));
  listen(element);
  return element;
}

/** Takes an element's words away again, as when the inspector shows no item. */
export function clearTooltip(element) {
  element.removeAttribute?.("title");
  if (element.dataset) delete element.dataset.tooltip;
  const others = (element.getAttribute?.("aria-describedby") ?? "").split(/\s+/).filter(value => value && !value.startsWith("wb-tip-"));
  if (others.length) element.setAttribute("aria-describedby", others.join(" ")); else element.removeAttribute?.("aria-describedby");
}

/** The page's own markup names its tooltips with data-tip; each gets the same helper. */
export function attachStaticTooltips(root) {
  for (const node of root.querySelectorAll("[data-tip]")) attachTooltip(node, node.dataset.tip);
}

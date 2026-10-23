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

/* Drop descriptions nothing on the page refers to any more. */
function prune(doc) {
  if (nodesByText.size < PRUNE_AT) return;
  for (const [text, node] of nodesByText) {
    if (!doc.querySelector(`[aria-describedby~="${node.id}"]`)) {
      node.remove();
      nodesByText.delete(text);
    }
  }
}

function descriptionId(doc, text) {
  const container = host(doc);
  const known = nodesByText.get(text);
  if (known && known.isConnected) return known.id;
  prune(doc);
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

function listen(element) {
  if (element.dataset.tooltipBound === "true") return;
  element.dataset.tooltipBound = "true";
  element.addEventListener("focus", () => {
    // Keyboard focus only: a mouse click already had the hover tooltip.
    if (typeof element.matches !== "function" || element.matches(":focus-visible")) show(element);
  });
  element.addEventListener("blur", hide);
  element.addEventListener("mouseleave", hide);
  element.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
  element.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    show(element);
    clearTimeout(touchTimer);
    touchTimer = setTimeout(hide, TOUCH_MS);
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
  const doc = page();
  if (!doc) return element;
  const id = descriptionId(doc, wording);
  const others = (element.getAttribute?.("aria-describedby") ?? "").split(/\s+/).filter((value) => value && !value.startsWith("wb-tip-"));
  element.setAttribute("aria-describedby", [...others, id].join(" "));
  listen(element);
  return element;
}

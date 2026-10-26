import { el } from "./dom.js";

let sequence = 0;
/** Preserve missing evidence as an accessible, compact status with its reason. */
export function createGapIndicator({ label = "Not ready", reason } = {}) {
  const wrapper = el("span", "gap-indicator");
  const trigger = el("button", "gap-indicator-trigger");
  // A local vector avoids missing Unicode glyphs and remote-font dependencies.
  const namespace = 'http://www.w3.org/2000/svg';
  const glyph = document.createElementNS(namespace, 'svg');
  for (const [name, value] of Object.entries({class: 'gap-indicator-icon', viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'aria-hidden': 'true', focusable: 'false'})) glyph.setAttribute(name, value);
  for (const [tag, attributes] of [['circle', {cx: '12', cy: '12', r: '9'}], ['path', {d: 'M12 10v7'}], ['circle', {cx: '12', cy: '7', r: '.9', fill: 'currentColor', stroke: 'none'}]]) {
    const part = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) part.setAttribute(name, value);
    glyph.appendChild(part);
  }
  trigger.appendChild(glyph);
  trigger.type = "button";
  trigger.setAttribute("aria-label", label);
  const tooltip = el("span", "gap-indicator-tooltip", `${label}: ${reason || "No reason was supplied by the source."}`);
  tooltip.id = `gap-reason-${++sequence}`;
  tooltip.setAttribute("role", "tooltip");
  trigger.setAttribute("aria-describedby", tooltip.id);
  function position() {
    wrapper.classList.remove("gap-indicator-dismissed");
    const bounds = trigger.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 316))}px`;
    tooltip.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 160)}px`;
  }
  wrapper.addEventListener("mouseenter", position);
  trigger.addEventListener("focus", position);
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    wrapper.classList.toggle("gap-indicator-open");
  });
  trigger.addEventListener("blur", () => wrapper.classList.remove("gap-indicator-open"));
  trigger.addEventListener("keydown", event => {
    if (event.key === "Escape") { wrapper.classList.remove("gap-indicator-open"); wrapper.classList.add("gap-indicator-dismissed"); event.stopPropagation(); }
  });
  wrapper.append(trigger, tooltip);
  return wrapper;
}

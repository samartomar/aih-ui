import { el } from "./dom.js";

let sequence = 0;
/** Preserve missing evidence as an accessible, compact status with its reason. */
export function createGapIndicator({ label = "Not ready", reason } = {}) {
  const wrapper = el("span", "gap-indicator");
  const trigger = el("button", "gap-indicator-trigger", "ⓘ");
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

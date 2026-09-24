/* Keep a root theme change visually atomic by briefly suppressing transitions.
 * mode.js owns the preference; tokens.css owns every color in both modes.
 * The transition override lives in app/workbench.css. */

/** The class that turns transitions off. Defined in app/workbench.css. */
const SWITCHING = "theme-switching";

/**
 * Watches <html> for a theme change and settles the page when one happens.
 *
 * `mode.js` owns the toggle itself - the button, the
 * stored preference and the `?mode=` override. This only reacts to the result,
 * so the two cannot disagree about which theme is current.
 */
export function createTheme() {
  const root = document.documentElement;

  // Identity of the current theme. Adding or removing our own class does not
  // change it, so settling can never retrigger itself.
  const themeKey = () => `${root.dataset.mode ?? ""}|${root.classList.contains("dark") ? "dark" : "light"}`;
  let current = themeKey();

  let pendingFrame = 0;
  let pendingTimer = 0;

  function restore() {
    cancelAnimationFrame(pendingFrame);
    clearTimeout(pendingTimer);
    pendingFrame = 0;
    pendingTimer = 0;
    root.classList.remove(SWITCHING);
  }

  function settle() {
    root.classList.add(SWITCHING);
    // Recompute now, while transitions are off: this is the step that moves
    // every already-rendered element onto the new variables.
    void root.offsetHeight;
    // Restore on the next frame, and on a timer as well. A frame callback does
    // not run in a tab that is not being painted, and leaving this class on
    // would disable every transition in the page for good - a suppression that
    // outlives the switch it was for is its own defect.
    cancelAnimationFrame(pendingFrame);
    clearTimeout(pendingTimer);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = requestAnimationFrame(restore);
    });
    pendingTimer = setTimeout(restore, 120);
  }

  const observer = new MutationObserver(() => {
    const next = themeKey();
    if (next === current) return;
    current = next;
    settle();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["class", "data-mode"] });

  return {
    /** For a caller that changes the theme itself and wants it settled now. */
    settle,
    stop() {
      observer.disconnect();
      restore();
    },
  };
}

/* Presentation only: keep the prototype's facts and controls while making the
   Sources workbench easier to scan. The implemented page mirrors this layout. */
(() => {
  const main = document.getElementById("main-content");
  const grid = document.getElementById("cards-grid");
  if (!main || !grid) return;

  const toolbar = main.firstElementChild?.children[1];
  const results = grid.previousElementSibling;
  if (toolbar && results) {
    toolbar.id = "workbench-toolbar";
    results.id = "results-controls";
    toolbar.append(results);

    // The two signal chips repeat the filter counts. Keep their links and
    // wording in a compact disclosure instead of repeating them in the row.
    const signalChips = toolbar.children[1];
    const disclosure = document.createElement("details");
    disclosure.id = "review-signals";
    disclosure.className = "relative shrink-0 text-[11px]";
    const label = document.createElement("summary");
    label.textContent = "Signals";
    label.className = "cursor-pointer text-on-surface-variant hover:text-on-surface";
    signalChips.replaceWith(disclosure);
    disclosure.append(label, signalChips);
  }

  const cards = [...grid.querySelectorAll(":scope > [data-card-id]")];
  const category = cards[0]?.dataset.category;
  if (category && cards.every((card) => card.dataset.category === category)) {
    const context = document.createElement("div");
    context.id = "category-context";
    context.textContent = `Category · ${category}`;
    grid.before(context);
    for (const card of cards) {
      card.dataset.sharedCategory = "true";
      card.title = `${card.dataset.title ?? card.dataset.cardId} · ${category}`;
    }
  }

  for (const card of cards) {
    const description = card.querySelector("p");
    if (description?.textContent.trim() === ">-") {
      description.textContent = "Description unavailable in this prototype";
      card.dataset.summary = description.textContent;
    }
  }

  const inspectorName = document.getElementById("inspector-name");
  if (inspectorName?.textContent.trim() === "fal-ai-media" && !cards.some((card) => card.dataset.cardId === "fal-ai-media")) {
    const example = document.createElement("span");
    example.id = "inspector-example";
    example.textContent = "Example";
    inspectorName.before(example);
    for (const card of cards) card.addEventListener("click", () => example.remove(), { once: true });
    inspectorName.title = "Preview example outside the current category filter";
    const subtitle = document.getElementById("inspector-subtitle");
    if (subtitle) subtitle.title = "Preview example outside the current category filter";
  }

  const narrowInspector = window.matchMedia("(max-width: 1100px)");
  const narrowNav = window.matchMedia("(max-width: 760px)");
  function fitRails() {
    if (narrowInspector.matches) window.closeInspectorDrawer?.();
    const nav = document.getElementById("nav-rail");
    if (narrowNav.matches && nav && !nav.classList.contains("w-0")) {
      document.getElementById("toggle-nav-btn")?.click();
    }
  }
  narrowInspector.addEventListener("change", fitRails);
  narrowNav.addEventListener("change", fitRails);
  fitRails();
})();

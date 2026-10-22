/*
 * The confirmation after a one-click Add: what was added (with the items it needs), an optional warning, and Undo.
 * It stays until the person dismisses it or the next Add replaces it, so a warning is never timed away.
 */
export function createAddedNotice({ el, button }) {
  const node = el('div', 'fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-md z-50 p-3 rounded border border-wb-border bg-surface-container-high text-on-surface text-[12px] space-y-2');
  node.id = 'added-notice'; node.hidden = true; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
  const message = el('p', 'break-words'); message.id = 'added-notice-message';
  const warning = el('p', 'p-2 rounded border border-wb-border bg-tertiary-container text-on-surface'); warning.id = 'added-notice-warning'; warning.hidden = true;
  const actions = el('div', 'flex flex-wrap gap-2');
  let undoAction = null;
  const undo = button('Undo', async () => { if (!undoAction || undo.disabled) return; undo.disabled = true; undo.setAttribute('aria-busy', 'true'); try { await undoAction(); } finally { undo.removeAttribute('aria-busy'); if (!undo.hidden && !node.hidden) undo.disabled = false; } });
  undo.id = 'added-notice-undo';
  const dismiss = button('Dismiss', () => hide()); dismiss.id = 'added-notice-dismiss';
  actions.append(undo, dismiss);
  node.append(message, warning, actions);
  document.body.append(node);
  function show({ text, warning: warned = '', onUndo = null }) {
    message.textContent = text; warning.textContent = warned; warning.hidden = !warned;
    // Undo is hidden once used; keyboard focus moves to Dismiss rather than being lost.
    const refocus = !onUndo && document.activeElement === undo;
    undoAction = onUndo; undo.hidden = !onUndo; undo.disabled = false;
    node.hidden = false;
    if (refocus) dismiss.focus();
  }
  function hide() { node.hidden = true; undoAction = null; }
  return { node, show, hide };
}

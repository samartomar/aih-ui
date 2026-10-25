/*
 * "Your choices" in Your setup (#137): one line per chosen item, with the items it needs folded under it ("+ 2 it
 * needs") and Remove from setup. The needed-by relation is only what Catalog resolved (setup-needs.js); nothing here
 * decides it. Remove from setup goes through the same remove-root proposal and acceptance as Undo after Add
 * (`onRemove`). Configuration, skips and an open draft's markers and compile stay in Advanced, under Chosen items.
 */

import { setupNeeds } from './setup-needs.js';
import { compact } from './compact.js';

const entryKey = ref => `${ref.releaseSha256}/${ref.itemId}`;
const itemKey = item => `${item.root?.releaseSha256}/${item.id}`;

/**
 * [{root, name, item, needed: [{name}]}], one per chosen root, in the setup's order. `needs` is setupNeeds' map
 * (needed entry id → the chosen roots that need it). A chosen item another chosen item needs keeps its own line and
 * is not folded.
 */
export function choiceLines({ roots = [], needs = new Map(), items = [] }) {
  const byKey = new Map(items.map(item => [itemKey(item), item]));
  const chosen = new Set(roots.map(entryKey));
  const name = (key, fallback) => String(byKey.get(key)?.label ?? byKey.get(key)?.id ?? fallback);
  return roots.map(root => {
    const key = entryKey(root), item = byKey.get(key);
    const needed = [...needs.entries()].filter(([entry, by]) => !chosen.has(entry) && by.some(value => entryKey(value) === key))
      .map(([entry]) => ({ name: name(entry, entry.slice(entry.indexOf('/') + 1)) }));
    return { root, item, name: name(key, root.itemId), needed };
  });
}

/** `onRemove(root, name)` takes one chosen item out of the setup and resolves when it is done. */
export function createSetupChoices({ client, el, button, onRemove = async () => {} }) {
  const node = el('section', 'space-y-1'); node.id = 'setup-choices';
  const title = el('h3', 'text-sm font-semibold text-on-surface', 'Your choices'); title.id = 'setup-choices-title';
  const empty = el('p', 'text-on-surface-variant', 'Nothing chosen yet. Add content from the catalog.'); empty.id = 'setup-choices-empty';
  const list = el('ul', 'space-y-1'); list.id = 'setup-choices-list';
  node.append(title, empty, list);
  let removing = false;

  function line({ root, item, name, needed }) {
    const row = el('li', 'flex flex-wrap items-center gap-x-2 gap-y-0.5'); row.dataset.choiceItem = root.itemId;
    const label = el('span', 'font-medium text-on-surface', name); label.title = `${item?.family ? `${item.family} · ` : ''}${root.itemId} · ${root.scope ?? ''}`.replace(/ · $/, '');
    row.append(label);
    if (needed.length) {
      const fold = el('details', 'setup-choice-needs text-on-surface-variant');
      fold.append(el('summary', 'cursor-pointer', `+ ${needed.length} it needs`));
      const names = el('ul', 'pl-4 text-[11px]');
      names.append(...needed.map(entry => el('li', '', entry.name)));
      fold.append(names); row.append(fold);
    }
    const remove = button('Remove from setup', async () => {
      if (removing) return;
      removing = true; render(); remove.setAttribute('aria-busy', 'true');
      try { await onRemove(root, name); } finally { removing = false; render(); }
    });
    remove.setAttribute('aria-label', `Remove ${name} from setup`);
    compact(remove, 'ml-auto');
    remove.disabled = removing || Boolean(client.candidate);
    row.append(remove);
    return row;
  }

  function render() {
    const draft = client.draft, intent = client.intent;
    const roots = draft?.roots ?? intent?.roots ?? [];
    const items = client.catalog?.items ?? [];
    const needs = setupNeeds({ intent, draft, policyBytes: draft ? undefined : client.bytes });
    const lines = choiceLines({ roots, needs, items });
    title.textContent = lines.length ? `Your choices (${lines.length})` : 'Your choices';
    empty.hidden = Boolean(lines.length);
    list.replaceChildren(...lines.map(line));
  }
  return { node, render };
}

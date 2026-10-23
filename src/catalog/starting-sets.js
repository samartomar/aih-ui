/*
 * Starting sets (#134): the Catalog's `framework` and `template` items are whole sets, such as everything AIH-Extensions
 * has for one tool. They are not cards; a line at the top of the framework offers the ones that fit the chosen tool,
 * and Add all adds the set itself through the same one-click Add, so Catalog's resolver brings what it requires.
 *
 * The Catalog does not publish which tool a set is for (samartomar/aih-catalog#126), and a set's label is never read
 * for it. The page works it out from published facts only: the items Catalog's resolver says the set requires (the
 * host's read-only `needs`) and the support each of them declares, by the same supported rule as the card filter.
 */

import { declaredTools, supportedFor } from './tool-match.js';
import { el } from '../app/dom.js';

const STARTING_SET_KINDS = new Set(['framework', 'template']);
const ANY_TOOL = 'generic';

const entryKey = (releaseSha256, itemId) => `${releaseSha256}/${itemId}`;
const declaresSpecificTool = item => declaredTools(item).some(tool => tool.client !== ANY_TOOL);
const itemOf = (items, ref) => items.find(item => item.id === ref.itemId && item.root?.releaseSha256 === ref.releaseSha256);
const nameOf = item => String(item.label ?? item.id);

/** A starting set: an item the Catalog files as kind `framework` or `template`. */
export const isStartingSet = item => STARTING_SET_KINDS.has(item?.kind);

/** The entry ids (`<releaseSha256>/<itemId>`) of the catalog's starting sets. */
export function startingSetIds(items) {
  return new Set(items.filter(isStartingSet).map(item => entryKey(item.root?.releaseSha256, item.id)));
}

/**
 * Whether a set fits the tool, from `needs` (the items Catalog's resolver says the set requires, without the set):
 *   fits        every one of them, and the set itself, that declares a specific tool is supported for `tool`, and at least one does
 *   other-tool  at least one declares a specific tool but is not marked supported for `tool` (`notSupported` names them)
 *   undeclared  none of them declares a specific tool, so the Catalog does not say the set fits any
 *   unknown     a required item is not in the installed catalog, so its support cannot be read
 */
export function setFit({ set, needs, items, tool }) {
  const required = needs.map(ref => itemOf(items, ref));
  if (required.some(item => !item)) return { status: 'unknown', notSupported: [] };
  const declaring = [set, ...required].filter(declaresSpecificTool);
  if (!declaring.length) return { status: 'undeclared', notSupported: [] };
  const notSupported = declaring.filter(item => !tool || !supportedFor(item, tool)).map(nameOf);
  return { status: notSupported.length ? 'other-tool' : 'fits', notSupported };
}

const KIND_ORDER = ['skill', 'agent', 'command', 'mcp', 'instruction', 'hook'];
const NOUNS = { skill: ['skill', 'skills'], agent: ['agent', 'agents'], command: ['command', 'commands'], mcp: ['MCP server', 'MCP servers'],
  instruction: ['rule', 'rules'], hook: ['hook', 'hooks'] };
const counted = (count, kind) => { const [one, many] = NOUNS[kind] ?? [`${kind} item`, `${kind} items`]; return `${count} ${count === 1 ? one : many}`; };
const order = kinds => [...kinds].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
function byKind(list) {
  const counts = new Map();
  for (const item of list) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return order(counts.keys()).map(kind => counted(counts.get(kind), kind));
}

/**
 * What a set brings, in words: the items it requires counted by kind, its supporting files (supporting.js), and the
 * optional items offered for the tool (optionalFor). `total` is the number of items it requires.
 */
export function setBrings({ needs, items, supporting, optional = [] }) {
  const required = needs.map(ref => itemOf(items, ref)).filter(Boolean);
  const files = required.filter(item => supporting.has(entryKey(item.root?.releaseSha256, item.id))), content = required.filter(item => !files.includes(item));
  const missing = needs.length - required.length;
  const parts = byKind(content);
  if (missing) parts.push(`${missing} not in the installed catalog`);
  let text = parts.join(', ');
  if (files.length) text += `${text ? ', plus ' : ''}${files.length} supporting ${files.length === 1 ? 'file' : 'files'}`;
  if (optional.length) text += `; ${byKind(optional.map(value => value.item)).join(', ')} optional`;
  return { text: text || 'Needs no other items', total: needs.length };
}

/**
 * The optional items a set lists that the Catalog supports for the tool, with the inputs each one needs from the person
 * (a hook's command, for example). With no tool there is nothing to offer.
 */
export function optionalFor(set, items, tool) {
  if (!tool) return [];
  return (set.dependencies?.optional ?? [])
    .map(ref => typeof ref?.itemId === 'string' && ref.release === undefined ? itemOf(items, { itemId: ref.itemId, releaseSha256: ref.releaseSha256 ?? set.root?.releaseSha256 }) : undefined)
    .filter(item => item && supportedFor(item, tool))
    .map(item => ({ item, inputs: Object.entries(item.inputs ?? {}).filter(([, input]) => input?.type === 'string')
      .map(([name, input]) => ({ name, description: input.description, required: input.required === true, maxLength: input.maxLength })) }));
}

/** The confirmation after Add all: the set and what came with it, in counts. */
export function setAddedMessage({ name, brings, optional = [], draft = false }) {
  const extra = optional.length ? `, and ${optional.length} optional ${optional.length === 1 ? 'item' : 'items'} (${optional.join(', ')})` : '';
  return draft ? `Added ${name} to your draft: ${brings.text}${extra}. Save the draft to keep it.` : `Added ${name} to your setup: ${brings.text}${extra}.`;
}

/** The line under the starting sets: why the others are not offered for this tool, or how to see which fit. */
export function fitNote({ tool, statuses }) {
  if (!statuses.length) return '';
  if (!tool) return `This framework has ${statuses.length} starting ${statuses.length === 1 ? 'set' : 'sets'}. Choose your tool in the header to see the ones that fit it.`;
  const count = status => statuses.filter(value => value === status).length;
  const other = count('other-tool'), undeclared = count('undeclared');
  const phrases = [other ? [other, `${other === 1 ? 'needs' : 'need'} items the Catalog does not mark supported for ${tool}`] : null,
    undeclared ? [undeclared, `${undeclared === 1 ? 'has' : 'have'} no item that declares a tool`] : null].filter(Boolean);
  if (!phrases.length) return '';
  if (!count('fits') && !count('unknown') && !count('refused')) return `No starting set in this framework fits ${tool}: ${phrases.map(([n, said]) => `${n} ${said}`).join(', and ')}. Advanced shows them all.`;
  const [[first, said], ...rest] = phrases;
  return `${first} more starting ${first === 1 ? 'set' : 'sets'} in this framework ${said}${rest.map(([n, more]) => `, and ${n} ${more}`).join('')}. Advanced shows them all.`;
}

const rootOf = set => ({ releaseSha256: set.root.releaseSha256, itemId: set.id, scope: set.root.scope });
const optionalKey = item => entryKey(item.root?.releaseSha256, item.id);

/**
 * The Starting sets line at the top of a framework's cards. It asks the host's read-only `needs` once per set (per
 * catalog) and offers each set that fits the chosen tool, with Add all for my tool. With no tool chosen it says how many
 * sets there are and asks for the tool, since most sets exist once per tool.
 *
 * @param onAddSet     called with the set item and { optional: [{ item, configuration }], brings }; resolves when the Add has settled
 * @param onRemoveSet  called with the set item when Remove set is used (#144); resolves when the removal has settled
 */
export function createStartingSets({ section, list, note, authoring, onAddSet, onRemoveSet = async () => {} }) {
  const needs = new Map(); let needsFor = null, drawn = '', model = null;
  // What the person ticked and typed for each set's optional items, kept across re-renders.
  const choices = new Map();
  const choiceOf = key => { if (!choices.has(key)) choices.set(key, { include: false, values: new Map() }); return choices.get(key); };

  function ask(set) {
    const key = entryKey(set.root.releaseSha256, set.id);
    if (!needs.has(key)) {
      const entry = { result: undefined };
      needs.set(key, entry);
      Promise.resolve().then(() => authoring.request('needs', { root: rootOf(set), policyBytes: undefined })).catch(() => null)
        .then(result => { entry.result = result ?? { status: 'unreadable' }; if (model) render(model); });
    }
    return needs.get(key).result;
  }

  function optionalBox(offered, choice, update) {
    // Optional items are not added unless ticked; each shows the inputs it needs from the person (a hook's command).
    const box = el('div', 'w-full space-y-1');
    const tick = el('label', 'flex items-center gap-2 text-[11px] text-on-surface'), input = el('input');
    input.type = 'checkbox'; input.checked = choice.include; input.className = 'wb-starting-set-optional';
    tick.append(input, el('span', '', `Include the ${byKind(offered.map(value => value.item)).join(', ')} it lists as optional`));
    const fields = el('div', 'pl-5 space-y-2'); fields.hidden = !choice.include;
    for (const { item, inputs } of offered) {
      const part = el('div', 'space-y-0.5');
      part.append(el('p', 'text-[11px] font-medium text-on-surface', nameOf(item)));
      for (const field of inputs) {
        const value = el('input', 'w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[11px]');
        value.type = 'text'; value.value = choice.values.get(optionalKey(item))?.[field.name] ?? '';
        if (field.maxLength) value.maxLength = field.maxLength;
        value.setAttribute('aria-label', `${field.name} for ${nameOf(item)}`);
        value.addEventListener('input', () => { choice.values.set(optionalKey(item), { ...choice.values.get(optionalKey(item)), [field.name]: value.value }); update(); });
        part.append(value);
        if (field.description) part.append(el('p', 'text-[10px] text-on-surface-variant break-words', `${field.required ? 'Needed: ' : ''}${field.description}`));
      }
      if (!inputs.length) part.append(el('p', 'text-[10px] text-on-surface-variant', 'Needs nothing typed.'));
      fields.append(part);
    }
    input.addEventListener('change', () => { choice.include = input.checked; fields.hidden = !input.checked; update(); });
    box.append(tick, fields);
    return box;
  }

  function row(set, { fit, result, tool, items, supporting, accepted, acceptedLabel }) {
    const key = entryKey(set.root.releaseSha256, set.id), name = nameOf(set);
    const node = el('div', 'wb-starting-set p-2 rounded border border-wb-border bg-surface-container-low flex flex-wrap items-center gap-x-3 gap-y-1');
    node.dataset.setId = key;
    const words = el('div', 'min-w-0 flex-1');
    words.append(el('p', 'font-medium text-on-surface break-words', name));
    if (result?.status !== 'ok') {
      const said = (result?.diagnostics ?? []).map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
      words.append(el('p', 'text-[11px] text-on-surface-variant break-words', result?.diagnostics ? `The Catalog could not work out what this set needs, so it cannot be added.${said ? ` ${said}` : ''}` : 'What this set needs could not be read.'));
      node.append(words); return node;
    }
    const offered = optionalFor(set, items, tool), brings = setBrings({ needs: result.value.needs, items, supporting, optional: offered });
    words.append(el('p', 'wb-starting-set-brings text-[11px] text-on-surface-variant break-words', brings.text));
    if (fit.status === 'unknown') words.append(el('p', 'text-[11px] text-on-surface-variant', `It needs items that are not in the installed catalog, so whether it fits ${tool} cannot be read.`));
    node.append(words);
    const choice = choiceOf(key);
    const missingInput = () => choice.include && offered.some(({ item, inputs }) => inputs.some(input => input.required && !(choice.values.get(optionalKey(item))?.[input.name] ?? '').trim()));
    const chosen = accepted.some(root => root.itemId === set.id && root.releaseSha256 === set.root.releaseSha256);
    // Once the set is in the setup, Add all becomes Remove set (#144): it takes out the set's own root.
    const label = chosen ? 'Remove set' : 'Add all for my tool';
    const action = el('button', '', label);
    action.type = 'button'; action.className = 'wb-starting-set-add';
    action.setAttribute('aria-label', `${label}: ${name}`);
    const update = () => {
      const blocked = !chosen && (missingInput() || fit.status !== 'fits');
      action.disabled = blocked; action.setAttribute('aria-disabled', String(blocked));
      action.className = `wb-starting-set-add px-2 py-1 rounded border text-[11px] font-medium shrink-0 ${chosen ? 'bg-primary-container text-on-primary border-primary' : blocked ? 'border-wb-border text-outline cursor-not-allowed' : 'border-wb-control-border text-on-surface hover:text-primary hover:border-primary'}`;
      action.title = chosen ? `In your ${acceptedLabel === 'In draft' ? 'draft' : 'setup'} with everything it needs. Remove set takes the set out; Undo puts it back.` : fit.status !== 'fits' ? `Whether this set fits ${tool} cannot be read, so it is not added from here.` : missingInput() ? 'Type the command each optional item needs, or untick Include.'
        : `Add ${name} and everything it requires to your setup in one step${choice.include ? ', with the optional items you ticked' : ''}.`;
    };
    // Once it settles the row may be redrawn (Add all ↔ Remove set); keyboard focus moves to its new button rather than the page.
    const settled = () => {
      action.removeAttribute('aria-busy');
      if (action.isConnected) { action.textContent = label; update(); return; }
      if (document.activeElement === action || document.activeElement === document.body || !document.activeElement?.isConnected)
        [...list.children].find(row => row.dataset.setId === key)?.querySelector?.('.wb-starting-set-add')?.focus();
    };
    action.addEventListener('click', async () => {
      if (action.disabled) return;
      if (chosen) {
        action.disabled = true; action.textContent = 'Removing…'; action.setAttribute('aria-busy', 'true');
        try { await onRemoveSet(set); } finally { settled(); }
        return;
      }
      const optional = choice.include ? offered.map(({ item, inputs }) => ({ item,
        configuration: Object.fromEntries(inputs.map(input => [input.name, choice.values.get(optionalKey(item))?.[input.name] ?? '']).filter(([, value]) => value !== '')) })) : [];
      action.disabled = true; action.textContent = 'Adding…'; action.setAttribute('aria-busy', 'true');
      try { await onAddSet(set, { optional, brings: setBrings({ needs: result.value.needs, items, supporting }) }); }
      finally { settled(); }
    });
    node.append(action);
    if (offered.length && !chosen) node.append(optionalBox(offered, choice, update));
    update();
    return node;
  }

  /**
   * @param m { sets, tool, items, supporting, accepted, acceptedLabel } `sets` are the open framework's starting-set items;
   *   `accepted` the roots already in the setup (or draft)
   */
  function render(m) {
    model = m;
    const { sets, tool, items, supporting, accepted, acceptedLabel } = m;
    if (needsFor !== items) { needs.clear(); needsFor = items; drawn = ''; }
    section.hidden = !sets.length;
    if (!sets.length) { list.replaceChildren(); note.hidden = true; drawn = ''; return; }
    const results = sets.map(set => tool ? ask(set) : undefined);
    const fits = sets.map((set, index) => results[index]?.status === 'ok' ? setFit({ set, needs: results[index].value.needs, items, tool }) : { status: results[index] ? 'refused' : 'waiting' });
    // Redraw only when something shown changed, so ticks, typed commands and focus survive unrelated re-renders.
    const signature = JSON.stringify([tool, sets.map(set => set.id), fits.map(fit => fit.status), accepted.map(root => [root.releaseSha256, root.itemId]), acceptedLabel]);
    if (signature === drawn) return;
    drawn = signature;
    const waiting = Boolean(tool) && fits.some(fit => fit.status === 'waiting');
    const shown = tool ? sets.filter((set, index) => ['fits', 'unknown', 'refused'].includes(fits[index].status)) : [];
    list.replaceChildren(...shown.map(set => { const index = sets.indexOf(set); return row(set, { fit: fits[index], result: results[index], tool, items, supporting, accepted, acceptedLabel }); }));
    const text = waiting ? `Working out which starting sets fit ${tool}…` : fitNote({ tool, statuses: fits.map(fit => fit.status) });
    note.textContent = text; note.hidden = !text;
  }

  return { render };
}

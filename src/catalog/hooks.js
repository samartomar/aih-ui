/*
 * Hooks for your tool (#135). A framework's hook items are not cards; a short Hooks section above the cards offers the
 * ones the Catalog marks supported for Your tool, each with what it does, the command it runs, and Add.
 *
 * The command is never invented. The Catalog publishes no command for today's hooks (samartomar/aih-catalog#131,
 * samartomar/aih-extensions#16): each declares a required string input the person types after reviewing it. The row
 * says so plainly and reuses the configuration editor for that input; were the Catalog to declare the command (a
 * default for the input), that exact command is shown. The Catalog publishes no event field on an item either, so the
 * event is said to be not published rather than read from a description.
 */

import { el } from '../app/dom.js';
import { createConfigurationEditor } from '../app/configuration-editor.js';
import { declaredTools, supportedFor } from './tool-match.js';

const entryKey = item => `${item.root?.releaseSha256}/${item.id}`;
const nameOf = item => String(item.label ?? item.id);

/** The entry ids (`<releaseSha256>/<itemId>`) of the catalog's hooks: hook items that are not supporting material. */
export function hookEntryIds(items, supporting) {
  return new Set(items.filter(item => item?.kind === 'hook' && !supporting.has(entryKey(item))).map(entryKey));
}

/** The hooks offered for the tool: those the Catalog marks supported for it. With no tool there are none. */
export function hooksFor(hooks, tool) {
  return tool ? hooks.filter(item => supportedFor(item, tool)) : [];
}

/** What the Catalog says about the command a hook runs: the command it declares, if any, and the inputs the person types. */
export function commandOf(item) {
  const inputs = Object.entries(item.inputs ?? {}).filter(([, input]) => input?.type === 'string')
    .map(([name, input]) => ({ name, description: input.description, required: input.required === true, default: input.default }));
  const declared = inputs.find(input => typeof input.default === 'string' && input.default.trim())?.default ?? null;
  return { declared, inputs,
    text: declared ? `The Catalog declares this command: ${declared}`
      : 'The Catalog does not publish the command this hook runs. You type it below after reviewing it, and the Catalog checks it before it is added.' };
}

/** The tool a chosen hook runs in, in the Catalog's own names: Your tool when it is supported there, else the tools it is supported for. */
function toolWords(item, tool) {
  if (tool && supportedFor(item, tool)) return tool;
  const supported = declaredTools(item).map(value => value.client).filter(client => client !== 'generic' && supportedFor(item, client));
  return supported.length ? supported.join(', ') : 'Your tool';
}

/** Your setup, before Install: the command a chosen hook will run (as typed, or as the Catalog declares it), and a plain note. */
export function setupHookNote({ item, configuration = {}, tool }) {
  const { declared, inputs } = commandOf(item);
  const typed = inputs.map(input => configuration[input.name]).find(value => typeof value === 'string' && value.trim());
  const command = typed ?? declared;
  if (!command) return { command: null, text: 'No command typed yet. Type it under Advanced, Chosen items, before you Install.' };
  return { command, text: `${toolWords(item, tool)} will run this command each time the hook's event happens. The Catalog does not say which event that is.` };
}

function button(label, handler) {
  const node = el('button', 'px-2 py-1 rounded border border-wb-control-border text-[11px] font-medium text-on-surface hover:text-primary hover:border-primary', label);
  node.type = 'button';
  node.addEventListener('click', () => handler());
  return node;
}

/**
 * The Hooks section. It shows only when the open framework has hooks supported for Your tool; with no tool chosen it
 * asks for one, since hooks are made for one tool.
 *
 * @param onAdd  called with the hook item, its root carrying the configuration typed; resolves when the Add has settled
 */
export function createHooks({ section, list, note, onAdd }) {
  let drawn = '';

  function row(item, { accepted, acceptedLabel, neededBy }) {
    const node = el('div', 'wb-hook p-2 rounded border border-wb-border bg-surface-container-low space-y-1');
    node.dataset.hookId = entryKey(item);
    node.append(el('p', 'font-medium text-on-surface break-words', nameOf(item)));
    if (item.description) node.append(el('p', 'text-[11px] text-on-surface-variant break-words', item.description));
    const chosen = accepted.find(root => root.itemId === item.id && root.releaseSha256 === item.root.releaseSha256);
    const needed = chosen ? '' : neededBy(item);
    const command = el('div', 'wb-hook-command space-y-0.5');
    command.append(el('p', 'text-[11px] font-medium text-on-surface', 'Command it runs'));
    if (chosen) {
      const { command: value, text } = setupHookNote({ item, configuration: chosen.configuration, tool: '' });
      command.append(value ? el('code', 'block font-mono text-[11px] text-on-surface break-all', value) : el('p', 'text-[11px] text-on-surface-variant', text));
    } else command.append(el('p', 'text-[11px] text-on-surface-variant break-words', commandOf(item).text));
    node.append(command, el('p', 'text-[11px] text-on-surface-variant', 'Event: not published by the Catalog.'));
    if (chosen || needed) {
      const label = chosen ? acceptedLabel : needed;
      const state = el('button', `px-2 py-1 rounded border text-[11px] font-medium ${chosen ? 'bg-primary-container text-on-primary border-primary' : 'border-wb-border text-on-surface-variant cursor-not-allowed'}`, label);
      state.type = 'button'; state.disabled = true; state.setAttribute('aria-disabled', 'true');
      state.setAttribute('aria-label', `${label}: ${nameOf(item)}`);
      node.append(state);
      return node;
    }
    node.append(createConfigurationEditor({ configuration: {}, inputs: item.inputs, label: nameOf(item), button, open: true,
      summary: 'Type the command it should run', submitLabel: 'Add with this command', intro: '',
      review: configuration => onAdd({ ...item, root: { ...item.root, configuration } }) }));
    return node;
  }

  /** @param m { hooks, tool, accepted, acceptedLabel, neededBy } `hooks` are the open framework's hook items */
  function render({ hooks, tool, accepted, acceptedLabel, neededBy }) {
    const shown = hooksFor(hooks, tool);
    const askTool = !tool && hooks.length > 0;
    section.hidden = !shown.length && !askTool;
    // Redraw only when something shown changed, so a command being typed survives unrelated re-renders.
    const signature = JSON.stringify([tool, hooks.map(entryKey), accepted.map(root => [root.releaseSha256, root.itemId, root.configuration ?? {}]), acceptedLabel, shown.map(neededBy)]);
    if (signature === drawn) return;
    drawn = signature;
    list.replaceChildren(...shown.map(item => row(item, { accepted, acceptedLabel, neededBy })));
    note.textContent = askTool ? `This framework has ${hooks.length} ${hooks.length === 1 ? 'hook' : 'hooks'}. Choose your tool in the header to see the ones for it.` : '';
    note.hidden = !note.textContent;
  }

  return { render };
}

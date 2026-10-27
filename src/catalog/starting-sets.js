import { el } from '../app/dom.js';
import { iconSpan } from '../app/icons.js';
import { attachTooltip } from '../app/tooltip.js';
// UI state only. All membership/option expansion is returned by Catalog.
export function createStartingSets({ container, onChange, onAdd }) {
  let shownFramework;
  function button(set, chosen, update) {
    const node = el('button', 'set-choice', set.name); node.type = 'button';
    node.dataset.setId = set.id; node.setAttribute('aria-pressed', String(chosen));
    attachTooltip(node, `${set.description ?? set.name} · ${set.offer}. Exact set ${set.setSha256}.`);
    node.addEventListener('click', () => update(set.id)); return node;
  }
  return { render({ framework, requests, result, allItems, items, frameworks = [], hasTool, saved = false }) {
    const same = shownFramework === framework?.sha256;
    const open = same ? { more: container.querySelector('.more-sets')?.open, members: container.querySelector('.set-members')?.open } : {};
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    const focus = active?.dataset?.setId ? ['data-set-id', active.dataset.setId] : active?.dataset?.option ? ['data-option', active.dataset.option] : active?.dataset?.member ? ['data-member', active.dataset.member] : null;
    shownFramework = framework?.sha256;
    container.replaceChildren();
    if (!framework) { container.append(el('p', '', 'Starting sets unavailable: no framework is open.')); return; }
    const sets = framework.sets ?? [];
    const title = el('div', 'set-heading'); title.append(iconSpan('state', 'starting-set'), el('span', '', 'Starting sets'));
    container.append(title);
    const change = next => onChange(next, allItems);
    const toggle = id => {
      const prior = requests.find(request => request.setId === id), set = sets.find(set => set.id === id);
      change(prior ? requests.filter(request => request !== prior) : [...requests, { release: { releaseSha256: framework.sha256, scope: 'project' }, setId: id, setSha256: set.setSha256, options: {}, members: [] }]);
    };
    if (!sets.length) container.append(el('p', 'set-note', 'No starting sets published. Browse all choosable content below.'));
    const initial = sets.filter(set => set.offer === 'pre-ticked'), more = sets.filter(set => set.offer !== 'pre-ticked');
    const row = el('div', 'set-choices');
    for (const set of initial) row.append(button(set, requests.some(request => request.setId === set.id), toggle));
    if (more.length) {
      const disclosure = el('details', 'more-sets'); disclosure.append(el('summary', '', 'More sets'));
      const list = el('div', 'set-choices');
      for (const offer of ['listed', 'on-request']) {
        const offered = more.filter(set => set.offer === offer); if (!offered.length) continue;
        const group = el('div', 'set-offer'); group.append(el('strong', '', offer === 'listed' ? 'Listed sets' : 'On request'));
        for (const set of offered) group.append(button(set, requests.some(request => request.setId === set.id), toggle)); list.append(group);
      }
      disclosure.append(list); row.append(disclosure);
    }
    container.append(row);
    for (const request of requests) {
      const set = sets.find(set => set.id === request.setId);
      for (const option of set?.options ?? []) {
        const field = el('fieldset', 'set-options'); field.append(el('legend', '', option.name));
        for (const choice of option.choices) {
          const label = el('label', 'set-choice'); const tick = el('input'); tick.type = 'checkbox'; tick.dataset.option = choice.id;
          tick.checked = request.options?.[option.id]?.includes(choice.id) ?? false;
          tick.addEventListener('change', () => { const values = new Set(request.options?.[option.id] ?? []); if (tick.checked) values.add(choice.id); else values.delete(choice.id);
            change(requests.map(value => value !== request ? value : { ...request, options: { ...request.options, [option.id]: [...values] } })); });
          label.append(tick, document.createTextNode(choice.name)); attachTooltip(label, choice.description ?? `Catalog resolves ${choice.name} and its matching modules.`); field.append(label);
        }
        container.append(field);
      }
    }
    if (result && !['read', 'unavailable'].includes(result.status)) {
      const reset = el('button', 'set-choice', 'Reset set choices'); reset.type = 'button';
      reset.addEventListener('click', () => change(sets.filter(set => set.offer === 'pre-ticked').map(set => ({ release: { releaseSha256: framework.sha256, scope: 'project' }, setId: set.id, setSha256: set.setSha256, options: {}, members: [] })))); container.append(reset);
    }
    const controls = el('div', 'set-footer');
    if (requests.length || saved) {
      const add = el('button', 'set-add', !requests.length ? 'Remove chosen sets' : saved ? 'Update chosen sets' : 'Add chosen sets'); add.type = 'button'; add.dataset.addSets = '';
      if (!hasTool) add.setAttribute('aria-disabled', 'true');
      add.addEventListener('click', () => { if (add.getAttribute('aria-disabled') !== 'true') onAdd(requests); }); attachTooltip(add, hasTool ? 'Add the exact members Catalog resolves, with options, exclusions and qualified set origins. No installation runs.' : 'Choose your tool in the header before adding sets. Your existing choices are unchanged.'); controls.append(add);
    }
    const all = el('label', 'set-all'); const tick = el('input'); tick.type = 'checkbox'; tick.id = 'browse-all-items'; tick.checked = allItems;
    tick.addEventListener('change', () => onChange(requests, tick.checked)); all.append(tick, document.createTextNode('All items')); controls.append(all);
    if (result?.status === 'read') {
      const fit = result.compatibility?.sets ?? [];
      for (const value of fit) { const badge = el('span', 'browse-fact', `${value.set?.setId ?? value.setId ?? 'Set'} · ${value.members.native} observed · ${value.members.unconfirmed} unconfirmed · ${value.members.none} unavailable`); badge.append(iconSpan('state', 'info')); attachTooltip(badge, JSON.stringify(value)); controls.append(badge); }
    } else controls.append(el('span', 'set-note', result?.status === 'refused' ? 'Set choices refused. All items remains available; adjust choices before adding.' : result?.reason ?? (result?.diagnostics?.map(value => value.message).join(' ') || 'Reading set membership and tool fit…')));
    container.append(controls);
    if (result?.resolution?.status === 'refused') {
      const refusal = el('details', 'set-refusal'); refusal.append(el('summary', '', 'Set choice details'), el('pre', 'browse-json', JSON.stringify(result.resolution.diagnostics, null, 2))); container.append(refusal);
    }
    if (requests.length) {
      const members = el('details', 'set-members'); members.append(el('summary', '', 'Members & separate hook choices'));
      const selected = result?.resolution?.value?.selections ?? [];
      for (const entry of selected) {
        const item = items.find(item => item.id === entry.item.itemId && item.root.releaseSha256 === entry.item.releaseSha256); if (!item || item.role === 'supporting') continue;
        const label = el('label', `set-member${item.kind === 'hook' ? ' set-hook' : ''}`); const tick = el('input'); tick.type = 'checkbox'; tick.checked = true; tick.dataset.member = item.id;
        // Catalog owns refusal of excluding required members; never infer it here.
        tick.addEventListener('change', () => change(requests.map(request => entry.origins.some(origin => origin.set?.setId === request.setId && origin.set.framework === framework.id) ? ({ ...request, members: [...(request.members ?? []).filter(value => value.item.itemId !== item.id), { item: { framework: frameworks.find(value => value.sha256 === entry.item.releaseSha256)?.id ?? framework.id, itemId: item.id }, include: tick.checked }] }) : request)));
        if (!entry.origins.some(origin => origin.reasonIncluded === 'in-set')) { tick.disabled = true; attachTooltip(label, 'Included because another chosen member requires it. The exact reasons remain in Your setup.'); }
        label.append(tick, iconSpan('kind', item.kind), document.createTextNode(item.name ?? item.label)); attachTooltip(label, JSON.stringify(entry.origins)); members.append(label);
      }
      for (const request of requests) for (const member of sets.find(set => set.id === request.setId)?.members ?? []) if (member.optional && !selected.some(entry => entry.item.itemId === member.item.itemId)) {
        const item = items.find(item => item.id === member.item.itemId); if (!item) continue;
        const override = (request.members ?? []).find(value => value.item.itemId === member.item.itemId);
        const label = el('label', `set-member${item.kind === 'hook' ? ' set-hook' : ''}`); const tick = el('input'); tick.type = 'checkbox'; tick.checked = override?.include ?? false; tick.dataset.member = item.id;
        tick.addEventListener('change', () => change(requests.map(value => value !== request ? value : { ...value, members: [...(value.members ?? []).filter(value => value.item.itemId !== member.item.itemId), { item: { framework: member.item.framework, itemId: member.item.itemId }, include: tick.checked }] })));
        label.append(tick, iconSpan('kind', item.kind), document.createTextNode(item.name ?? item.label)); attachTooltip(label, 'Optional member declared by this set. Catalog resolves inclusion; hooks remain separate choices. A refused choice stays reachable so you can undo it.'); members.append(label);
      }
      container.append(members);
    }
    const morePanel = container.querySelector('.more-sets'); if (morePanel) morePanel.open = Boolean(open.more);
    const memberList = container.querySelector('.set-members'); if (memberList) memberList.open = Boolean(open.members);
    if (same && focus) container.querySelector(`[${focus[0]}="${CSS.escape(focus[1])}"]`)?.focus();
  } };
}

/*
 * "Your choices" in Your setup (#137): one line per chosen item, with the items it needs folded under it ("+ 2 it
 * needs") and Remove from setup. The needed-by relation is only what Catalog resolved (setup-needs.js); nothing here
 * decides it. Remove from setup goes through the same remove-root proposal and acceptance as Undo after Add
 * (`onRemove`). Configuration, skips and an open draft's markers and compile stay in Advanced, under Chosen items.
 */

import { setupNeeds } from './setup-needs.js';
import { compact } from './compact.js';
import { copiesWords, drawerCopiesWords, secondCopyWarnings } from './tool-host-warnings.js';
import { itemDisplayName } from '../catalog/item-name.js';
import { setDisplayName, UNNAMED_SET } from '../catalog/set-name.js';

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
  const name = (key, fallback) => String(itemDisplayName(byKey.get(key), fallback));
  return roots.map(root => {
    const key = entryKey(root), item = byKey.get(key);
    const needed = [...needs.entries()].filter(([entry, by]) => !chosen.has(entry) && by.some(value => entryKey(value) === key))
      .map(([entry]) => ({ name: name(entry, entry.slice(entry.indexOf('/') + 1)) }));
    return { root, item, name: name(key, root.itemId), needed };
  });
}

/** `onRemove(root, name)` takes one chosen item out of the setup and resolves when it is done.
 * `hostView()` returns the last Core host-inspection result (or undefined while loading); the drawer only
 * projects it, exactly as the cards and inspector do (#163). */
export function createSetupChoices({ client, el, button, onRemove = async () => {}, hostView = () => undefined }) {
  const node = el('section', 'space-y-1'); node.id = 'setup-choices';
  const title = el('h3', 'text-sm font-semibold text-on-surface', 'Your choices'); title.id = 'setup-choices-title';
  const empty = el('p', 'text-on-surface-variant', 'Nothing chosen yet. Add content from the catalog.'); empty.id = 'setup-choices-empty';
  const list = el('ul', 'space-y-1'); list.id = 'setup-choices-list';
  const hostLine = el('p', 'text-on-surface-variant text-[11px]'); hostLine.id = 'setup-choices-host-copies'; hostLine.setAttribute('role', 'status');
  node.append(title, empty, list, hostLine);
  let removing = false;
  // A saved set request by the name Catalog publishes for it; its exact identity stays in the tooltip.
  const setName = request => setDisplayName(client.catalog?.frameworks, { releaseSha256: request?.release?.releaseSha256, setId: request?.setId, setSha256: request?.setSha256 }) ?? UNNAMED_SET;

  function line({ root, item, name, needed }) {
    const row = el('li', 'flex flex-wrap items-center gap-x-2 gap-y-0.5'); row.dataset.choiceItem = root.itemId;
    const label = el('span', 'font-medium text-on-surface', name); label.title = `${item?.family ? `${item.family} · ` : ''}${root.itemId} · ${root.scope ?? ''}`.replace(/ · $/, '');
    row.append(label);
    // A second-copy warning names its item; the summary line below carries the check's own state.
    const host = hostView();
    const mine = secondCopyWarnings(host).filter(warning => warning.itemId === root.itemId);
    if (mine.length) row.append(el('span', 'setup-choice-copies text-[11px]', copiesWords(host, root.itemId, { chosen: true })));
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
    // One snapshot everywhere (Q6-R): an open draft's LIVE intent wins, for grouping and host facts alike.
    const source = draft ? draft.intent : intent;
    const roots = source?.roots ?? [];
    const items = client.catalog?.items ?? [];
    const needs = setupNeeds({ intent, draft, policyBytes: draft ? undefined : client.bytes, items });
    const entries = choiceLines({ roots, needs, items });
    title.textContent = entries.length ? `Your choices (${entries.length})` : 'Your choices';
    empty.hidden = Boolean(entries.length);
    list.replaceChildren(...groupedLines(entries, source));
    for (const section of leftOutSection(source, items) ?? []) list.append(section);
    hostLine.textContent = drawerCopiesWords(hostView());
  }
  // Named left-out groups (Q7-R), from the live intent's recorded exclusions: each exclusion keeps the
  // originId of the set choice that authored it, so left-out items group under that recorded exact set
  // identity. Direct exclusions stay in their own explicit group; an origin the intent no longer records
  // is said as unknown - never a fabricated set. Reasons render verbatim when recorded.
  function leftOutSection(source, items) {
    const exclusions = source?.exclusions ?? [];
    const byKey = new Map(items.map(item => [itemKey(item), item]));
    const frameworkOf = new Map((client.catalog?.frameworks ?? []).map(framework => [framework.sha256, framework.id]));
    const choices = (source?.provenance ?? []).flatMap(entry => entry.materialSource?.workbenchSetChoices?.choices ?? []);
    // Set-choice origin ids embed their release digest by construction (set-<releaseSha16>-<setId>) and the
    // consumer refuses duplicate identities, so originId is the validated public qualification - no invented
    // collision semantics.
    const byOrigin = new Map(choices.map(choice => [choice.originId, choice.request]));
    const known = new Map((source?.origins ?? []).map(origin => [origin.id, origin]));
    const groups = new Map();
    const push = (key, request, exclusion) => {
      if (!groups.has(key)) groups.set(key, { request, origin: known.get(exclusion.originId), exclusions: [] });
      const group = groups.get(key);
      const memberFramework = exclusion.memberFramework ?? frameworkOf.get(exclusion.releaseSha256);
      const dedupeKey = `${memberFramework ?? exclusion.releaseSha256 ?? 'unknown'}/${exclusion.itemId}/${exclusion.scope ?? ''}`;
      if (group.exclusions.some(value => value.dedupeKey === dedupeKey)) return;
      group.exclusions.push({ ...exclusion, memberFramework, dedupeKey });
    };
    for (const exclusion of exclusions) {
      const request = byOrigin.get(exclusion.originId);
      // The validated intent requires every exclusion originId to exist (intent-shape); a known non-set
      // origin (template, organization, other recorded direct ids) is truthful recorded provenance and
      // must not be described as lost.
      if (request) push(`${request.release?.releaseSha256}/${request.setId}/${request.setSha256}`, request, exclusion);
      else if (known.has(exclusion.originId)) push(`known:${exclusion.originId}`, null, exclusion);
      else push('unknown', null, exclusion);
    }
    // Cross-framework false members are retained only in the saved request; same-framework members can also
    // have an exclusion. Recorded exclusions are pushed first, so deduplication retains their explicit reason.
    for (const choice of choices) {
      const request = choice.request;
      for (const member of request?.members ?? []) {
        if (member.include !== false) continue;
        push(`${request.release?.releaseSha256}/${request.setId}/${request.setSha256}`, request,
          { originId: choice.originId, itemId: member.item?.itemId, scope: request.release?.scope, reason: null, setLeftOut: true, memberFramework: member.item?.framework });
      }
    }
    const nodes = [];
    for (const [key, group] of groups) {
      const section = el('li', 'space-y-1'); section.dataset.leftOut = key;
      const heading = el('p', 'text-[11px] font-medium text-on-surface-variant');
      if (group.request) {
        heading.textContent = `Left out from ${setName(group.request)}`;
        heading.title = key;
        heading.dataset.leftOutSet = group.request.setId;
      } else if (key === 'unknown') { heading.textContent = 'Left out — origin no longer recorded'; heading.dataset.leftOutSet = 'unknown'; }
      else { heading.textContent = `Left out — recorded choice (${group.origin?.kind ?? group.origin?.id ?? 'other'})`; heading.dataset.leftOutSet = 'recorded'; }
      const rows = el('ul', 'pl-3 space-y-1');
      for (const exclusion of group.exclusions) {
        const row = el('li', 'text-[11px] text-on-surface-variant');
        const qualified = `${exclusion.memberFramework}/${exclusion.itemId}`;
        const matches = exclusion.setLeftOut ? items.filter(item => item.id === exclusion.itemId && frameworkOf.get(item.root?.releaseSha256) === exclusion.memberFramework) : [];
        const name = exclusion.setLeftOut
          ? (matches.length === 1 ? itemDisplayName(matches[0], qualified) : qualified)
          : itemDisplayName(byKey.get(`${exclusion.releaseSha256}/${exclusion.itemId}`), exclusion.itemId);
        const setFramework = frameworkOf.get(group.request?.release?.releaseSha256);
        const cross = exclusion.memberFramework && setFramework && exclusion.memberFramework !== setFramework ? ` [${exclusion.memberFramework}]` : '';
        const why = exclusion.reason ? ` — ${exclusion.reason}` : exclusion.setLeftOut ? ` — left out of set ${group.request ? setName(group.request) : ''}`.replace(/ $/, '') : ' — recorded left-out choice';
        row.textContent = `${name}${cross}${exclusion.scope === 'user' ? ' (your folders)' : ''}${why}`;
        row.dataset.leftOutItem = exclusion.itemId;
        rows.append(row);
      }
      section.append(heading, rows);
      nodes.push(section);
    }
    return nodes;
  }
  // Group the actual named choice rows under their recorded exact set identities (Q7-R): simultaneous
  // memberships appear under every set they belong to; roots with no set origin stay explicit. Removal
  // behavior lives in line() and is unchanged by grouping.
  function groupedLines(entries, source) {
    const choices = (source?.provenance ?? []).flatMap(entry => entry.materialSource?.workbenchSetChoices?.choices ?? []);
    const byOrigin = new Map(choices.map(choice => [choice.originId, choice.request]));
    const keyOf = request => `${request.release?.releaseSha256}/${request.setId}/${request.setSha256}`;
    // Each interactive row renders exactly once (its Remove action is never duplicated): in its FIRST
    // recorded set, with an 'Also in' note naming every further exact set membership.
    // Interactive rows are tracked in a local Set: DOM parentElement is a read-only getter and must
    // never be assigned (real-DOM safety).
    const rows = new Map(entries.map(entry => [entry, line(entry)]));
    const placed = new Set();
    const memberships = new Map();
    for (const entry of entries) {
      const sets = (entry.root.originIds ?? []).filter(id => byOrigin.has(id)).map(id => byOrigin.get(id));
      memberships.set(entry, sets);
    }
    const firstKey = new Map([...memberships].map(([entry, sets]) => [entry, sets.length ? keyOf(sets[0]) : null]));
    const groups = new Map();
    const push = (key, request, entry) => {
      if (!groups.has(key)) groups.set(key, { request, entries: [] });
      groups.get(key).entries.push(entry);
    };
    for (const entry of entries) {
      const sets = memberships.get(entry);
      if (!sets.length) { push(null, null, entry); continue; }
      // The entry belongs to every set group; the interactive row renders in its first group, secondary
      // groups keep a named read-only reference (Q7-R2).
      for (const request of sets) push(keyOf(request), request, entry);
    }
    const nodes = [];
    for (const [key, group] of groups) {
      const members = group.entries;
      if (!members.length) continue;
      const head = el('p', 'text-[11px] font-medium text-on-surface-variant');
      if (group.request) {
        head.textContent = setName(group.request);
        head.title = keyOf(group.request);
        head.dataset.choiceSet = group.request.setId;
      } else { head.textContent = 'Individual choices'; head.dataset.choiceSet = 'individual'; }
      const rowsNode = el('ul', 'pl-3 space-y-1');
      for (const entry of members) {
        const row = rows.get(entry);
        const all = memberships.get(entry);
        if (placed.has(entry)) {
          // Secondary group: a named read-only reference keeps the exact membership visible without a
          // second interactive row (Q7-R2).
          const ref = el('li', 'text-[11px] text-on-surface-variant', entry.name);
          ref.title = entry.root.itemId; ref.dataset.setReference = entry.root.itemId;
          rowsNode.append(ref);
          continue;
        }
        // Q7-R2: every further membership is named; its exact identity stays in the tooltip.
        if (all.length > 1) {
          const also = el('span', 'ml-2 text-on-surface-variant text-[11px]', `Also in: ${all.slice(1).map(setName).join(', ')}`);
          also.title = all.slice(1).map(keyOf).join(', ');
          row.children[0].append(also);
        }
        placed.add(entry);
        rowsNode.append(row);
      }
      const wrap = el('li', 'space-y-1', ''); wrap.dataset.choiceGroup = key ?? 'individual';
      wrap.append(head, rowsNode);
      nodes.push(wrap);
    }
    return nodes;
  }
  return { node, render };
}

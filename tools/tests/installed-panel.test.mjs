// Q7-R regression: the installed panel renders the REAL interactive rows (badges and removal controls)
// grouped under their recorded exact set identities; simultaneous memberships stay truthful without
// duplicated actions; no-origin rows stay explicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { originGroups, setLabeller, keptWords } from '../../src/app/installed-list.js';

// The grouping logic itself lives in installed-panel's show(); exercise it through the same view data
// with a minimal DOM, asserting section membership of the real row elements.
const fake = (tag, className = '', text) => {
  const node = { tag, className, textContent: text ?? '', children: [], dataset: {}, attributes: {}, hidden: false,
    append(...children) { for (const child of children) if (child && typeof child === 'object') this.children.push(child); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener() {}, click() {} };
  return node;
};
const walk = (node, out = []) => { out.push(node); for (const child of node.children) walk(child, out); return out; };

test('originGroups carry named members for the panel to place real rows under exact set identities', () => {
  const alpha = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
  const beta = { framework: 'ecc', setId: 'beta', setSha256: 'b'.repeat(64) };
  const inventory = { selections: [
    { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }] },
    { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }] },
    { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }] },
  ] };
  const groups = originGroups(inventory);
  const byKey = new Map(groups.map(group => [group.set ? `${group.set.setId}/${group.set.setSha256}` : 'null', group]));
  assert.deepEqual(byKey.get(`alpha/${'a'.repeat(64)}`).members.map(member => member.name), ['One', 'Two']);
  assert.deepEqual(byKey.get(`beta/${'b'.repeat(64)}`).members.map(member => member.name), ['Two'], 'simultaneous membership is visible under every set');
  assert.deepEqual(byKey.get('null').members.map(member => member.name), ['Three'], 'no-origin rows stay explicit');
});

test('the panel places each interactive row in exactly one set section, noting further memberships', async () => {
  const { createInstalledPanel } = await import('../../src/app/installed-panel.js');
  const alpha = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
  const beta = { framework: 'ecc', setId: 'beta', setSha256: 'b'.repeat(64) };
  const view = {
    readable: true, partial: false,
    groups: [
      { itemId: 'one', managementId: 'm-1', name: 'One', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [alpha], needed: [], removes: [], kept: [] },
      { itemId: 'two', managementId: 'm-2', name: 'Two', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [alpha, beta], needed: [], removes: [], kept: [] },
    ],
    others: [{ managementId: 'm-3', name: 'Three', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [], inSetup: false }],
    originGroups: originGroups({ selections: [
      { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }] },
      { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }] },
      { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }] },
    ] }),
  };
  const el = (tag, className = '', text) => fake(tag, className, text);
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const selections = [
    { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }], members: [{ fileState: 'matches' }] },
  ];
  const inventory = { status: 'complete', selections };
  const client = { catalog: { executionAvailable: true }, requestCurrent: async () => inventory, intent: { roots: [] }, bytes: new Uint8Array() };
  const panel = createInstalledPanel({ client, el, button });
  await panel.refresh();
  const node = panel.node;
  const sections = walk(node).filter(entry => entry.dataset.installedSet);
  assert.equal(sections.length, 2, 'the secondary set keeps its own visible section (Q7-R2)');
  const alphaSection = sections.find(entry => entry.dataset.installedSet === `alpha/${'a'.repeat(64)}`);
  const betaSection = sections.find(entry => entry.dataset.installedSet === `beta/${'b'.repeat(64)}`);
  assert.ok(alphaSection && betaSection, 'both section identities are exact');
  const sectionRows = walk(alphaSection).filter(entry => entry.dataset.installedOther).map(entry => entry.dataset.installedOther).sort();
  assert.deepEqual(sectionRows, ['m-1', 'm-2'], 'the real interactive rows (with their removal controls) are grouped under the exact set');
  assert.ok(walk(betaSection).find(entry => entry.dataset.setReference === 'm-2'), 'the secondary group keeps a named read-only reference to the shared member');
  assert.equal(walk(node).filter(entry => entry.dataset.installedOther === 'm-2').length, 1, 'a simultaneous member renders once (no duplicated actions)');
  // The contract has no "Also in" sentence: a further membership is the named reference under that set's own heading.
  assert.equal(walk(node).filter(entry => /Also in/.test(entry.textContent)).length, 0, 'no made-up membership note');
  const reference = walk(betaSection).find(entry => entry.dataset.setReference === 'm-2');
  assert.deepEqual(reference.children.map(child => child.textContent), ['Two'], 'the further membership names the shared member');
  assert.deepEqual(walk(betaSection).filter(entry => entry.tag === 'p').map(entry => entry.attributes.title ?? entry.title),
    [`ecc/beta/${'b'.repeat(64)}`], 'the further set keeps its exact identity (Q7-R2)');
  const other = walk(node).find(entry => entry.dataset.installedOther === 'm-3');
  assert.ok(other, 'no-origin rows stay explicit outside the set sections');
  assert.equal(walk(other).filter(entry => entry.tag === 'button').length, 1, 'its removal control is present');
});

test('a set heading keeps the name Catalog publishes for the set id when the recorded set digest is older, never the raw id', async () => {
  const { createInstalledPanel } = await import('../../src/app/installed-panel.js');
  const recorded = { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) };
  const gone = { framework: 'ecc', setId: 'ecc.rules.gone', setSha256: 'c'.repeat(64) };
  const state = { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' };
  const selections = [
    { managementId: 'm-1', name: 'coding-style', origins: [{ reasonIncluded: 'in-set', set: recorded }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-2', name: 'old', origins: [{ reasonIncluded: 'in-set', set: gone }], members: [{ fileState: 'matches' }] },
  ];
  // After an update Catalog's set has a new digest; the framework still publishes its display name.
  const frameworks = [{ id: 'ecc', sets: [{ id: 'ecc.rules.typescript', name: 'rules (typescript)', setSha256: 'b'.repeat(64) }] }];
  const client = { catalog: { executionAvailable: true, items: [], frameworks }, requestCurrent: async () => ({ status: 'complete', selections }), intent: { roots: [] }, bytes: new Uint8Array() };
  const el = (tag, className = '', text) => fake(tag, className, text);
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const panel = createInstalledPanel({ client, el, button });
  await panel.refresh();
  const sections = walk(panel.node).filter(entry => entry.dataset.installedSet);
  const heading = setId => walk(sections.find(entry => entry.dataset.installedSet.startsWith(`${setId}/`))).find(entry => entry.tag === 'p');
  assert.equal(heading('ecc.rules.typescript').textContent, 'rules (typescript) (earlier release)', 'the name is resolved by set id within the framework, marked as an earlier release');
  assert.equal(heading('ecc.rules.typescript').title, `ecc/ecc.rules.typescript/${'a'.repeat(64)}`, 'the exact recorded identity stays in the tooltip');
  for (const node of walk(panel.node)) assert.doesNotMatch(node.textContent, /ecc\.rules\./, 'no raw set id is shown');
  for (const node of walk(panel.node)) assert.doesNotMatch(node.attributes['aria-label'] ?? '', /ecc\.rules\./, 'no raw set id is announced');
});

const frameworks = [{ id: 'ecc', sets: [{ id: 'ecc.rules.typescript', name: 'rules (typescript)', setSha256: 'b'.repeat(64) }] }];
const older = { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) };
const newer = { ...older, setSha256: 'b'.repeat(64) };

test('two recorded versions of one set at once get distinguishable headings and Remove labels', async () => {
  const { createInstalledPanel } = await import('../../src/app/installed-panel.js');
  // After an update, the updated member records the newer set while its siblings keep the older one.
  const selections = [
    { managementId: 'm-1', name: 'coding-style', origins: [{ reasonIncluded: 'in-set', set: newer }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-2', name: 'testing', origins: [{ reasonIncluded: 'in-set', set: older }], members: [{ fileState: 'matches' }] },
  ];
  const client = { catalog: { executionAvailable: true, items: [], frameworks }, requestCurrent: async () => ({ status: 'complete', selections }), intent: { roots: [] }, bytes: new Uint8Array() };
  const panel = createInstalledPanel({ client, el: (tag, className = '', text) => fake(tag, className, text), button: (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; } });
  await panel.refresh();
  const sections = walk(panel.node).filter(entry => entry.dataset.installedSet);
  const of = set => sections.find(entry => entry.dataset.installedSet === `${set.setId}/${set.setSha256}`);
  const heading = set => walk(of(set)).find(entry => entry.tag === 'p').textContent;
  const removeLabel = set => walk(of(set)).find(entry => entry.tag === 'button' && /^Remove this set/.test(entry.attributes['aria-label'] ?? '')).attributes['aria-label'];
  assert.equal(heading(newer), 'rules (typescript)', 'the exact set keeps its plain name');
  assert.equal(heading(older), 'rules (typescript) (earlier release)', 'the older recorded version is marked');
  assert.notEqual(removeLabel(newer), removeLabel(older), 'the two Remove buttons are announced differently');
  assert.equal(removeLabel(older), 'Remove this set: rules (typescript) (earlier release)');
});

test('the kept sentence never names the set being removed, nor falls back to a raw action for a set no longer offered', () => {
  const label = setLabeller(frameworks);
  const gone = { framework: 'ecc', setId: 'ecc.rules.gone', setSha256: 'c'.repeat(64) };
  const other = { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'd'.repeat(64) };
  assert.equal(label(newer), 'rules (typescript)');
  assert.equal(label(gone), undefined);
  // Kept for the other version of the set being removed: named, since its name differs from this heading.
  assert.equal(keptWords([newer], label(older), label), 'Kept; also part of rules (typescript)');
  // Kept for a set with the same heading as the one being removed: never named as itself.
  assert.equal(keptWords([other], label(older), label), 'Kept; also part of another release of this set');
  // Kept for a set this Catalog no longer offers.
  assert.equal(keptWords([gone], label(newer), label), 'Kept; also part of a set this catalog no longer offers');
  assert.equal(keptWords([], label(newer), label), undefined, 'kept only by a direct choice or requirement: no set sentence');
});

test('Remove this set names what keeps a member: the user\'s own choice, or the selections that still need it', async () => {
  const { setRemovalEntries, stillNeededWords } = await import('../../src/app/installed-list.js');
  const rules = { framework: 'ecc', setId: 'rules', setSha256: 'a'.repeat(64) };
  const groups = originGroups({ selections: [
    { managementId: 'm-1', scope: 'project', name: 'Chosen too', item: { framework: 'ecc', itemId: 'one' }, origins: [{ reasonIncluded: 'in-set', set: rules }, { reasonIncluded: 'chosen' }] },
    { managementId: 'm-2', scope: 'project', name: 'README', item: { framework: 'ecc', itemId: 'readme' }, origins: [{ reasonIncluded: 'in-set', set: rules }, { reasonIncluded: 'required-by', requiredBy: { framework: 'ecc', itemId: 'tdd' } }] },
    { managementId: 'm-3', scope: 'project', name: 'tdd', item: { framework: 'ecc', itemId: 'tdd' }, origins: [{ reasonIncluded: 'chosen' }] },
  ] });
  const entries = setRemovalEntries(groups.find(group => group.set));
  assert.deepEqual(entries.map(({ managementId, chosen, neededBy }) => ({ managementId, chosen, neededBy })),
    [{ managementId: 'm-1', chosen: true, neededBy: [] }, { managementId: 'm-2', chosen: false, neededBy: ['tdd'] }]);
  assert.equal(keptWords(entries[0].keptFor, 'rules', () => undefined, entries[0].chosen), 'Kept; you also chose it yourself');
  assert.equal(keptWords(entries[1].keptFor, 'rules', () => undefined, entries[1].chosen) ?? stillNeededWords(entries[1].neededBy), 'Kept; still needed by tdd');
});

// A read of the installed list that was still out when the person opened a Remove or Update preview must not redraw the
// rows (dropping the preview and its Confirm); the list is read again once the preview closes.
async function heldReadPanel({ updateState = 'current', hold = 2 } = {}) {
  const { createInstalledPanel } = await import('../../src/app/installed-panel.js');
  const live = (tag, className = '', text) => {
    const node = fake(tag, className, text); const handlers = [];
    node.addEventListener = (type, handler) => { if (type === 'click') handlers.push(handler); };
    node.click = async () => { for (const handler of handlers) await handler(); };
    return node;
  };
  const button = (label, action) => { const node = live('button', '', label); node.addEventListener('click', action); return node; };
  const selection = { managementId: 'm-1', scope: 'project', name: 'One', item: { framework: 'ecc', itemId: 'one' }, origins: [{ reasonIncluded: 'chosen' }],
    installState: 'complete', updateState, members: [{ kind: 'file', path: '/project/one.md', fileState: 'matches' }] };
  const inventory = { status: 'complete', selections: [selection] };
  let reads = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const client = {
    catalog: { executionAvailable: true, items: [{ id: 'one', root: { releaseSha256: 'r'.repeat(64), itemId: 'one', configuration: {} } }], frameworks: [] },
    intent: { roots: [] }, bytes: new TextEncoder().encode(JSON.stringify({ mode: 'vibe', selections: [] })), tool: 'claude',
    // The second read is held open until the test releases it; every other read answers at once.
    requestCurrent: async () => { reads += 1; if (reads === hold) { await held; } return inventory; },
    requestHost: async operation => operation === 'remove'
      ? { disposition: 'prepared', diagnostics: [], removals: [{ managementId: 'm-1', disposition: 'prepared', change: 'remove-selection', diagnostics: [],
          members: [{ kind: 'file', path: '/project/one.md', action: 'remove', operationId: 'lifecycle/remove-0' }] }],
        preparation: { status: 'ready', sessionId: 'session-1', review: { reviewDigest: 'digest-1', operations: [] } } }
      : { disposition: 'unavailable', diagnostics: [{ message: 'Update unavailable fixture' }] },
  };
  const panel = createInstalledPanel({ client, el: live, button });
  await panel.refresh();
  const find = text => walk(panel.node).find(node => node.tag === 'button' && node.textContent === text);
  return { panel, find, release: () => release(), reads: () => reads };
}

test('a read still out when Remove opens its preview leaves the preview and its Confirm, and the list is read again after Cancel', async () => {
  const { panel, find, release, reads } = await heldReadPanel();
  const pending = panel.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads(), 2, 'the second read is out');
  await find('Remove').click();
  assert.ok(find('Confirm remove'), 'the preview is open');
  release(); await pending;
  assert.ok(find('Confirm remove'), 'the read that finished after the preview opened did not redraw the rows');
  assert.equal(reads(), 2);
  await find('Cancel').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads(), 3, 'the deferred read is made once the preview closes');
  assert.equal(find('Confirm remove'), undefined);
});

test('a read still out when Update opens its preview leaves the preview, and the list is read again after Cancel', async t => {
  // The "Update available" chip draws its icon through the shared DOM helper.
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => fake(tag) };
  t.after(() => { globalThis.document = previous; });
  const { panel, find, release, reads } = await heldReadPanel({ updateState: 'update-available' });
  const pending = panel.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await find('Update').click();
  assert.ok(find('Confirm update'), 'the update preview is open');
  release(); await pending;
  assert.ok(find('Confirm update'), 'the read that finished after the preview opened did not redraw the rows');
  assert.equal(reads(), 2);
  await find('Cancel').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads(), 3, 'the deferred read is made once the preview closes');
});

test('a read asked for while a preview is open waits for it, and clear() forgets the preview and the deferred read', async () => {
  const { panel, find, reads } = await heldReadPanel({ hold: 0 });
  await find('Remove').click();
  await panel.refresh();
  assert.equal(reads(), 1, 'no read while the preview is open');
  assert.ok(find('Confirm remove'));
  panel.clear();
  await panel.refresh();
  assert.equal(reads(), 2, 'after clear() the next read runs at once');
});

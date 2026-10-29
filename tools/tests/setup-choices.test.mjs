import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceLines, createSetupChoices } from '../../src/app/setup-choices.js';

// Your choices: one line per chosen item, with the items it needs folded under it. The needed-by relation is
// setupNeeds' (what Catalog resolved).
const REL = 'r'.repeat(64);
const ref = itemId => ({ releaseSha256: REL, itemId, scope: 'project' });
const item = (id, label, kind = 'skill') => ({ id, label, kind, root: { releaseSha256: REL } });
const items = [item('grill-me', 'grill-me'), item('grilling', 'grilling'), item('notices', 'Extensions licenses and notices', 'instruction'),
  item('tdd', 'tdd'), item('git-guard', 'git-guard', 'hook'), item('git-guard.scripts', 'hooks/hooks.json', 'hook')];
const key = value => `${REL}/${value}`;

test('each chosen item is one line with the items it needs folded under it, by name', () => {
  const roots = [ref('grill-me'), ref('tdd'), ref('git-guard')];
  const needs = new Map([[key('grilling'), [roots[0]]], [key('notices'), [roots[0], roots[1]]], [key('git-guard.scripts'), [roots[2]]]]);
  const lines = choiceLines({ roots, needs, items });
  assert.deepEqual(lines.map(line => [line.name, line.needed.map(entry => entry.name)]), [
    ['grill-me', ['grilling', 'Extensions licenses and notices']],
    ['tdd', ['Extensions licenses and notices']],
    ['git-guard', ['hooks/hooks.json']]]);
  assert.equal(lines[0].root, roots[0]);
});

test('a chosen item that another chosen item needs keeps its own line and is not folded twice', () => {
  const roots = [ref('grill-me'), ref('grilling')];
  const lines = choiceLines({ roots, needs: new Map([[key('grilling'), [roots[0]]]]), items });
  assert.deepEqual(lines.map(line => [line.name, line.needed.length]), [['grill-me', 0], ['grilling', 0]]);
});

test('an item the installed Catalog no longer lists is named by its id, never left blank', () => {
  const roots = [ref('gone.item')];
  const lines = choiceLines({ roots, needs: new Map([[key('other.gone'), [roots[0]]]]), items });
  assert.deepEqual(lines.map(line => [line.name, line.needed.map(entry => entry.name)]), [['gone.item', ['other.gone']]]);
});

test('Q7-R: chosen rows group under recorded exact set identities, with simultaneous membership and explicit individuals', async () => {
  const SHA = 's'.repeat(64);
  const originSet = `set-${REL.slice(0, 16)}-starter`;
  const roots = [
    { ...ref('grill-me'), originIds: [originSet] },
    { ...ref('tdd'), originIds: [originSet, 'direct'] },
    { ...ref('git-guard'), originIds: ['direct'] },
  ];
  const intent = { roots, pins: [], provenance: [{ releaseSha256: REL,
    materialSource: { workbenchSetChoices: { choices: [{ originId: originSet, request: { setId: 'starter', setSha256: SHA, release: { releaseSha256: REL } } }] } } }] };
  const client = { intent, catalog: { items }, bytes: [] };
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const view = createSetupChoices({ client, el: fake, button });
  view.render();
  const groups = new Map(walk(view.node).filter(node => node.dataset.choiceGroup).map(group => [group.dataset.choiceGroup, group]));
  const starter = groups.get(`${REL}/starter/${SHA}`);
  assert.ok(starter, 'the group key is the exact recorded set identity');
  const heading = walk(starter).find(node => node.dataset.choiceSet);
  assert.match(heading.textContent, /starter/);
  assert.equal(heading.title, `${REL}/starter/${SHA}`, 'the heading identity is fully qualified');
  const members = walk(starter).filter(node => node.dataset.choiceItem).map(node => node.dataset.choiceItem).sort();
  assert.deepEqual(members, ['grill-me', 'tdd'], 'named rows belong to the correct set');
  const individual = groups.get('individual');
  assert.deepEqual(walk(individual).filter(node => node.dataset.choiceItem).map(node => node.dataset.choiceItem), ['git-guard'], 'no-origin rows stay explicit');
  assert.equal(walk(view.node).filter(node => node.dataset.choiceItem === 'tdd').length, 1, 'a simultaneous member renders once');
  // Removal actually works through the grouped row: invoke the real callback.
  const removed = [];
  const removingClient = { intent, catalog: { items }, bytes: [], onRemove: (root, name) => removed.push([root.itemId, name]) };
  const view2 = createSetupChoices({ client: removingClient, el: fake, button, onRemove: async (root, name) => removingClient.onRemove(root, name) });
  view2.render();
  const group2 = new Map(walk(view2.node).filter(node => node.dataset.choiceGroup).map(group => [group.dataset.choiceGroup, group]));
  const remove = walk(group2.get(`${REL}/starter/${SHA}`)).filter(node => node.dataset.choiceItem === 'tdd').flatMap(node => walk(node)).find(node => node.tag === 'button');
  await remove.click();
  assert.deepEqual(removed, [['tdd', 'tdd']], 'the grouped row\'s removal invokes the real onRemove callback');
});

test('Q7-R: one chosen item in TWO actual sets, and left-out items grouped under their authoring sets', () => {
  const SHA1 = '1'.repeat(64), SHA2 = '2'.repeat(64);
  const originA = `set-${REL.slice(0, 16)}-alpha`, originB = `set-${REL.slice(0, 16)}-beta`;
  // tdd is chosen by BOTH recorded sets - the simultaneous two-set proof.
  const roots = [
    { ...ref('grill-me'), originIds: [originA] },
    { ...ref('tdd'), originIds: [originA, originB] },
    { ...ref('git-guard'), originIds: [] },
  ];
  const origins = [{ id: 'direct', kind: 'direct' }, { id: originA, kind: 'direct' }, { id: originB, kind: 'direct' }];
  const intent = { roots, pins: [], origins,
    exclusions: [
      { originId: originA, releaseSha256: REL, itemId: 'notices', scope: 'project', reason: 'alpha left it out' },
      { originId: originB, releaseSha256: REL, itemId: 'grilling', scope: 'project' },
      { originId: 'direct', releaseSha256: REL, itemId: 'git-guard.scripts', scope: 'project', reason: 'left out by me' },
    ],
    provenance: [{ releaseSha256: REL, materialSource: { workbenchSetChoices: { choices: [
      { originId: originA, request: { setId: 'alpha', setSha256: SHA1, release: { releaseSha256: REL }, members: [
        { item: { framework: 'other-framework', itemId: 'grilling' }, include: false },
        { item: { framework: 'ecc', itemId: 'grill-me' }, include: true },
      ] } },
      { originId: originB, request: { setId: 'beta', setSha256: SHA2, release: { releaseSha256: REL } } },
    ] } } }] };
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const view = createSetupChoices({ client: { intent, catalog: { items, frameworks: [{ id: 'ecc', sha256: REL }] }, bytes: [] }, el: fake, button });
  view.render();
  const groups = new Map(walk(view.node).filter(node => node.dataset.choiceGroup).map(group => [group.dataset.choiceGroup, group]));
  assert.ok(groups.get(`${REL}/alpha/${SHA1}`), 'first set group by full identity');
  // beta has no chosen rows of its own (tdd renders once in alpha with an Also-in note); its group shows in left-out.
  // The one item in two actual sets: chosen membership appears under BOTH sets, rendered once overall.
  assert.deepEqual(walk(groups.get(`${REL}/alpha/${SHA1}`)).filter(node => node.dataset.choiceItem).map(node => node.dataset.choiceItem).sort(), ['grill-me', 'tdd']);
  assert.equal(walk(view.node).filter(node => node.dataset.choiceItem === 'tdd').length, 1, 'the simultaneous member renders exactly once (no duplicated Remove)');
  const tddRow = walk(view.node).find(node => node.dataset.choiceItem === 'tdd');
  const note = walk(tddRow).find(node => /Also in:/.test(node.textContent));
  assert.ok(note && /beta · /.test(note.textContent), 'the further membership keeps its exact identity (Q7-R2)');
  const betaChosen = groups.get(`${REL}/beta/${SHA2}`);
  assert.ok(betaChosen, 'the secondary set group stays visible (Q7-R2)');
  const reference = walk(betaChosen).find(node => node.dataset.setReference === 'tdd');
  assert.ok(reference, 'the secondary group keeps a named read-only reference to the shared member');
  assert.deepEqual(walk(groups.get('individual')).filter(node => node.dataset.choiceItem).map(node => node.dataset.choiceItem), ['git-guard']);
  // Left-out items group under the exact set that authored them; direct stays explicit.
  const leftGroups = new Map(walk(view.node).filter(node => node.dataset.leftOut).map(group => [group.dataset.leftOut, group]));
  const alphaLeft = leftGroups.get(`${REL}/alpha/${SHA1}`);
  assert.ok(alphaLeft, 'set-owned left-out group by full identity');
  const alphaRow = walk(alphaLeft).find(node => node.dataset.leftOutItem === 'notices');
  assert.match(alphaRow.textContent, /Extensions licenses and notices — alpha left it out/, 'named left-out item under its authoring set with its reason');
  const betaLeft = leftGroups.get(`${REL}/beta/${SHA2}`);
  const betaRow = walk(betaLeft).find(node => node.dataset.leftOutItem === 'grilling');
  assert.match(betaRow.textContent, /grilling — recorded left-out choice/, 'no fabricated reason when none is recorded');
  const directLeft = leftGroups.get('known:direct');
  assert.match(walk(directLeft).find(node => node.dataset.leftOutItem === 'git-guard.scripts').textContent, /left out by me/, 'a direct exclusion is recorded provenance in its own explicit group (AF3)');
  assert.match(walk(directLeft).find(node => node.dataset.leftOutSet).textContent, /recorded choice/);
  // A member left out of its set is retained only in the saved set request (include:false) - it renders
  // under that set's exact identity, keeping the member's own framework, with a truthful neutral reason.
  const falseMember = walk(alphaLeft).find(node => node.dataset.leftOutItem === 'grilling');
  assert.ok(falseMember, 'the false set member has a named left-out row under its set');
  assert.match(falseMember.textContent, /other-framework\/grilling \[other-framework\] — left out of set alpha/, 'exact member identity and truthful reason, no fabricated origin or release');
  // Live draft: the same render reads the draft's live intent, not the saved base.
  const draft = { intent };
  const draftView = createSetupChoices({ client: { draft, intent: { roots: [], pins: [] }, catalog: { items, frameworks: [{ id: 'ecc', sha256: REL }] }, bytes: [] }, el: fake, button });
  draftView.render();
  const draftLeft = new Map(walk(draftView.node).filter(node => node.dataset.leftOut).map(group => [group.dataset.leftOut, group]));
  assert.ok(draftLeft.get(`${REL}/beta/${SHA2}`), 'draft live intent drives the same grouped left-out render');
});

test('Q7-R: a known non-set origin (template) is recorded provenance, never "no longer recorded" (AF3)', () => {
  const intent = { roots: [], pins: [], origins: [{ id: 'direct', kind: 'direct' }, { id: 'tpl-1', kind: 'template' }],
    exclusions: [{ originId: 'tpl-1', releaseSha256: REL, itemId: 'notices', scope: 'project', reason: 'template default left out' }],
    provenance: [] };
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const view = createSetupChoices({ client: { intent, catalog: { items }, bytes: [] }, el: fake, button });
  view.render();
  const known = walk(view.node).find(node => node.dataset.leftOut === 'known:tpl-1');
  assert.ok(known, 'the valid recorded non-set origin renders in its own group');
  assert.match(walk(known).find(node => node.dataset.choiceSet ?? node.textContent).textContent ?? '', /recorded choice \(template\)/);
  assert.match(walk(known).find(node => node.dataset.leftOutItem === 'notices').textContent, /template default left out/);
  assert.ok(!walk(view.node).some(node => /origin no longer recorded/.test(node.textContent ?? '')), 'recorded provenance is never described as lost');
});

// A small DOM: enough for the section to build its rows.
function fake(tag, className = '', text) {
  // DOM-faithful: parentElement is a READ-ONLY getter (assignment in module code must throw, as on a real
  // DOM node); append owns the child.
  let parent = null;
  const node = { tag, className, textContent: text ?? '', children: [], dataset: {}, attributes: {}, hidden: false,
    get parentElement() { return parent; },
    append(...children) { for (const child of children) if (child && typeof child === 'object') { this.children.push(child); parent = this; } },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
    listeners: {},
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); },
    click() { return Promise.all((this.listeners.click ?? []).map(fn => fn())); } };
  return node;
}
const walk = (node, out = []) => { out.push(node); for (const child of node.children) walk(child, out); return out; };

test('Your choices shows one row per chosen item with Remove from setup, which is unavailable while a change waits', async () => {
  const roots = [ref('grill-me'), ref('tdd')];
  const client = { intent: { roots, pins: [] }, catalog: { items }, bytes: [] };
  const removed = [];
  const button = (label, action) => { const node = fake('button', 'px-3 py-1.5 rounded', label); node.addEventListener('click', action); return node; };
  const view = createSetupChoices({ client, el: fake, button, onRemove: async (root, name) => { removed.push([root.itemId, name]); } });
  view.render();
  assert.equal(walk(view.node).find(node => node.id === 'setup-choices-title').textContent, 'Your choices (2)');
  const rows = walk(view.node).filter(node => node.dataset.choiceItem);
  assert.deepEqual(rows.map(row => row.dataset.choiceItem), ['grill-me', 'tdd']);
  const remove = walk(rows[1]).find(node => node.tag === 'button');
  assert.equal(remove.attributes['aria-label'], 'Remove tdd from setup');
  assert.match(remove.className, /px-2 py-0\.5/);
  await remove.click();
  assert.deepEqual(removed, [['tdd', 'tdd']]);
  client.candidate = { intent: { roots: [] } }; view.render();
  assert.equal(walk(view.node).filter(node => node.tag === 'button').every(node => node.disabled), true);
  client.intent = { roots: [], pins: [] }; client.candidate = undefined; view.render();
  assert.equal(walk(view.node).find(node => node.id === 'setup-choices-empty').hidden, false);
});

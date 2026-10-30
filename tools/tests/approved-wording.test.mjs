// Sentences the owner approved on 2026-10-30 as contract amendment 3.2.3. Each one the page shows carries its row
// marker on one of the three lines before it, and says the amendment's words exactly: `{name}`-style placeholders are
// filled with sample names and the page's sentence compared whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installOutcome, firstRunWords } from '../../src/app/install-panel.js';
import { keptWords, setLabeller, setRemovalEntries, stillNeededWords } from '../../src/app/installed-list.js';
import { stateWords } from '../../src/app/installed-panel.js';
import { confirmRemoval, previewRemoval, removalMemberWords } from '../../src/app/installed-removal.js';
import { confirmUpdate, previewUpdate } from '../../src/app/installed-update.js';
import { replacedNames } from '../../src/catalog/item-name.js';

const APPROVED = '(owner-approved 2026-10-30)';
// Rows the page shows that the owner has not approved yet; each says the proposed sentence and carries PENDING.
const PENDING = '(pending owner approval)', PENDING_ROWS = new Set([37, 38]);
const fill = (sentence, values) => sentence.replace(/\{([^}]+)\}/g, (_, key) => {
  assert.ok(Object.hasOwn(values, key), `a sample value for {${key}}`); return values[key];
});

// Removal and Update outcomes, run through the page's own code.
const removed = { name: 'grill-me', managementId: 'm-1', scope: 'project' };
const removalOf = async (run, entry = removed, removal = { change: 'remove-selection', members: [{ kind: 'file', path: '/project/0.md', action: 'remove' }] }) => {
  const request = async operation => operation === 'remove' ? { disposition: 'prepared', diagnostics: [],
    removals: [{ managementId: 'm-1', disposition: 'prepared', diagnostics: [], ...removal }],
    preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd', operations: [] } } } : run;
  return confirmRemoval({ preview: await previewRemoval({ entries: [entry], request, mode: 'vibe' }), request, mode: 'vibe' });
};
// "Remove this set" on a member another owner keeps: Core releases only this set's origin.
const keptMember = { ...removed, origin: { set: { framework: 'ecc', setId: 'ecc.rules', setSha256: 'b'.repeat(64) } }, kept: 'Kept; also part of plain' };
const originOnly = { change: 'remove-origin', origin: keptMember.origin, members: [{ kind: 'file', path: '/project/0.md', action: 'keep-shared', reason: 'another-origin' }] };
// One installed-list chip's words for one Core state.
const chip = state => { const words = stateWords(state); assert.equal(words.length, 1, `one chip for ${JSON.stringify(state)}`); return words[0]; };
const refusal = async (reason, values) => (await previewUpdate({ entries: [{ name: values.item, managementId: 'm-1', scope: 'project', replacement: {} }],
  tool: 'claude-code', nameOf: () => values.name,
  request: async () => ({ disposition: 'invalid', diagnostics: [{ reason, managementId: 'm-1', item: { framework: 'f', itemId: 'f.x' }, message: 'not shown' }] }) })).message;
const between = (message, before, after) => (assert.ok(message.startsWith(before) && message.endsWith(after), message), message.slice(before.length, -after.length));
const blocked = message => between(message, 'Update cannot go ahead: ', '. Nothing was updated.');
const unknown = { status: 'unknown', diagnostics: [{ message: 'Lost.' }] };
const set = { framework: 'ecc', setId: 'ecc.rules', setSha256: 'a'.repeat(64) };
const frameworks = [{ id: 'ecc', sets: [{ id: 'ecc.rules', name: 'rules', setSha256: 'b'.repeat(64) }, { id: 'ecc.plain', name: 'plain', setSha256: 'c'.repeat(64) }] }];

// [row, file, the amendment's sentence, then where the page builds it: sample values, the page's sentence for them and
// the source words its marker sits by, when not the sentence's first fixed words]
const ROWS = [
  // Inventory 1.1 carries no replacement names and no reason an item is no longer offered or was revoked.
  [1, 'src/app/installed-panel.js', 'Replaced in the release index; still installed', {}, () => chip({ update: 'superseded' })],
  [2, 'src/app/installed-panel.js', 'No longer offered; still installed', {}, () => chip({ update: 'no-longer-offered' })],
  [3, 'src/app/installed-panel.js', 'Withdrawn from the release index; still installed', {}, () => chip({ update: 'revoked' })],
  [4, 'src/app/installed-panel.js', 'Some of its files are missing', {}, () => chip({ file: 'missing' })],
  [5, 'src/app/installed-panel.js', 'A block AIH added was changed', {}, () => chip({ file: 'block-changed' })],
  [5, 'src/app/installed-panel.js', 'A block AIH added is missing', {}, () => chip({ file: 'block-missing' })],
  [6, 'src/app/installed-panel.js', 'Policy not checked', {}, () => chip({ policy: 'unknown' })],
  [8, 'src/app/installed-list.js', 'Kept; you also chose it yourself', {}, () => {
    const [entry] = setRemovalEntries({ set, members: [{ managementId: 'm-1', scope: 'project', name: 'tdd', alsoIn: [{ reasonIncluded: 'chosen' }] }], needs: [] });
    return keptWords(entry.keptFor, 'rules', setLabeller(frameworks), entry.chosen);
  }],
  [10, 'src/app/installed-list.js', 'Kept; still needed by {names}', { names: 'tdd and README' }, () => stillNeededWords(['tdd', 'README'])],
  // Core's keep-required is a licence or notice file kept with an item that keeps a changed member; it never names a
  // requirement, so the inventory's requirers (passed here) must not appear.
  [37, 'src/app/installed-removal.js', "Kept: the item's licence or notice", {},
    () => removalMemberWords({ kind: 'file', path: '/project/LICENSE', action: 'keep-required', reason: 'licence-or-notice' }, { ...removed, requiredBy: [{ managementId: 'm-2', name: 'tdd' }] })],
  [38, 'src/app/installed-removal.js', 'Kept for another selection', {},
    () => removalMemberWords({ kind: 'file', path: '/project/0.md', action: 'keep-shared', reason: 'another-selection' }, removed)],
  // A member Remove this set releases from this set while nothing the page can name keeps it.
  [38, 'src/app/installed-removal.js', 'Kept for another selection', {},
    async () => (await previewRemoval({ entries: [{ ...keptMember, kept: undefined }], mode: 'vibe', request: async () => ({ disposition: 'prepared', diagnostics: [],
      removals: [{ managementId: 'm-1', disposition: 'prepared', diagnostics: [], ...originOnly }], preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd', operations: [] } } }) })).steps[0].message],
  [11, 'src/app/installed-removal.js', 'Kept; you changed it after install', {},
    () => removalMemberWords({ kind: 'file', path: '/project/0.md', action: 'keep-changed', reason: 'managed-content-changed' }, removed)],
  [14, 'src/app/installed-removal.js', "Couldn't confirm it's kept.", {},
    async () => between((await removalOf({ completion: 'partial', diagnostics: [], members: [] }, keptMember, originOnly)).message, 'grill-me: ', '.') + '.', ": Couldn't confirm it's kept."],
  [9, 'src/app/installed-list.js', 'Kept; also part of {set1} and {set2}', { set1: 'rules', set2: 'plain' },
    () => keptWords([{ framework: 'ecc', setId: 'ecc.rules', setSha256: 'b'.repeat(64) }, { framework: 'ecc', setId: 'ecc.plain', setSha256: 'c'.repeat(64) }], 'other', setLabeller(frameworks))],
  [12, 'src/app/installed-removal.js', '{name}: removed', { name: 'grill-me' },
    async () => (await removalOf({ completion: 'complete', diagnostics: [], members: [{ managementId: 'm-1', path: '/project/0.md', outcome: 'removed', check: 'absent' }] })).message],
  [13, 'src/app/installed-removal.js', '{name}: put back the way it was before install', { name: 'grill-me' },
    async () => (await removalOf({ completion: 'complete', diagnostics: [], members: [{ managementId: 'm-1', path: '/project/0.md', outcome: 'restored', check: 'present-matching' }] })).message, "'put back the way it was before install'"],
  [17, 'src/app/authoring-workspace.js', "'Package'"],
  [17, 'src/app/authoring-workspace.js', "'Version'"],
  [17, 'src/app/authoring-workspace.js', "'Archive digest'"],
  [18, 'src/app/authoring-client.js', "These choices were made outside your organisation's policy. Start a new Enterprise setup to install them under it."],
  [18, 'src/app/authoring-workspace.js', "'Start a new Enterprise setup'"],
  [19, 'src/app/install-panel.js', 'Install is still running in this project folder.'],
  [19, 'src/app/installed-panel.js', 'Install is still running in this project folder.'],
  [20, 'src/app/installed-panel.js', 'What is installed shows here once it has finished.'],
  [21, 'src/app/authoring-client.js', 'This page lost contact with the Workbench while it was running.'],
  [22, 'tools/consumer/server.mjs', 'This Workbench no longer holds that result.'],
  [23, 'src/app/install-panel.js', 'Install outcome unknown: {detail}', { detail: 'Lost.' }, () => installOutcome(unknown).message],
  [24, 'src/app/installed-removal.js', 'Removal outcome unknown: {detail}', { detail: 'Lost.' }, async () => (await removalOf(unknown)).message],
  [25, 'src/app/installed-update.js', 'Update outcome unknown: {detail}', { detail: 'Lost.' },
    async () => (await confirmUpdate({ preview: { canConfirm: true, entries: [{ name: 'x', managementId: 'm-1', scope: 'project', replacement: {} }], steps: [{ members: [] }], scope: 'project', sessionId: 's', review: { reviewDigest: 'd' } },
      request: async () => unknown })).message],
  [26, 'src/app/installed-update.js', '{item} needs {name}, which is not installed', { item: 'tdd', name: 'README' },
    async () => blocked(await refusal('requirement-not-installed', { item: 'tdd', name: 'README' }))],
  [27, 'src/app/installed-update.js', '{item} now needs {name}, which it did not need when it was installed', { item: 'tdd', name: 'README' },
    async () => blocked(await refusal('requirement-not-recorded', { item: 'tdd', name: 'README' }))],
  [28, 'src/app/installed-update.js', '{item} has no record of how this Workbench installed it, so its update cannot be checked', { item: 'tdd' },
    async () => blocked(await refusal('install-not-recorded', { item: 'tdd' }))],
  [29, 'src/app/installed-update.js', 'This Workbench cannot read its record of what it installed in this folder, so no update can be checked', {},
    async () => blocked(await refusal('record-unavailable', {}))],
  [30, 'tools/consumer/host.mjs', 'Installed, but this Workbench could not record it, so it cannot be updated from here.'],
  [31, 'src/app/installed-update.js', "Update is not available in an Enterprise setup, because Core cannot yet check an update against the organization's rules", {},
    async () => blocked(await refusal('enterprise-update-unavailable', {})), 'Update is not available in an Enterprise setup'],
  [32, 'src/app/installed-list.js', '{set name} (earlier release)', { 'set name': 'rules' }, () => setLabeller(frameworks)(set)],
  [33, 'src/app/installed-list.js', 'Kept; also part of a set this catalog no longer offers'],
  [34, 'src/app/installed-list.js', 'Kept; also part of another release of this set'],
  // "N earlier item(s)": one earlier item, or N earlier items.
  [35, 'src/catalog/item-name.js', '{N} earlier item', { N: '1' }, () => replacedNames([{ itemId: 'gone' }]).join()],
  [35, 'src/catalog/item-name.js', '{N} earlier items', { N: '2' }, () => replacedNames([{ itemId: 'gone' }, { itemId: 'went' }]).join(), ' earlier item'],
  [36, 'src/app/install-panel.js', 'First step: {name} ({kind}) — the step its set {set} declares to run first. It does not run by itself.',
    { name: 'Set up ECC', kind: 'skill', set: 'plain' },
    () => firstRunWords([{ set: { framework: 'ecc', setId: 'ecc.plain', setSha256: 'c'.repeat(64) }, firstRun: { name: 'Set up ECC', kind: 'skill' } }], frameworks)],
];

const markedRows = (lines, at) => [...lines.slice(Math.max(0, at - 3), at + 1).join('\n')
  .matchAll(/Contract amendment 3\.2\.3 rows? (\d+(?:(?:, | and )\d+)*) \((?:owner-approved 2026-10-30|pending owner approval)\)/g)].flatMap(marker => marker[1].match(/\d+/g).map(Number));

for (const [row, file, sentence, values, page, words] of ROWS) test(`row ${row}: "${sentence}" is the ${PENDING_ROWS.has(row) ? 'proposed' : 'approved'} wording in ${file}`, async () => {
  if (page) assert.equal(await page(), fill(sentence, values), 'the page says the amendment\'s sentence');
  // Where the page builds the sentence, its marker sits by the sentence's first fixed words.
  const anchor = words ?? (page ? sentence.split('{')[0] || sentence.split('}').at(-1).split('{')[0] : sentence);
  const lines = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n');
  const at = lines.findIndex(line => line.includes(anchor));
  assert.ok(at >= 0, `${file} says "${anchor}"`);
  assert.ok(markedRows(lines, at).includes(row), `marked as approved row ${row}`);
});

test('a compliant, current, matching installed item shows no state, and no chip says a Core code', () => {
  for (const policy of ['required', 'recommended', 'permitted', 'non-compliant', null, undefined])
    assert.deepEqual(stateWords({ file: 'matches', update: 'current', policy, approval: 'not-needed', install: 'complete' }), [], `policy ${policy}`);
  const codes = ['superseded', 'no-longer-offered', 'revoked', 'missing', 'block-changed', 'block-missing', 'unknown', 'changed', 'unchecked'];
  for (const state of [{ update: 'superseded' }, { update: 'no-longer-offered' }, { update: 'revoked' }, { file: 'missing' }, { file: 'block-changed' }, { file: 'block-missing' },
    { policy: 'unknown' }, { files: ['missing', 'block-changed', 'block-missing', 'changed'] }])
    for (const words of stateWords(state)) assert.ok(!codes.includes(words) && /^[A-Z]/.test(words), `${JSON.stringify(state)} says "${words}"`);
  // Core's inventory policy refusals say the contract's policy sentence.
  for (const policy of ['prohibited', 'not-admitted']) assert.deepEqual(stateWords({ policy }), ['Doesn’t meet your organisation’s policy'], policy);
  // Row 5 keeps naming the file when Core gives its path.
  assert.deepEqual(stateWords({ file: 'block-changed', blockFiles: ['/p/CLAUDE.md'] }), ['The AIH block in CLAUDE.md was edited']);
});

test('row 15: no installed state chip carries a tooltip', () => {
  const source = readFileSync(new URL('../../src/app/installed-panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Core \$\{field\}|attachTooltip\(chip/, 'no "Core fileState: …" tooltip on a chip');
});

test('row 8 only when no set keeps the member; row 9 wins when one does', () => {
  const label = setLabeller(frameworks);
  assert.equal(keptWords([{ framework: 'ecc', setId: 'ecc.plain', setSha256: 'c'.repeat(64) }], 'rules', label, true), 'Kept; also part of plain');
  assert.equal(keptWords([], 'rules', label, false), undefined, 'kept only by a requirement: no row 8');
});

test("row 14 only for a kept member Core did not confirm; a confirmed one says the kept sentence", async () => {
  assert.equal((await removalOf({ completion: 'complete', diagnostics: [], members: [] }, keptMember, originOnly)).message, 'grill-me: Kept; also part of plain');
  assert.equal((await removalOf({ completion: 'partial', diagnostics: [{ message: 'Lost.' }], members: [] }, keptMember, originOnly)).message, "grill-me: Couldn't confirm it's kept. Lost.");
});

// Core's removal 1.2.0 member actions and the reasons it gives them (aih-core README, removal preparation).
const ACTIONS = ['remove', 'restore', 'unregister', 'keep-shared', 'keep-changed', 'keep-required'];
const REASONS = [undefined, 'pre-existing-value', 'already-absent', 'another-selection', 'another-origin', 'managed-content-changed', 'licence-or-notice', 'hook-group-changed'];
const CODES = [...ACTIONS, ...REASONS.filter(Boolean)];
test('no Core removal 1.2.0 member action or reason reaches the page as text', async () => {
  const said = [];
  for (const action of ACTIONS) for (const reason of REASONS) {
    const member = { kind: 'file', path: '/project/0.md', action, ...(reason ? { reason } : {}), operationId: null };
    for (const entry of [removed, { ...removed, kept: undefined }, keptMember]) if (action.startsWith('keep-')) said.push(removalMemberWords(member, entry));
    // Remove of one item and Remove this set: the preview's step messages and kept lines, then the outcome.
    for (const [entry, change] of [[removed, 'remove-selection'], [keptMember, 'remove-origin'], [{ ...keptMember, kept: undefined }, 'remove-origin']]) {
      const removal = { change, ...(change === 'remove-origin' ? { origin: keptMember.origin } : {}), members: [member] };
      const request = async operation => operation === 'remove' ? { disposition: 'prepared', diagnostics: [], removals: [{ managementId: 'm-1', disposition: 'prepared', diagnostics: [], ...removal }],
        preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd', operations: [] } } }
        : { completion: 'complete', diagnostics: [], members: [{ managementId: 'm-1', path: '/project/0.md', outcome: action.startsWith('keep-') ? 'kept' : 'removed', check: 'absent' }] };
      const preview = await previewRemoval({ entries: [entry], request, mode: 'vibe' });
      said.push(...preview.steps.map(step => step.message), ...preview.kept.map(item => item.reason));
      said.push((await confirmRemoval({ preview, request, mode: 'vibe' })).message);
    }
  }
  for (const words of said) {
    assert.equal(typeof words, 'string', 'every kept member has words');
    for (const code of CODES) assert.doesNotMatch(words, new RegExp(`(^|[^\\w-])${code}($|[^\\w-])`), `"${words}" says Core's ${code}`);
  }
});

const sources = dir => readdirSync(new URL(`../../${dir}/`, import.meta.url), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.m?js$/.test(entry.name)).map(entry => `${entry.parentPath ?? entry.path}/${entry.name}`);
test('every amendment 3.2.3 row named in the source is marked approved, and none is left pending', () => {
  const named = new Set();
  for (const path of [...sources('src'), ...sources('tools')]) {
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('/approved-wording.test.mjs')) continue;
    for (const [, rows, after] of text.matchAll(/amendment 3\.2\.3 (rows? \d+(?:(?:, | and )\d+)*)(.{0,40})/gs)) {
      const numbers = rows.match(/\d+/g).map(Number), pending = numbers.every(row => PENDING_ROWS.has(row));
      const marker = pending ? PENDING : APPROVED;
      assert.ok(after.replace(/\s*\/\/\s*/g, ' ').startsWith(` ${marker}`), `${path}: amendment 3.2.3 ${rows} carries "${marker}"`);
      for (const row of numbers) { assert.ok((row >= 1 && row <= 36) || PENDING_ROWS.has(row), `${path}: row ${row} is in the amendment or pending`); named.add(row); }
    }
    // "pending owner approval" appears only on a pending row's marker.
    assert.equal((text.match(/pending owner approval/gi) ?? []).length, [...text.matchAll(/amendment 3\.2\.3 rows? \d+(?:(?:, | and )\d+)* \(pending owner approval\)/g)].length, path);
  }
  const checked = new Set(ROWS.map(([row]) => row));
  assert.deepEqual([...named].filter(row => !checked.has(row)), [], 'every row named in the source has its wording checked here');
});

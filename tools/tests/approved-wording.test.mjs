// Sentences the owner approved on 2026-10-30 as contract amendment 3.2.3. Each one the page shows carries its row
// marker on one of the three lines before it, and says the amendment's words exactly: `{name}`-style placeholders are
// filled with sample names and the page's sentence compared whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installOutcome, firstRunWords } from '../../src/app/install-panel.js';
import { keptWords, setLabeller } from '../../src/app/installed-list.js';
import { confirmRemoval, previewRemoval } from '../../src/app/installed-removal.js';
import { confirmUpdate, previewUpdate } from '../../src/app/installed-update.js';
import { replacedNames } from '../../src/catalog/item-name.js';

const APPROVED = '(owner-approved 2026-10-30)';
const fill = (sentence, values) => sentence.replace(/\{([^}]+)\}/g, (_, key) => {
  assert.ok(Object.hasOwn(values, key), `a sample value for {${key}}`); return values[key];
});

// Removal and Update outcomes, run through the page's own code.
const removed = { name: 'grill-me', managementId: 'm-1', scope: 'project' };
const removalOf = async run => {
  const request = async operation => operation === 'remove' ? { disposition: 'prepared', diagnostics: [],
    removals: [{ managementId: 'm-1', disposition: 'prepared', change: 'remove-selection', diagnostics: [], members: [{ kind: 'file', path: '/project/0.md', action: 'remove' }] }],
    preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd', operations: [] } } } : run;
  return confirmRemoval({ preview: await previewRemoval({ entries: [removed], request, mode: 'vibe' }), request, mode: 'vibe' });
};
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
  .matchAll(/Contract amendment 3\.2\.3 rows? (\d+(?:(?:, | and )\d+)*) \(owner-approved 2026-10-30\)/g)].flatMap(marker => marker[1].match(/\d+/g).map(Number));

for (const [row, file, sentence, values, page, words] of ROWS) test(`row ${row}: "${sentence}" is the approved wording in ${file}`, async () => {
  if (page) assert.equal(await page(), fill(sentence, values), 'the page says the amendment\'s sentence');
  // Where the page builds the sentence, its marker sits by the sentence's first fixed words.
  const anchor = words ?? (page ? sentence.split('{')[0] || sentence.split('}').at(-1).split('{')[0] : sentence);
  const lines = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n');
  const at = lines.findIndex(line => line.includes(anchor));
  assert.ok(at >= 0, `${file} says "${anchor}"`);
  assert.ok(markedRows(lines, at).includes(row), `marked as approved row ${row}`);
});

const sources = dir => readdirSync(new URL(`../../${dir}/`, import.meta.url), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.m?js$/.test(entry.name)).map(entry => `${entry.parentPath ?? entry.path}/${entry.name}`);
test('every amendment 3.2.3 row named in the source is marked approved, and none is left pending', () => {
  const named = new Set();
  for (const path of [...sources('src'), ...sources('tools')]) {
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('/approved-wording.test.mjs')) continue;
    assert.doesNotMatch(text, /pending owner approval/i, path);
    for (const [, rows, after] of text.matchAll(/amendment 3\.2\.3 (rows? \d+(?:(?:, | and )\d+)*)(.{0,40})/gs)) {
      assert.ok(after.replace(/\s*\/\/\s*/g, ' ').startsWith(` ${APPROVED}`), `${path}: amendment 3.2.3 ${rows} carries "${APPROVED}"`);
      for (const row of rows.match(/\d+/g).map(Number)) { assert.ok(row >= 1 && row <= 36, `${path}: row ${row} is in the amendment`); named.add(row); }
    }
  }
  const checked = new Set(ROWS.map(([row]) => row));
  assert.deepEqual([...named].filter(row => !checked.has(row)), [], 'every row named in the source has its wording checked here');
});

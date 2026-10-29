import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewRows, groupReviewRows, sizeWords, guidanceFolder } from '../../src/app/review-rows.js';

const set = (setId, setSha256 = 'a'.repeat(64)) => ({ framework: 'ecc', setId, setSha256 });
const operation = (id, over = {}) => ({ id, purpose: `Op ${id}`, kind: 'file.write', scope: 'project', effects: 'create-file',
  ownership: 'managed', requires: [], checks: [], details: {}, ...over });
const review = (over = {}) => ({ schema: 'urn:aihq:core:prepared-work:1.6.0', target: { scope: 'project', project: 'C:\\p' },
  operations: [], selections: [], conflicts: [], omissions: [], ...over });

test('prepared-work 1.6 selections name the rows; operations attach by published selectionId', () => {
  const r = review({
    selections: [
      { selectionId: 's1', managementId: 'm1', scope: 'project', name: 'Grill me', kind: 'skill', framework: 'extensions',
        layout: { support: 'native', observed: 'recognised' }, scanState: { state: 'not-verified', why: 'unchecked' }, coverage: 'matched',
        hookCommands: ['node hook.mjs --exact'],
        origins: [{ reasonIncluded: 'chosen' }, { reasonIncluded: 'in-set', set: set('starter') }, { reasonIncluded: 'required-by', requiredBy: { framework: 'ecc', itemId: 'other' } }],
        inputs: ['tone'], deliveredSize: { bytes: 10, chars: 10, alwaysLoaded: { bytes: 2, chars: 2 } } },
      { selectionId: 's2', managementId: 'm2', scope: 'project' },
    ],
    excluded: [{ item: { framework: 'ecc', itemId: 'ecc.hook.optional' }, reason: 'excluded-in-request' }],
    operations: [operation('op-a', { selectionId: 's1', details: { target: 'C:\\p\\.claude\\x' } }),
      operation('op-b', { selectionId: null }), // generated lifecycle cleanup: no selection, no row
      operation('op-c', { selectionId: 's1', effects: 'conflict', details: { reason: 'Another tool owns this file.' } })],
  });
  const { rows, global, excluded } = reviewRows(r);
  assert.equal(rows.length, 2);
  const first = rows[0];
  assert.equal(first.heading, 'Grill me');
  assert.deepEqual(first.sets.map(s => s.setId), ['starter']);
  assert.deepEqual(first.how, ['Chosen by you', 'Required by other']);
  assert.equal(first.effects.length, 2);
  assert.deepEqual(first.blockers, ['Another tool owns this file.'], 'Core’s reason, verbatim');
  assert.equal(rows[1].heading, 'Selection s2 (its recorded metadata is unavailable)', 'missing name stays explicit');
  assert.equal(rows[1].size, null);
  assert.equal(first.framework, 'extensions');
  assert.deepEqual(first.layout, { support: 'native', observed: 'recognised' });
  assert.deepEqual(first.scanState, { state: 'not-verified', why: 'unchecked' });
  assert.equal(first.coverage, 'matched');
  assert.deepEqual(first.hookCommands, ['node hook.mjs --exact']);
  assert.deepEqual(excluded, [{ item: { framework: 'ecc', itemId: 'ecc.hook.optional' }, reason: 'excluded-in-request' }]);
  assert.deepEqual(global, []);
});

test('prepared review names use the Catalog namespace when Core returns a bare name', () => {
  const r = review({ selections: [{ selectionId: 's1', managementId: 'm1', scope: 'project', name: 'coding-style', item: { framework: 'ecc', itemId: 'ecc.rule.typescript.coding-style' } }] });
  const { rows } = reviewRows(r, { items: [{ id: 'ecc.rule.typescript.coding-style', payload: { namespace: 'typescript' } }] });
  assert.equal(rows[0].heading, 'coding-style (typescript)');
});

test('operationSelections links operations that carry no selectionId; path-linked conflicts join their row verbatim', () => {
  const r = review({
    selections: [{ selectionId: 's1', managementId: 'm1', scope: 'project', name: 'A' }],
    operations: [operation('op-x', { selectionId: null, effects: 'unavailable', details: { reason: 'Material unreadable.', target: 'C:\\p\\x.md' } })],
    conflicts: [{ message: 'Policy conflicts with an installed file.', path: 'C:\\p\\x.md' }, { message: 'A global conflict.' }],
    omissions: [{ code: 'OMITTED', message: 'One material was omitted.' }],
  });
  const linked = reviewRows(r, { operationSelections: [{ selectionId: 's1', operationId: 'op-x' }] });
  assert.deepEqual(linked.rows[0].blockers, ['Material unreadable.', 'Policy conflicts with an installed file.']);
  assert.deepEqual(linked.global, ['A global conflict.', 'One material was omitted.']);
  const unlinked = reviewRows(r, { operationSelections: [] });
  assert.equal(unlinked.rows[0].blockers.length, 0, 'no published linkage, no invented blocker');
  assert.deepEqual(unlinked.global, ['Policy conflicts with an installed file.', 'A global conflict.', 'One material was omitted.']);
});

test('size words: absent is unknown, never zero; with and without always-loaded', () => {
  assert.match(sizeWords(null), /^Size unknown: Core reported no delivered size/);
  assert.match(sizeWords({ bytes: 100, chars: 90 }), /^When used: 100 bytes · 90 chars$/);
  assert.match(sizeWords({ bytes: 100, chars: 90, alwaysLoaded: { bytes: 5, chars: 4 } }), /every session: 5 bytes · 4 chars/);
});

test('Q7-R: groupReviewRows groups named rows under exact set identities, keeping simultaneous membership and individuals', () => {
  const alpha = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
  const beta = { framework: 'ecc', setId: 'beta', setSha256: 'b'.repeat(64) };
  const rows = [
    { selectionId: 's1', heading: 'One', sets: [alpha] },
    { selectionId: 's2', heading: 'Two', sets: [alpha, beta] },
    { selectionId: 's3', heading: 'Three', sets: [] },
  ];
  const { sections, individuals } = groupReviewRows(rows);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].key, `ecc/alpha/${'a'.repeat(64)}`);
  assert.deepEqual(sections[0].rows.map(row => row.selectionId), ['s1', 's2']);
  assert.deepEqual(sections[1].rows.map(row => row.selectionId), ['s2'], 'simultaneous membership appears under every set');
  assert.deepEqual(individuals.map(row => row.selectionId), ['s3'], 'no-set rows stay explicit');
});

test('the guidance folder is a real directory: partially matching segments do not collapse to a character prefix (Q10)', () => {
  const review = { operations: [
    { scope: 'user', details: { target: '/home/u/.claude/settings.json' } },
    { scope: 'user', details: { target: '/home/u/.codex/settings.json' } },
  ] };
  assert.equal(guidanceFolder(review), '/home/u');
});

test('filesystem roots are preserved, never null or a drive-relative prefix (Q10)', () => {
  const posixRoot = { operations: [
    { scope: 'user', details: { target: '/etc/aih/a.json' } },
    { scope: 'user', details: { target: '/etc/aih/b.json' } },
  ] };
  assert.equal(guidanceFolder(posixRoot), '/etc/aih');
  const posixOnlyRoot = { operations: [
    { scope: 'user', details: { target: '/a.json' } },
    { scope: 'user', details: { target: '/b.json' } },
  ] };
  assert.equal(guidanceFolder(posixOnlyRoot), '/', 'the POSIX root is the folder written, never null');
  const driveRoot = { operations: [
    { scope: 'user', details: { target: 'C:\\a.json' } },
    { scope: 'user', details: { target: 'C:\\b.json' } },
  ] };
  assert.equal(guidanceFolder(driveRoot), 'C:\\', 'the drive root keeps its separator, never a drive-relative prefix');
});

test('the guidance folder is the common directory of user-scope operation targets, or explicitly none', () => {
  assert.equal(guidanceFolder(review({ operations: [
    operation('u1', { scope: 'user', details: { target: 'C:\\Users\\me\\.claude\\CLAUDE.md' } }),
    operation('u2', { scope: 'user', details: { target: 'C:\\Users\\me\\.claude\\rules\\x.md' } })] })), 'C:\\Users\\me\\.claude');
  assert.equal(guidanceFolder(review({ operations: [operation('p1', { scope: 'project', details: { target: 'C:\\p\\x' } })] })), null);
  assert.equal(guidanceFolder(review({})), null);
});

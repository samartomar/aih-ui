import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStatuses, onlyIndexStatuses } from '../../src/catalog/index-status.js';

const source = (id, ...diagnostics) => ({ id, state: 'failed', lastVerifiedAt: null, diagnostics, message: 'Catalog message' });

test('each index status Catalog reports reads in the contract\'s exact words', () => {
  const catalog = { frameworkSources: [
    source('catalog-public', { code: 'unsigned', message: 'm' }, { code: 'expired', message: 'm' }),
    source('org-mirror', { code: 'rollback-refused', message: 'm' }, { code: 'root-revoked', message: 'm' }, { code: 'conflict', frameworkId: 'ecc', version: '1.7.0', message: 'm' }),
    { ...source('local', { code: 'offline', message: 'm' }), lastVerifiedAt: '2026-10-01T00:00:00Z' },
  ] };
  assert.deepEqual(indexStatuses(catalog).map(line => line.text), [
    'Release list not signed yet',
    "catalog-public's list has expired; not used",
    'org-mirror offered an older list; refused',
    "org-mirror's keys were withdrawn; its releases are hidden",
    'Sources disagree about ecc 1.7.0; neither is used',
    "Can't reach local; using the copy from 2026-10-01T00:00:00Z",
  ]);
});

test('unsigned is said once, and prepared content never adds an index status', () => {
  const prepared = [{ kind: 'internal', internalContent: { status: { authenticated: false } } }];
  assert.deepEqual(indexStatuses({ frameworkSources: [source('a', { code: 'unsigned' }), source('b', { code: 'unsigned' })], frameworks: prepared }).map(line => line.code), ['unsigned']);
  assert.deepEqual(indexStatuses({ frameworks: prepared }), [], 'prepared-only shows no index status');
  assert.deepEqual(indexStatuses({ frameworkSources: [{ id: 'signed', state: 'read', diagnostics: [] }], frameworks: prepared }), [], 'a verified index beside prepared content shows none');
});

test('no status is guessed: other codes, signed content and an undated offline copy show nothing', () => {
  assert.deepEqual(indexStatuses({ frameworkSources: [source('a', { code: 'INPUT_INVALID' }), source('b', { code: 'offline' })],
    frameworks: [{ kind: 'internal', internalContent: { status: { authenticated: true } } }] }), []);
  assert.equal(onlyIndexStatuses(source('a', { code: 'expired' })), true);
  assert.equal(onlyIndexStatuses(source('a', { code: 'unsigned' }, { code: 'INPUT_INVALID' })), false);
  assert.equal(onlyIndexStatuses(source('a')), false);
});

test('the status lines and the covered-source rule agree: an undated offline source keeps its own line', () => {
  const undated = source('mirror', { code: 'offline', message: 'm' });
  const dated = { ...undated, lastVerifiedAt: '2026-10-01T00:00:00Z' };
  assert.deepEqual(indexStatuses({ frameworkSources: [undated] }), [], 'no guessed date');
  assert.equal(onlyIndexStatuses(undated), false, 'so the source is not covered and its failure line is shown');
  assert.equal(indexStatuses({ frameworkSources: [dated] }).length, 1);
  assert.equal(onlyIndexStatuses(dated), true, 'a dated offline copy is covered by its status line');
  for (const value of [undated, dated, source('a', { code: 'expired' }), source('b', { code: 'unsigned' }, { code: 'INPUT_INVALID' })])
    assert.equal(onlyIndexStatuses(value), value.diagnostics.every(diagnostic => indexStatuses({ frameworkSources: [{ ...value, diagnostics: [diagnostic] }] }).length === 1), 'one rule for both');
});

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

test('unsigned is said once, including for prepared content Catalog labels unauthenticated', () => {
  const catalog = { frameworkSources: [source('a', { code: 'unsigned' }), source('b', { code: 'unsigned' })],
    frameworks: [{ kind: 'internal', internalContent: { status: { authenticated: false } } }] };
  assert.deepEqual(indexStatuses(catalog).map(line => line.code), ['unsigned']);
  assert.deepEqual(indexStatuses({ frameworks: [{ kind: 'internal', internalContent: { status: { authenticated: false } } }] }).map(line => line.text), ['Release list not signed yet']);
});

test('no status is guessed: other codes, signed content and an undated offline copy show nothing', () => {
  assert.deepEqual(indexStatuses({ frameworkSources: [source('a', { code: 'INPUT_INVALID' }), source('b', { code: 'offline' })],
    frameworks: [{ kind: 'internal', internalContent: { status: { authenticated: true } } }] }), []);
  assert.equal(onlyIndexStatuses(source('a', { code: 'expired' })), true);
  assert.equal(onlyIndexStatuses(source('a', { code: 'unsigned' }, { code: 'INPUT_INVALID' })), false);
  assert.equal(onlyIndexStatuses(source('a')), false);
});

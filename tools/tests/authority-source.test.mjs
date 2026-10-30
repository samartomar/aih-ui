import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorityFromResult, changeSummary, compareRevision, reviewFreshness, revisionOf, sourceRows } from '../../src/app/authority-source.js';

const source = { provider: 'github', repository: { owner: 'acme', name: 'policies' }, path: 'org/policy.json', revision: { kind: 'branch', value: 'main' } };
const authority = (commit = 'c1', blob = 'b1', digest = 'd1') => ({ source, resolvedCommit: commit, blobId: blob, contentDigest: digest, policyId: 'team', retrievedAt: '2026-01-01T00:00:00Z' });
const review = (commit = 'c1', blob = 'b1', digest = 'd1') => ({ inputs: { organization: { resolvedCommit: commit, blobId: blob, contentDigest: digest, policyId: 'team' } } });

test('source rows name provider, owner/name, path and "kind value" ref', () => {
  assert.deepEqual(sourceRows(source), { provider: 'github', repository: 'acme/policies', path: 'org/policy.json', ref: 'branch main' });
  assert.deepEqual(sourceRows(null), {});
});
test('revision identity is exactly commit, blob and digest', () => {
  assert.deepEqual(revisionOf(authority()), { resolvedCommit: 'c1', blobId: 'b1', contentDigest: 'd1' });
  assert.equal(revisionOf(null), undefined);
  assert.equal(revisionOf({ source }), undefined);
});
test('compareRevision distinguishes first, unchanged and changed reads', () => {
  const a = revisionOf(authority());
  assert.equal(compareRevision(undefined, a), 'first');
  assert.equal(compareRevision(a, revisionOf(authority())), 'unchanged');
  assert.equal(compareRevision(a, revisionOf(authority('c2'))), 'changed');
  assert.equal(compareRevision(a, revisionOf(authority('c1', 'b2'))), 'changed');
  assert.equal(compareRevision(a, revisionOf(authority('c1', 'b1', 'd2'))), 'changed');
});
test('a changed summary names old and new commit, blob and digest', () => {
  const text = changeSummary('changed', revisionOf(authority('c1', 'b1', 'd1')), revisionOf(authority('c2', 'b2', 'd2')));
  for (const part of ['c1', 'b1', 'd1', 'c2', 'b2', 'd2']) assert.match(text, new RegExp(part));
  assert.match(changeSummary('unchanged', revisionOf(authority()), revisionOf(authority())), /unchanged/i);
  assert.match(changeSummary('first', undefined, revisionOf(authority())), /first/i);
});
test('review freshness compares the held review to the latest read', () => {
  const latest = revisionOf(authority());
  assert.equal(reviewFreshness(undefined, latest), 'none');
  assert.equal(reviewFreshness({ inputs: {} }, latest), 'none');
  assert.equal(reviewFreshness(review(), undefined), 'none');
  assert.equal(reviewFreshness(review(), latest), 'current');
  assert.equal(reviewFreshness(review('c2'), latest), 'stale');
  assert.equal(reviewFreshness(review('c1', 'b1', 'd2'), latest), 'stale');
});
test('authority is read from Refresh and Prepare results only when ok', () => {
  assert.equal(authorityFromResult({ status: 'ok', value: { authority: authority() } }).resolvedCommit, 'c1');
  assert.equal(authorityFromResult({ status: 'ready', authority: { status: 'ok', value: { authority: authority('c9') } } }).resolvedCommit, 'c9');
  assert.equal(authorityFromResult({ status: 'refused', authority: { source } }), undefined);
  assert.equal(authorityFromResult({ status: 'ok', value: { mode: 'vibe', authority: null } }), undefined);
  assert.equal(authorityFromResult({ status: 'superseded' }), undefined);
});

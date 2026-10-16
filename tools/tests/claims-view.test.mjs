import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPanels, reportText } from '../../src/app/claims-view.js';

// Hand-built claims projections (shape: claims-projection 1.0.0). The repository has no
// @aihq package installed, so the adapter-to-Core path is covered by tools/consumer/claims.test.mjs.
const ref = (id, revision = 'r1') => ({ id, revision });
const claim = (id, extra = {}) => ({ id, revision: 'r1', producer: { id: 'aih-ui/readiness', version: '1.0.0' },
  recordSchema: 'urn:aih-ui:readiness-record:1.0.0', subject: { kind: 'target', id: 'npm' }, scope: { kind: 'machine', targets: ['npm'] },
  sources: [{ id: 'rec-1', schema: 'urn:aih-ui:readiness-record:1.0.0', sha256: 'a'.repeat(64) }], observation: `${id}#event`,
  capturedAt: '2026-10-15T10:00:01.000Z', measure: 'configuration-check', kind: 'measured', value: { amount: 'passed', unit: 'outcome' },
  coverage: { state: 'complete', reason: 'Every selected check ran.' }, authentication: { status: 'not-authenticated' },
  applicability: { state: 'current', reason: 'Latest machine check.', inputs: [] }, dedup: { status: 'unique', canonical: null }, ...extra });
const unknown = (id, reason, extra = {}) => { const { value, ...rest } = claim(id, extra); return { ...rest, kind: 'unknown', unknownReason: reason }; };
const projection = (extra = {}) => ({ schema: 'urn:aihq:report:claims-projection:1.0.0', source: { schema: 'urn:aihq:report:claims:1.0.0' },
  claims: [], observations: { duplicates: [], conflicts: [], unidentified: [] }, calculations: [], actions: [], ...extra });
const score = (extra = {}) => ({ id: 'configuration-check-score', method: { id: 'configuration-check-score', version: '1.0.0' }, status: 'available',
  reason: null, inputs: [], checkSet: { id: 'aih-ui/machine-check', version: '1.0.0' }, counts: { passed: 2, failed: 1, unknown: 1, inapplicable: 0 },
  numerator: 2, denominator: 4, score: 50, failed: [], conflicts: [], excluded: [], deduplication: { status: 'established', unidentified: [] }, ...extra });
const attempt = (reason, extra = {}) => ({ operation: 'node-npm-ca', subject: { kind: 'target', id: 'npm' }, condition: 'condition:npm/tls/node',
  precheck: null, repair: null, postcheck: null, counted: reason === 'verified', reason, ...extra });
const repairs = (count, attempts) => ({ id: 'verified-repairs', method: { id: 'verified-repair-count', version: '1.0.0' }, status: 'available',
  reason: null, inputs: [], count, attempts, deduplication: { status: 'established', unidentified: [] } });
const strings = panel => [panel.title, panel.summary, ...panel.items.flatMap(item => [item.text, ...item.details]),
  ...(panel.sections ?? []).flatMap(strings)].filter(Boolean);

test('a score keeps unknown checks in the denominator and lists failed checks even when the score is high', () => {
  const failed = claim('rec-1/check/npm/version', { value: { amount: 'failed', unit: 'outcome' } });
  const panels = reportPanels(projection({ claims: [failed], calculations: [score({ counts: { passed: 19, failed: 1, unknown: 0, inapplicable: 0 },
    numerator: 19, denominator: 20, score: 95, failed: [ref('rec-1/check/npm/version')] })] }));
  assert.equal(panels.score.value, '95%');
  assert.match(panels.score.summary, /19 of 20 checks passed/);
  assert.equal(panels.score.items.length, 1);
  assert.match(panels.score.items[0].text, /^Failed: npm\/version on npm/);
  assert.equal(panels.score.items[0].tone, 'error');
  const mixed = reportPanels(projection({ calculations: [score()] }));
  assert.equal(mixed.score.value, '50%');
  assert.match(mixed.score.summary, /2 of 4 checks passed \(1 failed, 1 unknown\)/);
  assert.match(mixed.score.summary, /Unknown checks stay in the total/);
});

test('with no machine check or no applicable check the score is Unavailable, never 0', () => {
  const none = reportPanels(projection());
  assert.equal(none.score.value, 'Unavailable');
  assert.match(none.score.summary, /No machine check has been run/);
  const empty = reportPanels(projection({ calculations: [score({ status: 'unavailable', reason: 'no-applicable-checks', score: null,
    counts: { passed: 0, failed: 0, unknown: 0, inapplicable: 0 }, numerator: 0, denominator: 0 })] }));
  assert.equal(empty.score.value, 'Unavailable');
  assert.match(empty.score.summary, /No applicable check/);
  for (const text of [reportText(projection()), reportText(projection({ calculations: [score({ status: 'unavailable', reason: 'no-applicable-checks', score: null })] }))])
    assert.doesNotMatch(text, /\b0%/);
});

test('exactly one verified repair is stated as one, and every uncounted attempt shows its Core reason', () => {
  const panels = reportPanels(projection({ calculations: [repairs(1, [
    attempt('verified'), attempt('already-healthy', { subject: { kind: 'target', id: 'git' }, condition: 'condition:git/version' }),
    attempt('unknown-cause', { operation: 'none', subject: { kind: 'target', id: 'pip' }, condition: 'condition:pip/version' }),
    attempt('applied-unverified', { subject: { kind: 'target', id: 'cargo' }, condition: 'condition:cargo/tls' })])] }));
  assert.equal(panels.repairs.value, '1');
  assert.match(panels.repairs.summary, /^1 verified repair\b/);
  assert.doesNotMatch(panels.repairs.summary, /1 verified repairs/);
  const byReason = Object.fromEntries(panels.repairs.items.map(item => [item.details.find(line => line.startsWith('Core reason: ')), item]));
  assert.deepEqual(Object.keys(byReason), ['Core reason: verified', 'Core reason: already-healthy', 'Core reason: unknown-cause', 'Core reason: applied-unverified']);
  assert.match(byReason['Core reason: verified'].text, /^Counted — npm npm\/tls\/node/);
  assert.match(byReason['Core reason: already-healthy'].text, /^Not counted — git git\/version: already passed before any repair/);
  assert.match(byReason['Core reason: unknown-cause'].text, /no repair was applied, so the cause is unknown/);
  assert.match(byReason['Core reason: applied-unverified'].text, /has not passed afterwards/);
  assert.equal(byReason['Core reason: verified'].tone, 'success');
  assert.notEqual(byReason['Core reason: already-healthy'].tone, 'success');
});

test('zero verified repairs says so with the reason of each attempt, and no attempts is not a verified repair', () => {
  const panels = reportPanels(projection({ calculations: [repairs(0, [attempt('already-healthy')])] }));
  assert.match(panels.repairs.summary, /^0 verified repairs\b/);
  assert.equal(panels.repairs.items.length, 1);
  const none = reportPanels(projection({ calculations: [repairs(0, [])] }));
  assert.match(none.repairs.summary, /^0 verified repairs\b.*No repair attempt/);
  assert.match(reportPanels(projection()).repairs.summary, /No repair calculation/);
});

test('estimated context, measured file size and observed usage are separate series; missing usage is Unavailable', () => {
  const size = claim('scan-1/file-size', { measure: 'file-size', subject: { kind: 'source', id: 'scan-1' }, value: { amount: 23, unit: 'bytes' } });
  const estimate = claim('estimate-1', { measure: 'configured-context', kind: 'estimated', value: { amount: 400, unit: 'tokens' }, method: { id: 'est', version: '1' } });
  const usage = unknown('observed-usage/unavailable', 'The Workbench collects no client usage.', { measure: 'observed-usage' });
  const panels = reportPanels(projection({ claims: [size, estimate, usage] }));
  assert.deepEqual(panels.context.sections.map(section => section.id), ['file-size', 'configured-context', 'observed-usage']);
  const [fileSize, estimated, observed] = panels.context.sections;
  assert.match(fileSize.items[0].details.join('\n'), /Kind: Measured/);
  assert.match(fileSize.items[0].details.join('\n'), /Value: 23 bytes/);
  assert.match(estimated.items[0].details.join('\n'), /Kind: Estimated/);
  assert.match(estimated.items[0].details.join('\n'), /Value: 400 tokens/);
  assert.match(observed.summary, /^Unavailable/);
  assert.match(observed.items[0].details.join('\n'), /Kind: Unknown/);
  assert.match(observed.items[0].details.join('\n'), /Value: Unavailable — The Workbench collects no client usage\./);
  assert.doesNotMatch(strings(observed).join('\n'), /\b0 tokens|Value: 0/);
  const empty = reportPanels(projection());
  assert.match(empty.context.sections[2].summary, /^Unavailable/);
  assert.match(empty.context.sections[1].summary, /No estimate/);
});

test('observed usage is never shown as the estimate and a comparison that Core refuses stays unavailable', () => {
  const comparison = { id: 'estimate-vs-observed', method: { id: 'context-change', version: '1.0.0' }, status: 'unavailable', reason: 'incomparable-kind', inputs: [] };
  const available = { id: 'bytes', method: { id: 'context-change', version: '1.0.0' }, status: 'available', reason: null, inputs: [], before: 1000, after: 750,
    unit: 'bytes', absoluteDifference: 250, direction: 'decrease', percentage: 25 };
  const panels = reportPanels(projection({ calculations: [comparison, available] }));
  const lines = panels.context.items.map(item => item.text);
  assert.ok(lines.some(line => /^Context change estimate-vs-observed: Unavailable — .*incomparable-kind/.test(line)), lines.join('\n'));
  assert.ok(lines.some(line => /^Context change bytes: decrease of 250 bytes \(1000 to 750, 25% reduction\)/.test(line)), lines.join('\n'));
});

test('every claim shows kind, value or reason, coverage, freshness and de-duplication status', () => {
  const stale = claim('rec-0/check/jq/version', { applicability: { state: 'recheck-needed', reason: 'A later machine check exists.', inputs: [] },
    dedup: { status: 'duplicate', canonical: ref('rec-1/check/jq/version') } });
  const loading = unknown('rec-1/check/claude/loading', 'loading-unverified', { subject: { kind: 'target', id: 'claude' }, coverage: { state: 'partial', reason: 'The check was incomplete.' } });
  const canonical = claim('rec-1/check/jq/version');
  const panels = reportPanels(projection({ claims: [stale, canonical, loading] }));
  const [first, , second] = panels.claims.items;
  const text = item => [item.text, ...item.details].join('\n');
  assert.match(text(first), /Kind: Measured/);
  assert.match(text(first), /Value: passed/);
  assert.match(text(first), /Freshness: Recheck needed — A later machine check exists\. Captured 2026-10-15T10:00:01\.000Z/);
  assert.match(text(first), /De-duplication: Duplicate of jq\/version on npm/);
  assert.match(text(first), /Sources: rec-1 \(urn:aih-ui:readiness-record:1\.0\.0, sha256 a{12}/);
  assert.match(text(second), /Kind: Unknown/);
  assert.match(text(second), /Value: Unavailable — loading-unverified/);
  assert.match(text(second), /Coverage: Partial — The check was incomplete\./);
  assert.notEqual(first.tone, second.tone);
});

test('duplicates, conflicts and unidentified events are stated in the observations panel', () => {
  const panels = reportPanels(projection({ claims: [claim('a'), claim('a-reimport')], observations: {
    duplicates: [{ producer: 'aih-ui/readiness', observation: 'a#event', claim: ref('a'), merged: [ref('a-reimport')], imports: 2 }],
    conflicts: [{ producer: 'aih-ui/readiness', observation: 'b#event', claims: [ref('b1'), ref('b2')], reason: 'same-observation-different-content' }],
    unidentified: [ref('c')] } }));
  const all = panels.observations.items.map(item => item.text).join('\n');
  assert.match(all, /Counted once: .* imported 2 times/);
  assert.match(all, /Conflicting records for one event: b1, b2/);
  assert.match(all, /No event identity: c/);
});

test('actions follow the projection order and say where each one routes', () => {
  const action = (id, rank, category, reason) => ({ id, category, reason, subjects: [{ kind: 'target', id: 'jq' }], evidence: [ref('x')], prerequisites: [],
    route: { kind: 'guidance', id: `jq/${id}` }, order: { rank, category, reason: 'rule', tie: 'id' } });
  const panels = reportPanels(projection({ claims: [claim('x')], actions: [action('b', 1, 'blocker', 'jq failed.'), action('u', 2, 'important-unknown', 'jq is unknown.')] }));
  assert.deepEqual(panels.actions.items.map(item => item.text), ['1. Blocker — jq failed.', '2. Important unknown — jq is unknown.']);
  assert.ok(panels.actions.items[0].details.includes('Route: guidance jq/b'));
  assert.match(reportPanels(projection()).actions.summary, /No action/);
});

test('reportText is built only from the panel strings', () => {
  const full = projection({ claims: [claim('rec-1/check/npm/version', { value: { amount: 'failed', unit: 'outcome' } }), unknown('rec-1/check/jq/loading', 'loading-unverified'),
    unknown('observed-usage/unavailable', 'The Workbench collects no client usage.', { measure: 'observed-usage' })],
  calculations: [score({ failed: [ref('rec-1/check/npm/version')] }), repairs(0, [attempt('unknown-cause', { operation: 'none' })])],
  actions: [{ id: 'b', category: 'blocker', reason: 'npm failed.', subjects: [], evidence: [], prerequisites: [], route: { kind: 'guidance', id: 'npm/x' },
    order: { rank: 1, category: 'blocker', reason: 'r', tie: 'id' } }] });
  const panels = reportPanels(full);
  const text = reportText(full);
  const meanings = [...new Set(Object.values(panels).flatMap(strings))].sort((a, b) => b.length - a.length);
  for (const meaning of meanings) assert.ok(text.includes(meaning), `missing: ${meaning}`);
  let rest = text;
  for (const meaning of meanings) rest = rest.split(meaning).join('');
  assert.match(rest, /^[\s-]*$/, `text has words outside the panels: ${JSON.stringify(rest)}`);
});

test('a missing or empty projection renders honest placeholders', () => {
  for (const value of [null, undefined, {}]) {
    const panels = reportPanels(value);
    assert.equal(panels.score.value, 'Unavailable');
    assert.deepEqual(Object.keys(panels), ['score', 'repairs', 'actions', 'claims', 'context', 'observations']);
    assert.equal(typeof reportText(value), 'string');
  }
});

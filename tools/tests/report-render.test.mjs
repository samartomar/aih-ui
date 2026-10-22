// The V9 report presentation without a package: the renderer is bound to a stand-in for @aihq/core/report's
// importSnapshot/exportSnapshot. Byte equivalence with Core and the browser checks run in tools/check-report.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReportRenderer, MODES, SECTION_IDS } from '../../src/report/render.js';
import { TEMPLATE, TEMPLATE_SOURCE_SHA256 } from '../../src/report/template.js';
import { templateCurrent } from '../report-template.mjs';
import { renderSnapshotText } from '../report/core-report.mjs';
import { reportSnapshots } from '../report/fixtures.mjs';
import { parseArguments } from '../render-report.mjs';
import { pageAssets } from '../server/assets.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const calls = [];
// The stand-in re-projects like Core does: export, then import. It masks one marker so the test can see that the
// page draws the re-projected copy, never the caller's object.
const data = {
  exportSnapshot: value => { calls.push('export'); return JSON.stringify(value).replaceAll('SECRET-MARKER', '[REDACTED]'); },
  importSnapshot: text => { calls.push('import'); const value = JSON.parse(text); if (value?.schema !== 'urn:aihq:report:snapshot:1.0.0') throw Object.assign(new Error('snapshot.schema: unsupported version'), { code: 'SCHEMA_UNSUPPORTED' }); return value; },
};
const renderReport = createReportRenderer(data);
const snapshots = reportSnapshots();
const sectionStates = html => Object.fromEntries([...html.matchAll(/<section[^>]*id="(sec-[a-z]+)"[^>]*data-state="(live|empty)"/g)].map(match => [match[1], match[2]]));
const embedded = html => /window\.AIH_DATA=(.*);\n/.exec(html)[1];

test('the renderer needs Core\'s public data functions', () => {
  assert.throws(() => createReportRenderer(), TypeError);
  assert.throws(() => createReportRenderer({ importSnapshot: data.importSnapshot }), /importSnapshot and exportSnapshot/);
  assert.deepEqual([...MODES], ['report', 'demo']);
});

test('the template module reproduces from the authored shell', async () => {
  const { current, sha256 } = await templateCurrent();
  assert.ok(current, 'run node tools/report-template.mjs');
  assert.equal(sha256, TEMPLATE_SOURCE_SHA256);
  for (const id of SECTION_IDS) assert.ok(TEMPLATE.includes(`id="${id}"`), id);
});

test('report mode draws five LIVE sections from the re-projected snapshot and nine EMPTY ones', () => {
  calls.length = 0;
  const marked = { ...snapshots.findings, observations: [{ id: 'obs', target: 'SECRET-MARKER', detail: 'seen' }] };
  const html = renderReport(marked);
  assert.deepEqual(calls, ['export', 'import'], 'the snapshot is re-projected before it is drawn');
  assert.ok(!html.includes('SECRET-MARKER') && html.includes('[REDACTED]'), 'the page draws the re-projected copy');
  const states = sectionStates(html);
  assert.deepEqual(Object.keys(states).sort(), [...SECTION_IDS].sort());
  assert.deepEqual(Object.keys(states).filter(id => states[id] === 'live').sort(), ['sec-actions', 'sec-adoption', 'sec-hero', 'sec-ready', 'sec-support']);
  assert.match(html, /Saved snapshot display — Supplied snapshot — not re-collected/);
  assert.doesNotMatch(html, /<span class="ver">V9<\/span>/);
  assert.match(html, /saved snapshot · offline report/);
  assert.match(html, /FAILED CHECKS/);
  assert.match(html, /<body>/);
  assert.equal(renderReport(marked), html, 'identical input gives identical bytes');
});

test('supplied text is escaped in the markup and cannot end the embedded script', () => {
  const html = renderReport(snapshots.findings, { title: 'Check <b>&"\'' });
  assert.match(html, /<title>Check &lt;b&gt;&amp;&quot;&#39;<\/title>/);
  assert.ok(!html.includes('</script><b>bold</b>'), 'a supplied closing tag is never emitted raw');
  const literal = embedded(html);
  assert.doesNotMatch(literal, new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`));
  assert.equal(JSON.parse(literal).mode, 'report');
});

test('readiness wording follows the status and never says ready', () => {
  assert.match(renderReport(snapshots.cancelled), /NOT EVALUATED/);
  assert.match(renderReport(snapshots['no-checks']), /NO CHECKS REPORTED/);
  assert.match(renderReport(snapshots.workflow), /NO FAILED CHECKS/);
  for (const snapshot of Object.values(snapshots)) {
    const drawn = Object.values(JSON.parse(embedded(renderReport(snapshot))).sections).map(section => section.html).join('');
    assert.doesNotMatch(drawn, /ready/i, 'report mode never claims readiness');
  }
});

test('demo mode is the labelled design sample and shows none of the snapshot\'s values', () => {
  calls.length = 0;
  const html = renderReport({ ...snapshots.findings, observations: [{ id: 'obs', target: 'UNIQUE-TARGET-VALUE', detail: 'seen' }] }, { mode: 'demo' });
  assert.deepEqual(calls, ['export', 'import'], 'the snapshot is still validated');
  assert.match(html, /<body data-demo="on">/);
  assert.match(html, /<div class="demo-banner"><strong>DEMO<\/strong><span>Design sample\./);
  assert.ok(!html.includes('UNIQUE-TARGET-VALUE'));
  assert.deepEqual(JSON.parse(embedded(html)), { mode: 'demo', sections: {} });
});

test('invalid options are a TypeError and invalid input is the data module\'s refusal, in demo mode too', () => {
  for (const options of [null, { title: '' }, { title: 'x'.repeat(201) }, { mode: 'live' }]) assert.throws(() => renderReport(snapshots.workflow, options), TypeError);
  assert.throws(() => renderReport({ ...snapshots.workflow, schema: 'other' }, { mode: 'demo' }), /unsupported version/);
});

test('the host and the offline tool validate first and report Core\'s code', () => {
  const bound = { data, renderReport };
  assert.deepEqual(renderSnapshotText(bound, JSON.stringify({ schema: 'other' })), { status: 'invalid', code: 'SCHEMA_UNSUPPORTED', errors: ['snapshot.schema: unsupported version'] });
  assert.equal(renderSnapshotText(bound, JSON.stringify(snapshots.workflow), { mode: 'live' }).code, 'OPTIONS_INVALID');
  const ok = renderSnapshotText(bound, JSON.stringify(snapshots.workflow), { mode: 'demo' });
  assert.equal(ok.status, 'ok'); assert.match(ok.html, /<body data-demo="on">/);
});

test('the offline tool takes a snapshot, an output and its options', () => {
  const parsed = parseArguments(['in.json', 'out.html', '--demo', '--title', 'T', '--consumer', 'c']);
  assert.equal(parsed.mode, 'demo'); assert.equal(parsed.title, 'T'); assert.equal(parsed.consumer, 'c');
  assert.equal(parseArguments(['in.json', 'out.html']).mode, 'report');
  assert.throws(() => parseArguments(['in.json']), /Usage/);
  assert.throws(() => parseArguments(['in.json', 'out.html', '--force']), /Unknown option/);
  assert.throws(() => parseArguments(['in.json', 'out.html', '--title']), /needs a value/);
});

test('the page serves the snapshot view but never the unlabelled authored shell', () => {
  const served = pageAssets(repo).map(asset => asset.to);
  assert.ok(served.includes('report/snapshot-view.js'));
  assert.ok(!served.some(path => path.startsWith('report/templates/')));
  assert.ok(existsSync(join(repo, 'src/report/templates/report.html')), 'the authored shell stays in src/');
});

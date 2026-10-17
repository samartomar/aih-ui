// The V9 report presentation against an installed @aihq/core.
// Usage: node tools/check-report.mjs <consumer dir> <new evidence dir>
// 1. src/report/template.js reproduces from the authored shell.
// 2. While the installed Core still exports ./report/render, the Workbench renderer draws the same bytes as
//    Core's for every fixture snapshot, mode and title, and refuses the same invalid input with the same code.
//    Once Core no longer exports it, this step records that and checks nothing against it.
// 3. tools/render-report.mjs validates and writes one snapshot offline, refuses invalid input without
//    writing, and never replaces an existing file.
// 4. The visual check (tools/report/visual.mjs) for the workflow snapshot, with screenshots.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateCurrent } from './report-template.mjs';
import { loadCoreRendererForComparison, loadReportRenderer } from './report/core-report.mjs';
import { reportSnapshots, WORKFLOW_SNAPSHOT_TEXT } from './report/fixtures.mjs';
import { runReportVisual } from './report/visual.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 4) throw new Error('Usage: node tools/check-report.mjs <consumer dir> <new evidence dir>');
const consumerDir = resolve(process.argv[2]), evidence = resolve(process.argv[3]);
assert.ok(!existsSync(evidence), `${evidence} must not exist yet`);
await mkdir(evidence, { recursive: true });
const sha = text => createHash('sha256').update(text).digest('hex');

const template = await templateCurrent();
assert.ok(template.current, 'src/report/template.js reproduces from src/report/templates/report.html');
console.log(`Report template reproduces from the authored shell (sha256 ${template.sha256}).`);

const renderer = await loadReportRenderer(consumerDir);
const coreRender = await loadCoreRendererForComparison(consumerDir);
const equivalence = { coreVersion: renderer.version, templateSourceSha256: template.sha256, compared: coreRender !== null, cases: [] };
if (coreRender) {
  const titles = [undefined, 'Workstation <check> & "quotes"'];
  for (const [name, snapshot] of Object.entries(reportSnapshots())) {
    for (const mode of ['report', 'demo']) for (const title of titles) {
      const options = { mode, ...(title === undefined ? {} : { title }) };
      const ours = renderer.renderReport(snapshot, options), theirs = coreRender(snapshot, options);
      assert.equal(ours, theirs, `${name} ${mode}${title ? ' titled' : ''}: the Workbench renderer draws Core's bytes`);
      equivalence.cases.push({ snapshot: name, mode, title: title ?? null, sha256: sha(ours), bytes: Buffer.byteLength(ours), identical: true });
    }
  }
  const refusal = fn => { try { fn(); return 'rendered'; } catch (error) { return `${error.constructor.name}:${error.code ?? ''}`; } };
  const base = reportSnapshots().workflow;
  for (const [label, input, options] of [['empty object', {}, {}], ['unsupported schema', { ...base, schema: 'urn:aihq:report:snapshot:9.0.0' }, {}],
    ['unknown mode', base, { mode: 'live' }], ['empty title', base, { title: '' }], ['null options', base, null], ['invalid snapshot in demo mode', {}, { mode: 'demo' }]]) {
    const ours = refusal(() => renderer.renderReport(input, options)), theirs = refusal(() => coreRender(input, options));
    assert.notEqual(ours, 'rendered', `${label} is refused`);
    assert.equal(ours, theirs, `${label}: refused like Core`);
    equivalence.cases.push({ refusal: label, outcome: ours, identical: true });
  }
  console.log(`The Workbench renderer matches @aihq/core ${renderer.version} ./report/render byte for byte in ${equivalence.cases.length} cases.`);
} else console.log(`@aihq/core ${renderer.version} no longer exports ./report/render; nothing to compare against.`);
await writeFile(join(evidence, 'report-equivalence.json'), `${JSON.stringify(equivalence, null, 2)}\n`);

// The offline tool, as a person runs it.
const offline = join(evidence, 'offline'); await mkdir(offline);
const snapshotPath = join(offline, 'snapshot.json'); await writeFile(snapshotPath, WORKFLOW_SNAPSHOT_TEXT);
const cli = (...args) => spawnSync(process.execPath, [join(repo, 'tools/render-report.mjs'), ...args, '--consumer', consumerDir], { encoding: 'utf8', windowsHide: true });
for (const [file, extra, mode] of [['report.html', [], 'report'], ['design-sample.html', ['--demo'], 'demo']]) {
  const run = cli(snapshotPath, join(offline, file), ...extra);
  assert.equal(run.status, 0, `render-report ${mode}: ${run.stderr}`);
  const expected = renderer.renderReport(renderer.data.importSnapshot(WORKFLOW_SNAPSHOT_TEXT), { mode });
  assert.equal(await readFile(join(offline, file), 'utf8'), expected, `render-report ${mode} writes the renderer's bytes`);
}
const again = cli(snapshotPath, join(offline, 'report.html'));
assert.notEqual(again.status, 0); assert.match(again.stderr, /already exists/);
const badPath = join(offline, 'unsupported.json');
await writeFile(badPath, JSON.stringify({ ...JSON.parse(WORKFLOW_SNAPSHOT_TEXT), schema: 'urn:aihq:report:snapshot:9.0.0' }));
const bad = cli(badPath, join(offline, 'unsupported.html'));
assert.notEqual(bad.status, 0); assert.match(bad.stderr, /SCHEMA_UNSUPPORTED/);
assert.ok(!existsSync(join(offline, 'unsupported.html')), 'an invalid snapshot writes nothing');
console.log('tools/render-report.mjs validates first, writes the renderer\'s bytes, and refuses to replace a file or render an unsupported snapshot.');

const record = await runReportVisual({ renderer, snapshot: renderer.data.importSnapshot(WORKFLOW_SNAPSHOT_TEXT), output: join(evidence, 'visual') });
console.log(`V9 visual check passed: ${JSON.stringify(record.modes)}`);

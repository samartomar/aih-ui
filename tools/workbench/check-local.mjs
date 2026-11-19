import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPrototypeServer } from './local-server.mjs';
import { request as httpRequest } from 'node:http';

const [consumer, output, sourceCache, recipeCommit] = process.argv.slice(2);
if (!consumer || !output) throw Error('Usage: node tools/workbench/check-local.mjs <consumer> <existing-output-parent> [source-cache] [recipe-commit]');
const workspace = await mkdtemp(join(resolve(output), 'functional-check-'));
const host = await createPrototypeServer({ consumer, workspace, sourceCache, recipeCommit });
const checks = [];
try {
  const session = await (await fetch(host.origin + '/api/session')).json();
  async function post(action, body, expected = 200) {
    const response = await fetch(host.origin + '/api/' + action, { method: 'POST', headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': session.token }, body: JSON.stringify(body) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  const draft = (mode, text, superpowers = false) => post('draft', { mode, choices: { instructions: !superpowers, superpowers }, text });
  const apply = prepared => post('apply', { mode: prepared.mode, id: prepared.prepared.id, context: prepared.prepared.context, reviewDigest: prepared.prepared.result.review.reviewDigest });
  const select = (mode, text) => draft(mode, text);
  const e = session.enterprise, v = session.vibe;
  const absentPlugin = await post('check-claude', { mode: 'enterprise' }, 400);
  assert.equal(absentPlugin.code, 'PLUGIN_NOT_INSTALLED');
  await post('check-claude', { mode: 'enterprise', project: 'another-project' }, 400);
  assert.notEqual(e.home, v.home); assert.notEqual(e.project, v.project); checks.push('independent dedicated homes and projects');
  await writeFile(join(v.project, 'keep.txt'), 'unrelated');
  await select('vibe', 'Independent instructions.');
  let prepared = await post('prepare', { mode: 'vibe' });
  assert.equal(prepared.prepared.result.status, 'ready', JSON.stringify(prepared));
  let installed = await apply(prepared);
  assert.deepEqual(installed.installedPolicyChecks, []);
  assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  assert.equal(await readFile(join(v.project, 'CLAUDE.md'), 'utf8'), 'Independent instructions.');
  assert.equal(installed.inventory.entries.length, 1); checks.push('public Core prepare/apply/list and disk receipt agree');
  await post('apply', { mode: 'vibe', id: prepared.prepared.id, context: prepared.prepared.context, reviewDigest: prepared.prepared.result.review.reviewDigest }, 409); checks.push('approval replay refused');
  let checked = await post('check', { mode: 'vibe' }); assert.equal(checked.check.fileState, 'match', JSON.stringify(checked.check)); checks.push('public Core file check matches');
  await select('vibe', 'Updated instructions.'); prepared = await post('prepare', { mode: 'vibe' });
  assert.equal(prepared.prepared.operation, 'update');
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  assert.equal(await readFile(join(v.project, 'CLAUDE.md'), 'utf8'), 'Updated instructions.'); checks.push('public Core prepareUpdate reconfigures actual file');
  prepared = await post('prepare', { mode: 'vibe' });
  await select('vibe', 'Changed after review.');
  await post('apply', { mode: 'vibe', id: prepared.prepared.id, context: prepared.prepared.context, reviewDigest: prepared.prepared.result.review.reviewDigest }, 409); checks.push('changed draft invalidates approval');
  await select('enterprise', 'Organization instructions.');
  const policy = { mode: 'enterprise', id: 'example-team', obligation: 'permitted', allowCustom: true };
  const ruled = await post('policy', {...policy, frameworkRules:{extensions:'prohibited',egm:'permitted',guide:'recommended'}});
  assert.equal(ruled.validation.status, 'ok');
  assert.equal(ruled.organization.entries.find(entry => entry.content?.framework === 'egm').obligation, 'permitted');
  const selection = {mode:'enterprise', client:'claude-code', items:['extensions.agent.code-reviewer']};
  const denied = await post('catalog-plan', selection);
  assert.equal(denied.policy.value.admitted, false, 'Core evaluates the chosen Catalog framework');
  const independent = await post('catalog-plan', {...selection, mode:'vibe'});
  assert.equal(independent.policy, undefined);
  await post('policy-preview', {...policy, frameworkRules:{unknown:'required'}},400);
  let governed = await post('policy', policy); assert.equal(governed.validation.status, 'ok');
  prepared = await post('prepare', { mode: 'enterprise' }); assert.equal(prepared.prepared.result.review.organization.admitted, true, JSON.stringify(prepared.prepared.result));
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  await select('enterprise', 'Reconfigured organization instructions.');
  prepared = await post('prepare', { mode: 'enterprise', unit: 'instructions' });
  assert.equal(prepared.prepared.applyAllowed, true, JSON.stringify(prepared.prepared.result));
  assert.equal(prepared.prepared.result.review.organization.admitted, true);
  assert.equal(prepared.prepared.operation, 'update');
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  assert.equal(await readFile(join(e.project, 'CLAUDE.md'), 'utf8'), 'Reconfigured organization instructions.');
  prepared = await post('remove', { mode: 'enterprise', managementId: 'project-instructions' });
  assert.equal(prepared.prepared.applyAllowed, true, JSON.stringify(prepared.prepared.result));
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  assert.equal(installed.inventory.entries.length, 0);
  await assert.rejects(readFile(join(e.project, 'CLAUDE.md')), { code: 'ENOENT' });
  prepared = await post('prepare', { mode: 'enterprise', unit: 'instructions' });
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete');
  checks.push('Enterprise update and removal retain Enterprise mode and obey saved policy');
  const restricted = await post('policy', { ...policy, allowCustom: false });
  assert.deepEqual(restricted.installedPolicyChecks, [{ unit:'instructions', label:'Project instructions', removalId:'project-instructions', status:'denied' }]);
  prepared = await post('prepare', { mode: 'enterprise' });
  assert.equal(prepared.prepared.result.review.organization.admitted, false, JSON.stringify(prepared.prepared.result));
  assert.equal(prepared.prepared.result.review.organization.denials[0].code, 'AUTHORITY_DENIED');
  assert.equal(prepared.prepared.applyAllowed, false); checks.push('stored validated policy admits then prohibits via real Enterprise Core preparation');
  checked = await post('check', { mode: 'enterprise' }); assert.equal(checked.admission.value.admitted, false); checks.push('installed file check and current admission remain distinct');
  assert.equal(await readFile(join(v.project, 'CLAUDE.md'), 'utf8'), 'Updated instructions.'); checks.push('Enterprise boundary does not affect Vibe');
  prepared = await post('remove', { mode: 'vibe', managementId: installed.inventory.entries[0].managementId });
  installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
  assert.equal(installed.inventory.entries.length, 0); await assert.rejects(readFile(join(v.project, 'CLAUDE.md')), { code: 'ENOENT' });
  assert.equal(await readFile(join(v.project, 'keep.txt'), 'utf8'), 'unrelated'); checks.push('public Core removal clears claim and file, preserves unrelated file');
  if (sourceCache && recipeCommit) {
    await post('draft', { mode: 'vibe', choices: { instructions: true, superpowers: true }, text: 'Updated instructions.' });
    const oneUnit = await post('prepare', { mode: 'vibe', unit: 'instructions' });
    assert.equal(oneUnit.draft.choices.superpowers, true); assert.equal(oneUnit.draft.choices.instructions, true);
    assert.equal(oneUnit.prepared.operation, 'install'); checks.push('both choices retained while preparing one unit');
    await draft('vibe', 'Updated instructions.', true);
    prepared = await post('prepare', { mode: 'vibe' });
    assert.ok(prepared.prepared, JSON.stringify(prepared.outcome));
    assert.ok(prepared.prepared.result.review.origin?.recipe?.sha256, JSON.stringify(prepared.prepared.result.review.originNote));
    checks.push(`whole-plugin Core result: ${prepared.prepared.result.status}; apply available: ${prepared.prepared.applyAllowed}`);
    await writeFile(join(workspace, 'superpowers-prepare.json'), JSON.stringify(prepared, null, 2));
    assert.equal(prepared.prepared.applyAllowed, true, JSON.stringify(prepared.prepared.result));
    {
      installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete', JSON.stringify(installed.outcome));
      checked = await post('check', { mode: 'vibe' }); assert.equal(checked.check.fileState, 'match', JSON.stringify(checked.check));
      assert.ok(installed.inventory.entries.some(entry => entry.localPlugin && entry.framework === 'superpowers'));
      checks.push('real Catalog whole-plugin plan applied and Core file checks match');
    }
    await post('draft', { mode: 'vibe', choices: { instructions: true, superpowers: true }, text: 'Instructions beside Superpowers.' });
    prepared = await post('prepare', { mode: 'vibe', unit: 'instructions' });
    installed = await apply(prepared); assert.equal(installed.outcome.completion, 'complete');
    checked = await post('check', { mode: 'vibe' }); assert.equal(checked.checks.length, 2);
    assert.ok(checked.checks.every(row => row.check.fileState === 'match'));
    prepared = await post('remove', { mode: 'vibe', managementId: 'project-instructions' }); await apply(prepared);
    checked = await post('check', { mode: 'vibe' }); assert.deepEqual(checked.coverage.retainedUnits, ['superpowers']); assert.equal(checked.check.fileState, 'match');
    checks.push('check covers both retained units; removing instructions preserves Superpowers check');
    await draft('enterprise', 'Organization instructions.', true);
    await post('policy', policy);
    prepared = await post('prepare', { mode: 'enterprise', unit: 'superpowers' });
    assert.equal(prepared.prepared.result.review.organization.admitted, true, JSON.stringify(prepared.prepared.result.review.organization));
    await writeFile(join(workspace, 'enterprise-superpowers-permitted.json'), JSON.stringify(prepared.prepared.result, null, 2));
    await post('policy', { ...policy, obligation: 'prohibited' });
    prepared = await post('prepare', { mode: 'enterprise', unit: 'superpowers' });
    assert.equal(prepared.prepared.result.review.organization.admitted, false);
    assert.equal(prepared.prepared.applyAllowed, false);
    await writeFile(join(workspace, 'enterprise-superpowers-prohibited.json'), JSON.stringify(prepared.prepared.result, null, 2));
    checks.push('whole Superpowers Enterprise permitted/prohibited enforced by actual Core preparation');
    await post('policy', policy);
    prepared = await post('prepare', { mode: 'enterprise', unit: 'superpowers' });
    installed = await apply(prepared);
    assert.equal(installed.outcome.completion, 'complete');
    const pluginId = installed.inventory.entries.find(entry => entry.localPlugin && entry.framework === 'superpowers').managementId;
    const nativeCheck = await post('check-claude', { mode: 'enterprise' });
    assert.ok(['loaded', 'not-loaded', 'unconfirmed'].includes(nativeCheck.clientCheck.status));
    assert.equal(nativeCheck.clientCheck.pluginId, 'superpowers@superpowers');
    assert.ok(nativeCheck.clientCheck.message && nativeCheck.clientCheck.checkedAt);
    assert.deepEqual(nativeCheck.inventory, installed.inventory);
    for (const obligation of ['permitted', 'prohibited']) {
      if (obligation === 'prohibited') await post('policy', { ...policy, obligation });
      const inventoryState = (await (await fetch(host.origin + '/api/session')).json()).enterprise;
      assert.deepEqual(inventoryState.installedPolicyChecks.filter(row => row.unit === 'superpowers'), [
        { unit:'superpowers', label:'Superpowers', removalId:pluginId, status:obligation === 'permitted' ? 'allowed' : 'denied' },
      ]);
      checked = await post('check', { mode: 'enterprise' });
      const plugin = checked.checks.find(row => row.unit === 'superpowers');
      assert.equal(plugin.check.fileState, 'match');
      assert.equal(plugin.admission.status, 'ok');
      assert.equal(plugin.admission.value.admitted, obligation === 'permitted');
      if (obligation === 'prohibited') assert.ok(plugin.admission.value.denials.length > 0);
    }
    checks.push('installed Superpowers files still match when the current policy changes from permitted to prohibited');
    const restored = await post('policy', policy);
    assert.equal(restored.installedPolicyChecks.find(row => row.unit === 'superpowers').status, 'allowed');
  }
  const inspection = await post('inspect', { mode: 'vibe' }); assert.equal(inspection.inspection.schema, 'urn:aihq:core:inspection:0.1.0');
  assert.equal(inspection.reportDigest, null, 'Inspection alone must not advertise a downloadable capture');
  const repair = await post('repair', { mode: 'vibe' }); if (inspection.inspection.repairChoices?.length) { assert.ok(repair.repair); assert.match(repair.repairApply,/Not applied/); } else { assert.equal(repair.repair,null); assert.match(repair.repairApply,/not suggested/); }
  checks.push(`offline inspection and real node-npm-ca preparation (${repair.repair?.status || 'not indicated'}), no repair Apply`);
  const report = await post('report', { mode: 'vibe' });
  assert.equal(report.history.at(-1).support.status, 'rendered', JSON.stringify(report.history.at(-1).support));
  assert.ok(report.history.at(-1).support.markdown.length > 30);
  assert.equal(report.report.status, 'ok', JSON.stringify(report.report));
  checks.push('Core report snapshot and rendered guidance/support derived from actual results');
  const diagnosticPath = '/reports/vibe/' + report.reportDigest + '.html';
  const consolePath = '/reports/vibe/' + report.reportDigest + '/console.html';
  const readPage = async path => {
    const response = await fetch(host.origin + path);
    assert.equal(response.status, 200, path);
    return response.text();
  };
  const diagnosticHtml = await readPage(diagnosticPath);
  const subsequentInspection = await post('inspect', {mode:'vibe'});
  assert.equal(subsequentInspection.reportDigest, report.reportDigest, 'A later inspection keeps the last saved report');
  const consoleHtml = await readPage(consolePath);
  for (const html of [diagnosticHtml, consoleHtml]) {
    const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0];
    assert.ok(header.includes('Vibe ·') && header.includes(report.reportDigest), 'Report headers identify the workspace and saved capture');
  }
  const measured = [...diagnosticHtml.matchAll(/<section[^>]*id="(sec-[a-z]+)"[^>]*data-state="live"/g)].map(match => match[1]);
  const links = [...consoleHtml.matchAll(/href="([^"]+\.html)#(sec-[a-z]+)"/g)];
  assert.ok(links.every(match => match[1] === diagnosticPath));
  assert.equal(measured.length, 5);
  assert.deepEqual([...new Set(links.map(match => match[2]))], measured);
  assert.equal(links.length, 2 * measured.length, 'Each linked panel has its own evidence action as well as its map entry');
  assert.equal(consoleHtml.split('<td>Outside snapshot</td>').length - 1, 9);
  assert.match(consoleHtml, /<body data-demo="on">/);
  assert.doesNotMatch(diagnosticHtml, /<body data-demo="on">/);
  const noCapture = await readPage('/reports/enterprise/console.html');
  assert.match(noCapture, /Panel evidence · no capture/);
  assert.doesNotMatch(noCapture, /aria-label="Read captured evidence/);
  assert.equal((await fetch(host.origin + consolePath.replace('/vibe/', '/enterprise/'))).ok, false);
  checks.push('V9 showcase, real diagnostic anchors, residual panel gaps and mode-scoped evidence');
  for (const [path, init, status] of [
    ['/api/prepare', { method: 'POST', headers: { Origin: host.origin, 'Content-Type': 'application/json' }, body: '{"mode":"vibe"}' }, 403],
    ['/api/session', { headers: { Origin: 'https://example.invalid' } }, 403],
    ['/local-worker.mjs', {}, 404], ['/../package.json', {}, 404], ['/api/shell', { method: 'POST' }, 404],
  ]) assert.equal((await fetch(host.origin + path, init)).status, status, path);
  const wrongHost = await new Promise((accept, reject) => { const request = httpRequest(host.origin + '/api/session', { headers: { Host: 'example.invalid' } }, response => { response.resume(); accept(response.statusCode); }); request.on('error', reject); request.end(); });
  assert.equal(wrongHost, 403);
  const html = await (await fetch(host.origin + '/')).text();
  for (const ref of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])) assert.equal((await fetch(new URL(ref, host.origin))).status, 200, ref);
  checks.push('all page script and stylesheet references served over HTTP');
  await post('prepare', { mode: 'vibe', path: 'C:/arbitrary' }, 400);
  const oversized = await fetch(host.origin + '/api/draft', { method: 'POST', headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': session.token }, body: JSON.stringify({ mode: 'vibe', text: 'x'.repeat(70000) }) }); assert.equal(oversized.status, 413);
  checks.push('Host/Origin/session/body/static/action boundaries');
  await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ status: 'passed', workspace, checks, inspection: inspection.inspection, repair: repair.repair, report: report.report, limits: ['No browser automation or visual QA', 'Isolated homes, not personal account configuration', 'No native client loading verified', 'No system trust repair applied'] }, null, 2));
  console.log(JSON.stringify({ status: 'passed', workspace, checks }, null, 2));
} finally { await host.close(); }

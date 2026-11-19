import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPrototypeServer } from './local-server.mjs';

const [consumer, output, sourceCache] = process.argv.slice(2);
if (!consumer || !output) throw Error('Usage: node tools/workbench/check-catalog.mjs <consumer> <existing-output-parent> [pinned-superpowers-source-cache]');
const workspace = await mkdtemp(join(resolve(output), 'catalog-check-'));
const host = await createPrototypeServer({ consumer, workspace, sourceCache });
try {
  const session = await (await fetch(host.origin + '/api/session')).json();
  const catalog = await (await fetch(host.origin + '/api/catalog')).json();
  assert.equal(catalog.data.commit, '7c525bd7d8b6e8a0c756d79f7e29f44ec38bff26');
  assert.equal(catalog.frameworks.length, 13);assert.equal(catalog.items.length, 902);
  assert.equal(catalog.coverage.indexed, 886);assert.equal(catalog.coverage.missing, 16);
  assert.deepEqual([...new Set(catalog.items.map(item => item.kind))].sort(), ['agent','ai-setup','document','hook','mcp','rule','skill']);
  assert.ok(catalog.items.every(item => item.description !== undefined && item.sources && item.availability['claude-code']));
  const post = async (action, input, status = 200) => {
    const response = await fetch(host.origin + '/api/' + action, { method: 'POST', headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': session.token }, body: JSON.stringify({ mode: 'vibe', ...input }) });
    const result = await response.json();assert.equal(response.status, status, JSON.stringify(result));return result;
  };
  const evidence = [];
  // These shared-file items need their full Catalog documents to determine placement.
  for (const [id, status, label] of [
    ['egm.agent.bootstrap_orchestrator', 'ok', 'Placeable'],
    ['extensions.skill.doubt-driven-development', 'ok', 'Placeable'],
    ['pstack.agent.comment-sicko', 'ok', 'Placeable'],
    ['pstack.agent.poteto-agent', 'incomplete', 'Incomplete plan'],
  ]) {
    const availability = catalog.items.find(item => item.id === id).availability['claude-code'];
    const preview = await post('catalog-plan', { items: [id], client: 'claude-code' });
    assert.equal(preview.plan.status, status, id);
    assert.equal(availability.available, status === 'ok', id);
    if (status !== 'ok') assert.equal(availability.label, label, id);
  }
  const tools = catalog.items.filter(item => item.setup);
  const setupIds = tools.map(item => item.id).sort();
  assert.deepEqual(setupIds, ['cbm.ai-setup.codebase-memory-mcp', 'crg.ai-setup.code-review-graph', 'serena.ai-setup.serena']);
  assert.deepEqual(catalog.toolCombination.members.toSorted(), setupIds);
  assert.ok(catalog.toolCombination.overrides[setupIds[0]].disabledTools.includes('search_code'));
  assert.ok(tools.every(item => item.setup.platform && item.setup.version && item.setup.executable && item.setup.mcpItem));
  for (const selection of [[0], [1], [2], [0,1], [0,2], [1,2], [2,1,0]]) {
    const ids = selection.map(index => setupIds[index]);
    const preview = await post('catalog-plan', { items: ids, client: 'claude-code' });
    assert.deepEqual(preview.selection, ids);
    assert.ok(['ok', 'incomplete'].includes(preview.plan.status), JSON.stringify(preview.plan.problems));
    assert.equal(preview.plan.recipe?.id, ids.length === 3 ? catalog.toolCombination.id : undefined);
    if (tools[0].setup.platform === 'windows-x64') {
      assert.equal(preview.plan.status, 'incomplete');
      assert.ok(preview.plan.unavailable.some(issue => issue.cell === 'windows-x64'));
    }
  }
  for (const framework of ['extensions', 'ecc']) {
    const item = catalog.items.find(item => item.framework === framework && item.status === 'indexed');
    const result = await post('catalog-evidence', { itemId: item.id });
    assert.equal(result.scanKey, item.scanKey);assert.equal(result.summary.scanKey, item.scanKey);
    assert.equal(result.status, 'ready', JSON.stringify(result.verification));assert.equal(result.verification.status, 'ok');
    assert.ok(Array.isArray(result.findings));
    assert.equal((await fetch(host.origin + result.summaryUrl)).status, 200);
    for (const asset of result.assets) assert.equal((await fetch(host.origin + asset.url)).status, 200);
    evidence.push({ item: item.id, scanKey: result.scanKey, findings: result.findings.length, verification: result.verification.status });
  }
  const missing = catalog.items.find(item => item.status === 'missing');
  const brainstorming = await post('catalog-evidence', {itemId:'superpowers.skill.brainstorming'});
  const firstLine = brainstorming.findings.find(f => f.ruleId === 'TP4' && f.path === 'SKILL.md' && f.line === 1);
  assert.ok(brainstorming.assets.some(asset => asset.url === firstLine.evidenceUrl));
  assert.equal(firstLine.ruleTitle, 'MCP Tool Poisoning');
  assert.equal(firstLine.sourceUrl, 'https://github.com/obra/superpowers/blob/5bf4e78011075bcfc0dc295f0724994cd123ee71/skills/brainstorming/SKILL.md#L1');
  if (sourceCache) {
    assert.equal(firstLine.excerpt.startLine, 1);
    assert.equal(firstLine.excerpt.lines[0], '---');
  } else assert.equal(firstLine.excerpt, undefined);
  const absent = await post('catalog-evidence', { itemId: missing.id });assert.equal(absent.status, 'missing');assert.equal(absent.scanKey, missing.scanKey);assert.equal(absent.findings.length, 0);
  const selected = catalog.items.find(item => item.framework === 'extensions' && item.kind === 'skill');
  const plan = await post('catalog-plan', { items: [selected.id], client: 'claude-code' });
  assert.equal(plan.execution, 'preview-only');assert.ok(['ok','incomplete','refused','invalid'].includes(plan.plan.status));assert.deepEqual(plan.selection, [selected.id]);
  const contributor = {
    format: 'workbench-profile/2', id: 'workshop-profile', author: 'Workshop author',
    title: 'Requirements workshop', role: 'System analyst', outcome: 'A reviewed brief',
    firstTask: 'Describe one failure and its recovery.', items: [selected.id],
    data: { repository: catalog.data.repository, commit: catalog.data.commit },
    files: [{path:'AGENTS.md', text:'# Workshop\nAsk about failure and recovery.\n'}],
  };
  const previewSelection = (profile, status = 200) => post('profile-preview', {profile, client:'claude-code'}, status);
  const preview = await previewSelection(contributor);
  assert.deepEqual(preview.profile, contributor);
  assert.match(preview.profileDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.plan, plan.plan);
  const shared = JSON.parse(JSON.stringify(preview.profile, null, 2));
  assert.deepEqual((await previewSelection(shared)).plan, preview.plan);
  await previewSelection({...shared, items:['missing-item']}, 400);
  await previewSelection({...shared, data:{...shared.data, commit:'0'.repeat(40)}}, 400);
  await previewSelection({...shared, files:[{path:'../AGENTS.md', text:'outside'}]}, 400);
  await post('policy', {mode:'enterprise', id:'review-team', obligation:'prohibited', allowCustom:false});
  const unlisted = await post('catalog-plan', {mode:'enterprise', items:['anthropic.skill.algorithmic-art'], client:'claude-code'});
  assert.equal(unlisted.policy?.value?.admitted, true, 'An unlisted item from the pinned source can be admitted');
  const prohibited = {...shared, items:[catalog.items.find(item => item.framework === 'superpowers' && item.kind === 'skill').id]};
  const enterprise = await post('profile-preview', {mode:'enterprise', profile:prohibited, client:'claude-code'});
  assert.equal(enterprise.policy?.value?.admitted, false);
  assert.equal((await previewSelection(prohibited)).policy, null);
  const many = await post('catalog-plan', { items: catalog.items.filter(item => item.kind === 'skill').slice(0,101).map(item => item.id), client: 'claude-code' });assert.equal(many.selection.length, 101);
  const after = await (await fetch(host.origin + '/api/session')).json();
  assert.deepEqual(after.enterprise.inventory, session.enterprise.inventory);assert.deepEqual(after.vibe.inventory, session.vibe.inventory);
  assert.deepEqual(after.enterprise.draft, session.enterprise.draft);assert.deepEqual(after.vibe.draft, session.vibe.draft);
  assert.equal(after.vibe.prepared, null);assert.equal(after.enterprise.prepared, null);
  await post('catalog-evidence', { itemId: '../../package.json' }, 400);
  await post('catalog-plan', { items: [selected.id], client: 'unknown-client' }, 400);
  await post('catalog-evidence', { itemId: selected.id, path: 'arbitrary' }, 400);
  assert.equal((await fetch(host.origin + '/catalog-assets/scan/not-indexed.json')).status, 404);
  assert.equal((await fetch(host.origin + '/api/catalog-evidence', { method:'POST',headers:{Origin:host.origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'vibe',itemId:selected.id}) })).status,403);
  const receipt = { status:'passed',workspace,frameworks:catalog.frameworks.length,items:catalog.items.length,coverage:catalog.coverage,evidence,missing:{id:missing.id,scanKey:missing.scanKey,status:absent.status},plan:{status:plan.plan.status,steps:plan.plan.plan?.length,execution:plan.execution},checks:['All pinned document hashes checked against manifest through public Catalog readers','All 13 frameworks / 902 items / 7 kinds include 16 missing assessments','Extensions and ECC exact-key summaries/signatures/findings read on demand with asset digest verification','General public item placement plan, including >100 selected items, remains preview only','No Core inventory/draft/review mutation from evidence or planning','New endpoints retain token/input/fixed-asset boundaries'],limits:['No new source acquisition or generalized Core execution','No browser layout check'] };
  receipt.checks.push('A locally authored profile round-trips with its first task, Markdown and selected items; the saved Enterprise boundary applies independently of Vibe.');
  await writeFile(join(workspace,'acceptance.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
} finally { await host.close(); }

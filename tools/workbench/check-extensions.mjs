import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPrototypeServer } from './local-server.mjs';

// Runs real reviewed native CLI installation, only in a newly-created example workspace.
const [consumer, output, sourceCache, recipeCommit, extensionsSourceCache, extensionsRecipeCommit, expected = 'loaded'] = process.argv.slice(2);
if (!extensionsRecipeCommit || !['loaded','unconfirmed'].includes(expected)) throw Error('Usage: node check-extensions.mjs <consumer> <output-parent> <superpowers-source-cache> <superpowers-recipe-commit> <extensions-source-cache> <extensions-recipe-commit> [loaded|unconfirmed]');
const workspace = await mkdtemp(join(resolve(output), 'extensions-check-'));
const options = { consumer, workspace, sourceCache, recipeCommit, extensionsSourceCache, extensionsRecipeCommit };
let host;
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const stableInventory = entries => entries.filter(entry => entry.framework === 'superpowers').map(entry => ({ ...entry, members:entry.members?.map(({ state, ...member }) => member) })).sort((a,b) => a.managementId.localeCompare(b.managementId));
try {
  host = await createPrototypeServer(options);
  let session = await (await fetch(host.origin + '/api/session')).json();
  const post = async (action, body, expectedStatus = 200) => {
    const response = await fetch(host.origin + '/api/' + action, { method:'POST', headers:{ Origin:host.origin, 'Content-Type':'application/json', 'X-Workbench-Token':session.token }, body:JSON.stringify({ mode:'enterprise', ...body }) });
    const value = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(value));
    return value;
  };
  const apply = prepared => post('apply', { id:prepared.prepared.id, context:prepared.prepared.context, reviewDigest:prepared.prepared.result.review.reviewDigest });
  const policy = obligation => post('policy', { id:'extensions-check', obligation:'permitted', allowCustom:true, frameworkRules:{ extensions:obligation } });
  await post('check-claude', { unit:'extensions' }, 400);
  await policy('prohibited');
  await post('draft', { choices:{ extensions:true, superpowers:false, instructions:false }, text:'Use the project conventions.' });
  const denied = await post('prepare', { unit:'extensions' });
  assert.equal(denied.prepared.applyAllowed, false);
  assert.equal(denied.inventory.entries.length, 0);
  await policy('permitted');
  await post('draft', { choices:{ extensions:false, superpowers:true, instructions:false }, text:'Use the project conventions.' });
  let prepared = await post('prepare', { unit:'superpowers' });
  assert.equal(prepared.prepared.result.status, 'ready');
  let installed = await apply(prepared);
  assert.equal(installed.outcome.completion, 'complete');
  const before = { policy:await readFile(join(workspace,'enterprise','organization.json'),'utf8'), intent:await readJson(join(workspace,'enterprise','intent.json')), inventory:stableInventory(installed.inventory.entries) };
  await post('draft', { choices:{ extensions:true, superpowers:true, instructions:false }, text:'Use the project conventions.' });
  prepared = await post('prepare', { unit:'extensions' });
  assert.equal(prepared.prepared.result.status, 'ready');
  assert.equal(prepared.prepared.applyAllowed, true);
  assert.equal(prepared.prepared.result.review.organization.admitted, true);
  const commands = prepared.prepared.result.review.steps.flatMap(step => step.commands || []);
  assert.equal(commands.length, 2);
  assert.ok(commands.every(command => command.argv.at(-2) === '--scope' && command.argv.at(-1) === 'project'));
  assert.deepEqual(prepared.prepared.nativePlugin.hooks.map(hook => hook.name).sort(), ['git-guard','lanes-card','skill-guard']);
  assert.equal(prepared.prepared.nativePlugin.scope, 'project');
  installed = await apply(prepared);
  assert.equal(installed.outcome.completion, 'complete');
  await post('apply', { id:prepared.prepared.id, context:prepared.prepared.context, reviewDigest:prepared.prepared.result.review.reviewDigest }, 409);
  const checked = await post('check', {});
  const extensionCheck = checked.checks.find(row => row.unit === 'extensions');
  assert.equal(extensionCheck.check.fileState, 'match');
  assert.equal(extensionCheck.admission.value.admitted, true);
  assert.equal(await readFile(join(workspace,'enterprise','organization.json'),'utf8'), before.policy);
  assert.deepEqual((await readJson(join(workspace,'enterprise','intent.json'))).requests.superpowers, before.intent.requests.superpowers);
  assert.deepEqual(stableInventory(installed.inventory.entries), before.inventory);
  const settings = await readJson(join(workspace,'enterprise','project','.claude','settings.json'));
  assert.equal(settings.enabledPlugins['superpowers@superpowers'], true);
  assert.equal(settings.enabledPlugins['aih-extensions@aihq-extensions'], true);
  assert.ok(settings.extraKnownMarketplaces.superpowers);
  const superpowers = result => result.checks.find(row => row.unit === 'superpowers');
  const matching = superpowers(checked);
  assert.equal(matching.check.fileState, 'match', 'another plugin can share and reformat Claude settings');
  assert.equal(matching.explanation.label, 'Matches');
  const settingsPath = join(workspace, 'enterprise', 'project', '.claude', 'settings.json');
  const originalSettings = await readFile(settingsPath);
  try {
    settings.enabledPlugins['superpowers@superpowers'] = false;
    await writeFile(settingsPath, JSON.stringify(settings));
    const disabled = superpowers(await post('check', {}));
    assert.equal(disabled.check.fileState, 'changed');
    assert.match(disabled.explanation.title, /enabled setting changed/i);
    settings.enabledPlugins['superpowers@superpowers'] = true;
    settings.extraKnownMarketplaces.superpowers.source.path = './another-marketplace';
    await writeFile(settingsPath, JSON.stringify(settings));
    const redirected = superpowers(await post('check', {}));
    assert.match(redirected.explanation.title, /marketplace setting changed/i);
    await writeFile(settingsPath, '{');
    const unreadable = superpowers(await post('check', {}));
    assert.equal(unreadable.explanation.label, 'Check incomplete');
  } finally { await writeFile(settingsPath, originalSettings); }
  const native = await post('check-claude', { unit:'extensions' });
  assert.equal(native.clientCheck.status, expected, JSON.stringify(native.clientCheck));
  assert.equal(native.clientCheck.pluginId, 'aih-extensions@aihq-extensions');
  if (expected === 'loaded') assert.equal(native.clientCheck.evidence.matchedFiles, 149);
  await host.close(); host = null;
  host = await createPrototypeServer(options);
  session = await (await fetch(host.origin + '/api/session')).json();
  const cold = await post('check-claude', { unit:'extensions' });
  assert.equal(cold.clientCheck.status, expected, JSON.stringify(cold.clientCheck));
  assert.ok(session.enterprise.inventory.entries.some(entry => entry.framework === 'extensions' && entry.plugins?.length));
  let alteredCache, disabled;
  if (expected === 'loaded') {
    const cacheReadme = join(cold.clientCheck.evidence.path, 'README.md');
    const bytes = await readFile(cacheReadme);
    try {
      await writeFile(cacheReadme, Buffer.concat([bytes, Buffer.from('\nDisposable regression edit.\n')]));
      alteredCache = (await post('check-claude', { unit:'extensions' })).clientCheck;
      assert.equal(alteredCache.status, 'unconfirmed', JSON.stringify(alteredCache));
    } finally { await writeFile(cacheReadme, bytes); }
    const settingsPath = join(workspace,'enterprise','project','.claude','settings.json');
    const settingsBytes = await readFile(settingsPath);
    try {
      const value = JSON.parse(settingsBytes);
      value.enabledPlugins['aih-extensions@aihq-extensions'] = false;
      await writeFile(settingsPath, JSON.stringify(value,null,2));
      disabled = (await post('check-claude', { unit:'extensions' })).clientCheck;
      assert.equal(disabled.status, 'not-loaded', JSON.stringify(disabled));
    } finally { await writeFile(settingsPath, settingsBytes); }
  }
  const evidence = { status:'passed', workspace, recipe:extensionsRecipeCommit, native:cold.clientCheck, alteredCache, disabled, checks:checked.checks.map(row => ({ unit:row.unit, fileState:row.check.fileState, observation:row.check.observation, admitted:row.admission?.value?.admitted })), preserved:'Superpowers files and managed settings match after native installation of AIH Extensions.' };
  await writeFile(join(workspace,'acceptance.json'), JSON.stringify(evidence,null,2));
  await writeFile(join(workspace,'extensions-prepared.json'), JSON.stringify(prepared,null,2));
  console.log(JSON.stringify(evidence));
} finally { await host?.close(); }

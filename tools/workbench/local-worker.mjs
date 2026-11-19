import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadPublic } from './local-packages.mjs';
import { createReportRenderer } from '../../src/report/render.js';
import { createExtensionsInstaller } from './local-extensions.mjs';
import { developerConsole, enableReportKeyboard } from './developer-console.mjs';

const [consumer, root, mode] = process.argv.slice(2);
const project = join(root, 'project'), policyPath = join(root, 'organization.json');
await mkdir(project, { recursive: true });
const { api: core } = await loadPublic(consumer, '@aihq/core', '.');
const { api: harnessRuntime } = await loadPublic(consumer, '@aihq/core', './harness/runtime');
const { api: contracts } = await loadPublic(consumer, '@aihq/core', './contracts');
function readResult(result, field) {
  if (result.status !== 'ok') throw Error('Core refused the diagnostic snapshot: ' + result.status);
  return result[field];
}
const renderV9 = createReportRenderer({
  importSnapshot: json => readResult(contracts.importSnapshot(json), 'snapshot'),
  exportSnapshot: snapshot => readResult(contracts.exportSnapshot(snapshot), 'json'),
});
// Keep the downloaded report self-contained, including its reading preference.
function withReportPreferences(html, digest) {
  const style = `<style>
    :root { scrollbar-color:var(--muted) transparent; scrollbar-width:thin; }
    :root:has(#wide-report-bars:checked) { scrollbar-width:auto; }
    .report-scroll-option {display:inline-flex;align-items:center;gap:.3rem;color:var(--muted);font:inherit;font-size:.72rem}
    @supports selector(::-webkit-scrollbar) {
      :root, .palette-list, .sankey-wrap {scrollbar-width:auto;scrollbar-color:auto}
      *::-webkit-scrollbar {width:8px;height:8px}
      :root:has(#wide-report-bars:checked)::-webkit-scrollbar,
      :root:has(#wide-report-bars:checked) *::-webkit-scrollbar {width:16px;height:16px}
      *::-webkit-scrollbar-track {background:var(--surface)}
      *::-webkit-scrollbar-thumb {background:var(--muted);border:2px solid var(--surface);border-radius:8px}
      *::-webkit-scrollbar-button {display:none}
    }
    .palette-list {resize:vertical;min-height:5rem;max-height:70vh}
    @media(max-width:600px){.report-scroll-option span{display:none}}
    </style>`;
  const option = '<label class="report-scroll-option" title="Wider scrollbars"><input type="checkbox" id="wide-report-bars" aria-label="Wider scrollbars"><span>Wider scrollbars</span></label>';
  const scope = mode === 'enterprise' ? 'Enterprise' : 'Vibe';
  const capture = digest ? '<span title="SHA-256 '+digest+'">Saved capture <code>'+digest.slice(0,12)+'</code></span>' : '<span>No saved capture</span>';
  const identity = '<div class="report-identity" style="margin:.25rem 0;color:var(--muted);font-size:.8rem">'+scope+' · '+capture+'</div>';
  return html.replace('</head>', style + '</head>').replace('<div class="tb-right">', '<div class="tb-right">' + option)
    .replace('<div class="brand-text">', '<div class="brand-text">'+identity)
    .replace('</body>', () => '<script>(' + enableReportKeyboard.toString() + ')();</script></body>');
}
const { api: harness } = await loadPublic(consumer, '@aihq/core', './harness/runtime');
const { api: reader, version } = await loadPublic(consumer, '@aihq/catalog', './reader');
const { api: catalogContracts } = await loadPublic(consumer, '@aihq/catalog', './contracts');
const { api: catalogNode } = await loadPublic(consumer, '@aihq/catalog', './node');
const here = dirname(fileURLToPath(import.meta.url));
const catalogInput = JSON.parse(await readFile(join(consumer, 'public', 'catalog.json'), 'utf8'));
const provenance = JSON.parse(await readFile(join(consumer, 'public', 'provenance.json'), 'utf8'));
const contentText = catalogInput.documents.find(text => JSON.parse(text).framework.id === 'superpowers');
const parsed = reader.readContent(Buffer.from(contentText));
const extensionsInstaller = await createExtensionsInstaller({ consumer, root, recipeCommit: process.env.AIH_EXTENSIONS_RECIPE_COMMIT, sourceCache: process.env.AIH_EXTENSIONS_SOURCE_CACHE || undefined });
if (parsed.status !== 'ok') throw Error('Catalog snapshot rejected');
const content = parsed.content;
const snapshot = { framework: content.sources.find(source => source.id === 'superpowers'), catalog: catalogInput.data, packages: provenance.packages };
const profileRead = reader.readToolProfile(new TextEncoder().encode(catalogContracts.toolProfiles['claude-code']));
if (profileRead.status !== 'ok') throw Error('Catalog profile rejected');
const profile = profileRead.profile;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value, (key, val) => ['handle', 'prepared'].includes(key) ? undefined : val));
const controls = request => ({ logging: 'off', ...(request?.schema === 'urn:aihq:core:plan-request:0.1.0' ? { catalog: { version, renderStep: reader.renderStep, planRecipe: reader.planRecipe } } : {}), ...(mode === 'enterprise' ? { organization: { provider: 'local', path: policyPath } } : {}) });
const change = {
  schema: 'urn:aihq:core:change:0.1.0', id: 'example-project-instructions',
  description: 'Independently authored project instructions, editable through one declared input.',
  inputs: { text: { type: 'string', required: true, maxLength: 12000 } }, materials: [], targets: ['project'], prerequisites: [],
  operations: [{ id: 'instructions', purpose: 'Write the project instructions', kind: 'file.write', scope: 'project', requires: [], checks: [], target: { root: 'project', segments: [{ literal: 'CLAUDE.md' }] }, content: { input: 'text' } }], checks: [],
};
const identity = await contracts.deriveChangeIdentity({ change });
if (identity.status !== 'ok') throw Error(JSON.stringify(identity));
const target = { project, client: { id: 'claude-code', surface: 'cli' }, repository: 'https://example.invalid/docs-site' };
let organization = null, generation = 0, review = null, lastRequest = null, requests = {};
let draft = { choices: { instructions: false, superpowers: false, extensions: false }, text: 'Use the project conventions. Review changes before committing.' };
let history = [], inspection = null, repair = null, sourceResult = null, latestReport = null;
const reportsDirectory = join(root, 'reports');
const latestCapturePath = join(reportsDirectory, 'latest.json');
try {
  const saved = JSON.parse(await readFile(latestCapturePath, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(saved.digest)) throw Error('Invalid saved report identifier');
  const snapshot = await readSnapshot(saved.digest);
  latestReport = {status:'ok', snapshot};
  if (saved.inspection) inspection = saved.inspection;
  if (saved.repair) repair = saved.repair;
  if (Array.isArray(saved.history)) history = saved.history;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
async function readSnapshot(digest) {
  const snapshot = JSON.parse(await readFile(join(reportsDirectory, digest + '.json'), 'utf8'));
  if (hash(snapshot) !== digest) throw Error('Saved diagnostic snapshot content changed.');
  return snapshot;
}
async function saveCapture(report) {
  const digest = hash(report.snapshot);
  await mkdir(reportsDirectory, {recursive:true});
  const snapshotPath = join(reportsDirectory, digest + '.json');
  await writeFile(snapshotPath + '.tmp', JSON.stringify(report.snapshot));
  await rename(snapshotPath + '.tmp', snapshotPath);
  await writeFile(latestCapturePath + '.tmp', JSON.stringify({digest, inspection, repair, history}));
  await rename(latestCapturePath + '.tmp', latestCapturePath);
}
const journal = join(root, 'policy-reviews');
const policyDigest = () => organization && createHash('sha256').update(JSON.stringify(organization, null, 2)).digest('hex');
let reviews = [];
if (mode === 'enterprise') {
  const { readdir } = await import('node:fs/promises');
  await mkdir(journal, { recursive: true });
  for (const name of (await readdir(journal)).filter(name => name.endsWith('.json')).sort()) {
    reviews.push(JSON.parse(await readFile(join(journal, name), 'utf8')));
  }
}
try { organization = JSON.parse(await readFile(policyPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { const saved = JSON.parse(await readFile(join(root, 'intent.json'), 'utf8')); draft = saved.draft; lastRequest = saved.lastRequest; requests = saved.requests || (lastRequest ? { [lastRequest.schema.includes('change-request') ? 'instructions' : 'superpowers']: lastRequest } : {}); } catch (error) { if (error.code !== 'ENOENT') throw error; }
draft.choices = { instructions: false, superpowers: false, extensions: false, ...draft.choices };
const requestUnit = request => request.schema.includes('change-request') ? 'instructions' : request.contents?.some(content => content.framework.id === 'extensions') ? 'extensions' : 'superpowers';
const instructionsRequest = () => ({ schema: 'urn:aihq:core:change-request:0.1.0', mode, scope: 'project', target, changes: [{ managementId: 'project-instructions', change, inputs: { text: draft.text }, requires: [] }] });

const pluginJson = await readFile(join(here, 'local-superpowers-plugin.json'), 'utf8');
const recipeJson = await readFile(join(here, 'local-superpowers-recipe.json'), 'utf8');
const recipeRead = reader.readRecipe(Buffer.from(pluginJson), Buffer.from(recipeJson));
if (recipeRead.status !== 'ok') throw Error(JSON.stringify(recipeRead));
if (process.env.AIH_SOURCE_CACHE) {
  const cached = JSON.parse(await readFile(process.env.AIH_SOURCE_CACHE, 'utf8'));
  if (cached.status !== 'ok' || cached.source?.commit !== snapshot.framework.commit || cached.source?.repository !== snapshot.framework.repository) throw Error('Source cache is not the pinned Catalog source');
  sourceResult = { ...cached, files: cached.files.map(file => ({ ...file, ...(file.bytes ? { bytes: Buffer.from(file.bytes.data, 'base64') } : {}) })) };
}
async function superpowersRequest() {
  const authored = recipeRead.recipe;
  const commit = process.env.AIH_RECIPE_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit || '')) return { result: { status: 'refused', reason: 'Local Workbench-authored recipe needs the UI commit containing it. Start the host with --recipe-commit <local commit>; no upstream recipe origin is claimed.' } };
  const recipeSource = { repository: 'https://github.com/samartomar/aih-ui', commit };
  const choices = { hooks: ['superpowers.hook.session-start'] };
  const plan = reader.planRecipe(authored, [content], [profile], choices, { scope: 'project', source: recipeSource, data: authored.data });
  if (plan.status !== 'ok') return { result: { ...plan, stage: 'catalog-plan' } };
  if (!sourceResult || sourceResult.status !== 'ok') {
    const fetchDir = join(root, 'acquisition'); await mkdir(fetchDir, { recursive: true });
    sourceResult = await catalogNode.fetchSource({ kind: 'git', repository: snapshot.framework.repository, ref: snapshot.framework.commit }, { outDir: fetchDir, timeoutMs: 60000 });
  }
  if (sourceResult.status !== 'ok') return { result: { status: sourceResult.status, stage: 'catalog-source', plan, source: clean(sourceResult) } };
  const filesByPath = new Map(sourceResult.files.map(file => [file.path, file]));
  const refs = new Map();
  for (const step of plan.plan) if (step.from) refs.set(`${step.from.sourceId}\0${step.from.sourcePath}`, step.from);
  const files = [];
  for (const ref of refs.values()) {
    const file = filesByPath.get(ref.sourcePath);
    if (!file?.bytes || file.sha256 !== ref.sha256) return { result: { status: 'refused', code: 'SOURCE_MISMATCH', reason: 'Pinned source does not supply a plan member', path: ref.sourcePath, plan } };
    files.push({ sourceId: ref.sourceId, sourcePath: ref.sourcePath, sha256: ref.sha256, bytes: file.bytes });
  }
  return { request: { schema: 'urn:aihq:core:plan-request:0.1.0', mode, scope: 'project', target, plan, contents: [content], profiles: [profile], files, recipeProof: { pluginJson, recipeJson, choices, options: { data: authored.data } } } };
}
async function inventory() { return core.list({ target: { project }, scope: 'project' }); }
async function currentAdmission(saved, installed) {
  if (!organization || !saved) return null;
  // File checks use source bytes. Admission takes only the references.
  const request = saved.files
    ? { ...saved, files: saved.files.map(({ bytes, ...reference }) => reference) }
    : saved;
  return contracts.previewAdmission({ organization, request, installed });
}
async function installedPolicyChecks(installed) {
  if (mode !== 'enterprise' || !organization) return [];
  const units = new Map();
  for (const entry of installed.entries || []) {
    const pluginFramework = ['extensions', 'superpowers'].find(framework => entry.framework === framework || entry.items?.some(id => id.startsWith(framework + '.')));
    const isPlugin = !!pluginFramework;
    const unit = isPlugin ? pluginFramework : entry.managementId === 'project-instructions' ? 'instructions' : entry.managementId;
    if (!units.has(unit)) {
      const label = isPlugin ? pluginFramework === 'extensions' ? 'AIH Extensions' : 'Superpowers' : unit === 'instructions' ? 'Project instructions' : entry.managementId;
      units.set(unit, { unit, label, removalId: null });
    }
    if (!isPlugin || entry.localPlugin || entry.plugins?.length) units.get(unit).removalId = entry.managementId;
  }
  return Promise.all([...units.values()].map(async row => {
    const result = await currentAdmission(Object.hasOwn(requests, row.unit) ? requests[row.unit] : null, installed);
    const status = result?.status !== 'ok' ? 'unknown' : result.value.admitted ? 'allowed' : 'denied';
    return { ...row, status };
  }));
}
function invalidate() { review = null; generation++; }
async function persist() { await writeFile(join(root, 'intent.json'), JSON.stringify({ draft, lastRequest, requests }, (key, value) => key === 'bytes' ? undefined : value, 2)); }
function remember(kind, result, extra = {}) {
  const input = { kind, result: clean(result), ...extra };
  const guidance = contracts.getGuidance(input, { platform: process.platform });
  const support = contracts.renderSupportMarkdown(input, { platform: process.platform });
  history.push({ sequence: history.length + 1, at: new Date().toISOString(), kind, result: clean(result), guidance, support });
  if (history.length > 20) history.shift();
}
async function diagnosticReport() {
  const diagnostic = await harness.diagnose({ requestId: randomUUID(), targets: ['node', 'git'], network: 'off', project });
  return contracts.createReport({ diagnostic, producer: { name: '@aihq/core', version: '0.0.0-dev.1', revision: snapshot.packages.find(item => item.name === '@aihq/core')?.revision || null }, observedAt: new Date().toISOString(), acquisition: 'newly-acquired', redaction: { homePaths: [root] } });
}
async function state() {
  const installed = await inventory();
  return { mode, connectedFramework: { unit:'extensions', id:'extensions', name:'AIH Extensions', version:'0.6.0', plugin:'aih-extensions' }, extensionsDerivation:extensionsInstaller.derivation(), project, home: process.env.USERPROFILE || process.env.HOME, organization, policyDigest: policyDigest(), reviews, generation, draft, inventory: installed, installedPolicyChecks: await installedPolicyChecks(installed), prepared: review ? { id: review.id, context: review.context, result: clean(review.result), operation: review.operation, applyAllowed: review.applyAllowed, nativePlugin: review.nativePlugin } : null, history, inspection, repair, report: latestReport, reportDigest: latestReport?.status === 'ok' ? hash(latestReport.snapshot) : null, source: sourceResult ? { status: sourceResult.status, reason: sourceResult.reason, commit: sourceResult.source?.commit } : null };
}
async function storePrepared(result, operation, request, allowNative = false) {
  const context = hash({ draft, organization, generation });
  // Only the connected native Extensions route may approve its reviewed client commands.
  const program = result.review?.steps?.some(step => ['run-program', 'opaque-process'].includes(step.effect) || step.commands?.length);
  review = { id: randomUUID(), context, result, operation, request, applyAllowed: !!result.handle && (!program || allowNative) };
  const native = request?.plan?.plan?.find(step => step.op === 'plugin' && step.framework === 'extensions');
  if (native && result.review?.steps?.some(step => step.op === 'plugin' && step.plugin === native.plugin && step.commit === native.commit)) {
    const content = request.contents.find(content => content.framework.id === native.framework);
    const plugin = content?.plugins?.find(plugin => plugin.scanKey === native.scanKey);
    if (plugin) review.nativePlugin = { repository: native.repository, commit: native.commit, scope: request.scope,
      hooks: content.items.filter(item => item.kind === 'hook' && request.recipeProof?.choices?.hooks?.includes(item.id)).map(item => ({ id:item.id, name:item.name, event:item.event })) };
  }
  remember('prepare', result);
  return { ...await state(), containment: program ? allowNative ? 'This review runs the exact native Claude plugin commands shown below in the isolated workspace account. Apply is your separate approval.' : 'This review executes a native client program outside the connected Extensions installation. Review it separately in the intended client environment.' : null };
}
async function dispatch(action, body) {
  if (action === 'render-v9' || action === 'render-console') {
    try {
      const snapshot = body.digest ? await readSnapshot(body.digest) : null;
      if (action === 'render-console') {
        const projected = snapshot && readResult(contracts.importSnapshot(
          readResult(contracts.exportSnapshot(snapshot), 'json')
        ), 'snapshot');
        return withReportPreferences(developerConsole(projected, '/reports/'+mode+'/'+body.digest+'.html'), body.digest);
      }
      return withReportPreferences(renderV9(snapshot, {title:'Workbench diagnostic report'}), body.digest);
    }
    catch (error) { if (error.code === 'ENOENT') throw Error('No saved snapshot for this report.'); throw error; }
  }
  if (action === 'record-review') {
    if (mode !== 'enterprise' || !organization || body.digest !== policyDigest() ||
      createHash('sha256').update(await readFile(policyPath)).digest('hex') !== body.digest)
      throw Error('Saved policy changed. Refresh and review the current revision.');
    const { company, reviewer, team, note, decision, evidence } = body;
    const entry = { id:randomUUID(), recordedAt:new Date().toISOString(), company, reviewer, team, decision, note,
      attribution:'Self-declared local reviewer', policyId:organization.id, policySha256:body.digest, evidence };
    const filename = entry.recordedAt.replaceAll(':','-') + '-' + entry.id + '.json';
    const temporary = join(journal, filename + '.tmp');
    await writeFile(temporary, JSON.stringify(entry, null, 2), {flag:'wx'});
    await rename(temporary, join(journal, filename));
    reviews.push(entry);
    return state();
  }
  if (action === 'profile-admission') {
    if (!organization) return { policy: null, policyNote: 'Save an organization policy to check this plan.' };
    const request = { ...body, schema: 'urn:aihq:core:plan-request:0.1.0', mode, scope: 'project', target };
    const policy = await contracts.previewAdmission({ organization, request, installed: await inventory() });
    return { policy, policyNote: 'Saved policy ' + organization.id + ' · admission applies to the planned Catalog steps.' };
  }
  if (action === 'state') return state();
  if (action === 'draft') { invalidate(); draft = { ...body, choices: { ...draft.choices, ...body.choices } }; await persist(); return state(); }
  if (action === 'policy' || action === 'policy-preview') {
    const policy = { schema: 'urn:aihq:core:organization:0.1.0', id: body.id, entries: [{ id: 'superpowers-framework', obligation: body.obligation, scopes: ['project'], clients: ['claude-code'], content: { framework: 'superpowers' } }, { id: 'project-instructions', obligation: body.allowCustom ? 'permitted' : 'prohibited', scopes: ['project'], clients: ['claude-code'], change: { identity: identity.changeIdentity }, inputs: { text: { allowDeclared: true } }, lifecycle: { replace: true, adopt: false, remove: true } }], sources: { published: [{ repository: snapshot.catalog.repository, commit: snapshot.catalog.commit }] } };
    for (const [framework, obligation] of Object.entries(body.frameworkRules || {})) {
      policy.entries.push({id:'catalog-framework-' + framework, obligation, scopes:['project'], clients:['claude-code'], content:{framework}});
    }
    const validation = contracts.validateOrganizationPolicy(policy);
    if (validation.status !== 'ok') return { validation };
    if (action === 'policy-preview') return { validation, policy: validation.value };
    await writeFile(policyPath + '.tmp', JSON.stringify(validation.value, null, 2));
    await rename(policyPath + '.tmp', policyPath);
    organization = validation.value; invalidate();
    return { ...await state(), validation };
  }
  if (action === 'prepare') {
    invalidate();
    const chosen = ['extensions','superpowers','instructions'].filter(unit => draft.choices[unit]);
    const selected = body.unit || (chosen.length === 1 ? chosen[0] : null);
    if (!selected || !draft.choices[selected]) return { ...await state(), outcome: { status: 'refused', reason: 'Choose the selected unit to review. Units are prepared independently; other selections stay chosen.' } };
    const built = selected === 'extensions' ? await extensionsInstaller.request({ mode, target, profile }) : selected === 'superpowers' ? await superpowersRequest() : { request: instructionsRequest() };
    if (built.result) return { ...await state(), outcome: built.result };
    const request = built.request, current = await inventory();
    const ids = selected === 'instructions' ? ['project-instructions'] : current.entries?.filter(entry => entry.framework === selected).map(entry => entry.managementId) || [];
    const installed = current.entries?.some(entry => ids.includes(entry.managementId));
    const result = installed ? await core.prepareUpdate({ target: { project }, scope: 'project', updates: [{ managementIds: ids, request }] }, controls(request)) : await core.prepare(request, controls(request));
    return storePrepared(result, installed ? 'update' : 'install', request, selected === 'extensions');
  }
  if (action === 'remove') {
    invalidate();
    const current = await inventory();
    if (!current.entries?.some(entry => entry.managementId === body.managementId)) throw Object.assign(Error('Unknown managed unit'), { code: 'UNKNOWN_UNIT' });
    const result = await core.prepareRemoval({ mode, target, scope: 'project', removals: [{ managementId: body.managementId }] }, controls());
    const removedEntry = current.entries.find(entry => entry.managementId === body.managementId);
    const prepared = await storePrepared(result, 'remove', null, removedEntry.framework === 'extensions' && !!removedEntry.plugins?.length);
    const removedFramework = current.entries.find(entry => entry.managementId === body.managementId)?.framework;
    review.removedUnit = ['extensions','superpowers'].includes(removedFramework) ? removedFramework : body.managementId === 'project-instructions' ? 'instructions' : null;
    return prepared;
  }
  if (action === 'apply') {
    const selected = review;
    if (!selected || selected.id !== body.id || selected.context !== body.context || selected.result.review?.reviewDigest !== body.reviewDigest || hash({ draft, organization, generation }) !== selected.context) throw Object.assign(Error('Review changed or was already used. Prepare again.'), { code: 'REVIEW_STALE' });
    if (!selected.applyAllowed) throw Object.assign(Error('No applicable project-file handle in this review'), { code: 'APPLY_UNAVAILABLE' });
    review = null; generation++;
    const result = await core.apply(selected.result.handle, { approved: true, origin: 'interactive', reviewDigest: body.reviewDigest }, controls(selected.request));
    if (selected.request && result.completion === 'complete') {
      lastRequest = selected.request;
      requests[requestUnit(selected.request)] = selected.request;
      await persist();
    }
    if (selected.operation === 'remove' && result.completion === 'complete') {
      const remaining = await inventory();
      const stillPresent = selected.removedUnit === 'instructions' ? remaining.entries.some(entry => entry.managementId === 'project-instructions') : remaining.entries.some(entry => entry.framework === selected.removedUnit || entry.items?.some(item => item.startsWith(selected.removedUnit + '.')));
      if (selected.removedUnit && !stillPresent) delete requests[selected.removedUnit];
      lastRequest = Object.values(requests).at(-1) || null; await persist();
    }
    remember('run', result);
    return { ...await state(), outcome: clean(result), memberClaims: contracts.runMemberClaims(result) };
  }
  if (action === 'check-claude') {
    const current = await state();
    const supported = entry => entry.localPlugin || entry.plugins?.some(plugin => plugin.cli === 'claude-code');
    const requestedUnit = body.unit || (current.inventory.entries?.some(entry => entry.framework === 'extensions' && supported(entry)) ? 'extensions' : 'superpowers');
    const installed = current.inventory.entries?.find(entry => entry.framework === requestedUnit && supported(entry));
    if (!installed) {
      throw Object.assign(Error('Install the selected connected plugin in this project before checking it.'), { code: 'PLUGIN_NOT_INSTALLED' });
    }
    const prefix = '/enabledPlugins/';
    const setting = installed.members?.find(member => member.kind === 'config-entry' && member.clis?.includes('claude-code') && member.pointer?.startsWith(prefix));
    const saved = requests[requestedUnit];
    const native = saved?.plan?.plan?.find(step => step.op === 'plugin' && step.cli === 'claude-code' && step.framework === installed.framework && installed.plugins?.some(receipt => receipt.step === saved.plan.plan.indexOf(step) && receipt.plugin === step.plugin && receipt.commit === step.commit));
    const pluginId = native ? native.plugin + '@' + native.marketplaceName : setting?.pointer.slice(prefix.length);
    let status = 'unconfirmed', message = 'The install record has no Claude Code plugin ID.';
    let evidence = null;
    if (pluginId && typeof harnessRuntime.observeClaudePlugins !== 'function') {
      message = 'This Core build cannot read Claude Code’s loaded plugins. Use the Core build with the project plugin check.';
    } else if (pluginId) {
      const readback = await harnessRuntime.observeClaudePlugins({ project, home: join(root, 'home') });
      if (readback.status === 'observed') {
        const pluginName = pluginId.slice(0, pluginId.lastIndexOf('@'));
        const matches = readback.plugins.filter(plugin => plugin.source === pluginId && plugin.name === pluginName);
        const manifest = installed.localPlugin?.files?.find(file => file.endsWith('/.claude-plugin/plugin.json'));
        const expectedFolder = manifest && await realpath(join(project, dirname(dirname(manifest)))).catch(() => null);
        const observedFolders = await Promise.all(matches.filter(plugin => isAbsolute(plugin.path)).map(plugin => realpath(plugin.path).catch(() => null)));
        let nativeMatch = false;
        if (native) {
          const expected = saved.contents?.find(content => content.framework.id === installed.framework)?.plugins?.find(plugin => plugin.scanKey === native.scanKey)?.files;
          const cache = await realpath(join(root, 'home', '.claude', 'plugins', 'cache')).catch(() => null);
          for (const folder of observedFolders.filter(Boolean)) {
            const path = cache && relative(cache, folder);
            if (!cache || !path || path === '..' || path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(path)) continue;
            const actual = catalogNode.readLocalSource(folder);
            if (expected?.length && actual.status === 'ok' && actual.files.length === expected.length && expected.every(file => actual.files.some(candidate => candidate.path === file.sourcePath && candidate.sha256 === file.sha256 && candidate.bytes))) {
              nativeMatch = true;
              evidence = { source:native.repository, commit:native.commit, scanKey:native.scanKey, matchedFiles:expected.length, path:folder };
              break;
            }
          }
        }
        if (nativeMatch || expectedFolder && observedFolders.some(folder => folder && relative(expectedFolder, folder) === '')) {
          status = 'loaded';
          message = nativeMatch ? 'Claude Code reported ' + pluginId + ' as loaded. All ' + evidence.matchedFiles + ' files in its native cache match the pinned plugin reviewed for this project.' : 'Claude Code reported ' + pluginId + ' as loaded from this project’s installed plugin folder.';
        } else if (matches.length) {
          message = 'Claude Code reported ' + pluginId + ', but its loaded folder could not be matched to this installation.';
        } else {
          status = 'not-loaded';
          message = 'Claude Code returned its loaded plugins for this project. ' + pluginId + ' was absent.';
        }
      } else {
        const reasons = {
          'client-unavailable': 'Claude Code could not be found on this machine.',
          'platform-unsupported': 'This check currently runs on Windows.',
          'plugin-errors': 'Claude Code reported errors while reading its plugins.',
          'deadline': 'Claude Code took too long to answer.',
          'managed-settings-unconfirmed': 'Core could not verify the machine’s managed Claude Code settings.',
        };
        message = 'Claude Code could not confirm whether ' + pluginId + ' loaded. ' +
          (reasons[readback.reason] ?? 'Core could not verify a complete response for this project.');
      }
    }
    return { ...current, clientCheck: { status, message, pluginId, framework:installed.framework, evidence, scope:'Plugin readback only: no user prompt, model turn, hooks or MCP servers are run.', checkedAt: new Date().toISOString() } };
  }
  if (action === 'check') {
    const installed = await inventory(), checks = [];
    for (const [unit, saved] of Object.entries(requests)) {
      // Persisted intent excludes source bytes. Restore only members in the exact pinned
      // Catalog acquisition cache; check never acquires new content from the network.
      const request = saved.files ? { ...saved, files: saved.files.map(file => ({ ...file, bytes: file.bytes || (unit === 'extensions' ? extensionsInstaller.files() : sourceResult?.files)?.find(source => source.path === file.sourcePath && source.sha256 === file.sha256)?.bytes })) } : saved;
      const checkControls = request.schema === 'urn:aihq:core:plan-request:0.1.0' ? { catalog: controls(request).catalog } : {};
      const result = await core.checkFiles(request, checkControls);
      const admission = await currentAdmission(saved, installed);
      checks.push({ unit, check: result, admission });
    }
    const result = checks.at(-1) || { check: { status: 'refused', reason: 'No completed request retained in this workspace.' }, admission: null };
    return { ...await state(), ...result, checks, coverage: { retainedUnits: checks.map(row => row.unit), untrackedInventory: installed.entries.filter(entry => !Object.values(requests).some(request => request.changes?.some(change => change.managementId === entry.managementId) || request.plan && (entry.framework === requestUnit(request) || entry.items?.some(item => item.startsWith(requestUnit(request) + '.'))))).map(entry => entry.managementId) } };
  }
  if (action === 'inspect') {
    inspection = await core.inspect({ target: ['node', 'npm', 'git'], offline: true, project }); remember('inspect', inspection);
    return state();
  }
  if (action === 'repair') {
    const request = { schema: 'urn:aihq:core:repair-request:0.1.0', repair: 'node-npm-ca', targets: ['node', 'npm'], network: 'off' };
    const result = await core.prepare(request, { logging: 'off' });
    repair = clean(result); remember('prepare', result, { repair: { id: 'node-npm-ca', targets: ['node', 'npm'] } });
    return { ...await state(), repairApply: 'Not applied. This prepares actual trust configuration; system repair Apply requires separate review in the intended account. This example has no repair Apply route.' };
  }
  if (action === 'report') {
    const source = inspection || await core.inspect({ target: ['node', 'git'], offline: true, project });
    inspection = source;
    const report = await diagnosticReport();
    remember('inspect', source);
    if (report.status !== 'ok') throw Error('Core report collection returned ' + report.status);
    await saveCapture(report);
    latestReport = report;
    return state();
  }
  throw Error('Unknown action');
}
let queue = Promise.resolve();
process.on('message', message => {
  queue = queue.then(async () => {
    try { process.send({ id: message.id, value: await dispatch(message.action, message.body) }); }
    catch (error) { process.send({ id: message.id, error: { code: error.code || 'OPERATION_FAILED', message: error.message } }); }
  });
});
process.send({ ready: true });

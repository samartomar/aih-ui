import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadPublic } from './local-packages.mjs';
import { createReportRenderer } from '../../src/report/render.js';
import { createExtensionsInstaller } from './local-extensions.mjs';
import { cachedCatalogBytes, verifiedCatalogFiles } from './catalog-install.mjs';
import { explainFileCheck } from './file-check-explanation.mjs';
import { buildPolicyDraft, policyChanges, policyPosture } from './policy-draft.mjs';
import { installedGroups } from './installed-groups.mjs';
import { selectedClientTarget } from './client-target.mjs';
import { developerConsole, enableReportKeyboard } from './developer-console.mjs';

const [consumer, root, mode] = process.argv.slice(2);
const project = join(root, 'project'), policyPath = join(root, 'organization.json');
await mkdir(project, { recursive: true });
const { api: core } = await loadPublic(consumer, '@aihq/core', '.');
const { api: harnessRuntime } = await loadPublic(consumer, '@aihq/core', './harness/runtime');
const { api: harnessPublic } = await loadPublic(consumer, '@aihq/core', './harness');
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
const controls = request => ({ logging: 'off', ...(request?.schema === 'urn:aihq:core:plan-request:0.1.0' ? { catalog: { version, readRecipe: reader.readRecipe, renderStep: reader.renderStep, planRecipe: reader.planRecipe } } : {}), ...(mode === 'enterprise' ? { organization: { provider: 'local', path: policyPath } } : {}) });
const change = {
  schema: 'urn:aihq:core:change:0.1.0', id: 'example-project-instructions',
  description: 'Independently authored project instructions, editable through one declared input.',
  inputs: { text: { type: 'string', required: true, maxLength: 12000 } }, materials: [], targets: ['project'], prerequisites: [],
  operations: [{ id: 'instructions', purpose: 'Write the project instructions', kind: 'file.write', scope: 'project', requires: [], checks: [], target: { root: 'project', segments: [{ literal: 'CLAUDE.md' }] }, content: { input: 'text' } }], checks: [],
};
const identity = await contracts.deriveChangeIdentity({ change });
if (identity.status !== 'ok') throw Error(JSON.stringify(identity));
const target = { project, client: { id: 'claude-code', surface: 'cli' }, repository: 'https://example.invalid/docs-site' };
let catalogSelections = {}, pendingCatalogApply = null;
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
  if (Array.isArray(saved.history)) history = saved.history.map(row => {
    if (row.guidance?.status!=='invalid'||!['prepare','run'].includes(row.kind)) return row;
    const input = {kind:row.kind,result:row.result}, options = {platform:process.platform};
    return {...row,guidance:contracts.getGuidance(input,options),support:contracts.renderSupportMarkdown(input,options)};
  });
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
try { const saved = JSON.parse(await readFile(join(root, 'intent.json'), 'utf8')); pendingCatalogApply=saved.pendingCatalogApply||null; catalogSelections=saved.catalogSelections||{}; draft = saved.draft; lastRequest = saved.lastRequest; requests = saved.requests || (lastRequest ? { [lastRequest.schema.includes('change-request') ? 'instructions' : 'superpowers']: lastRequest } : {}); } catch (error) { if (error.code !== 'ENOENT') throw error; }
// A process can stop after Core records a receipt and before the browser receives its run.
if (pendingCatalogApply) {
  const {selection, request} = pendingCatalogApply;
  if ((await inventory()).entries.some(entry => selectionOwnsEntry(selection,entry))) {
    catalogSelections[selection.key]=selection;
    requests[selection.key]=request;
  }
  pendingCatalogApply=null;
  await persist();
}
function selectionOwnsEntry(selection,entry) {
  const matchesItem=selection.items.some(id => entry.managementId===id || entry.items?.includes(id));
  return matchesItem && (!entry.claims?.length || entry.claims.some(claim => claim.cli===null || claim.cli===selection.client));
}
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
  for (const group of installedGroups(installed,requests,catalogSelections)) {
    const tracked = group.wholePlugin ? [] : Object.values(catalogSelections).filter(selection => group.entries.some(entry => selectionOwnsEntry(selection,entry)));
    if (tracked.length) {
      for (const selection of tracked) if (!units.has(selection.key)) units.set(selection.key,{unit:selection.key,label:retainedCatalogItems(selection,installed).join(', ')+' · '+selection.client,removalId:group.id});
    } else {
      const unit = group.wholePlugin ? group.framework : group.id==='project-instructions'?'instructions':group.id;
      if (!units.has(unit)) units.set(unit,{unit,label:unit==='instructions'?'Project instructions':group.label,removalId:group.id});
    }
  }
  return Promise.all([...units.values()].map(async row => {
    const request = catalogSelections[row.unit] ? currentCatalogPolicyRequest(row.unit,installed) : requests[row.unit];
    const result = await currentAdmission(request, installed);
    const status = result?.status !== 'ok' ? 'unknown' : result.value.admitted ? 'allowed' : 'denied';
    return { ...row, status };
  }));
}
function retainedCatalogItems(selection,installed) {
  const managed = new Set(installed.entries.filter(entry => selectionOwnsEntry(selection,entry)).flatMap(entry => [entry.managementId,...(entry.items||[])]));
  return selection.items.filter(id => managed.has(id));
}
function currentCatalogPolicyRequest(key, installed) {
  const saved = requests[key], selection = catalogSelections[key];
  if (!saved || !selection) return saved;
  const remaining = retainedCatalogItems(selection,installed);
  if (remaining.length === selection.items.length) return saved;
  if (!remaining.length) return null;
  const plan = reader.planInstall(remaining,saved.contents,saved.profiles,{scope:'project',data:saved.plan.data});
  if (plan.status !== 'ok') return null;
  const needed = new Set(plan.plan.filter(step => step.from).map(step => step.from.sha256));
  return {...saved,plan,files:saved.files.filter(ref => needed.has(ref.sha256))};
}
function invalidate() { review = null; generation++; }
async function persist() {
  const path=join(root,'intent.json');
  await writeFile(path+'.tmp',JSON.stringify({draft,lastRequest,requests,catalogSelections,pendingCatalogApply},(key,value) => key==='bytes'?undefined:value,2));
  await rename(path+'.tmp',path);
}
function remember(kind, result, extra = {}) {
  const input = { kind, result: clean(result), ...extra };
  const guidance = contracts.getGuidance(input, { platform: process.platform });
  const support = contracts.renderSupportMarkdown(input, { platform: process.platform });
  history.push({ sequence: (history.at(-1)?.sequence || 0) + 1, at: new Date().toISOString(), kind, result: clean(result), guidance, support });
  if (history.length > 20) history.shift();
}
async function diagnosticReport() {
  const diagnostic = await harness.diagnose({ requestId: randomUUID(), targets: ['node', 'git'], network: 'off', project });
  return contracts.createReport({ diagnostic, producer: { name: '@aihq/core', version: '0.0.0-dev.1', revision: snapshot.packages.find(item => item.name === '@aihq/core')?.commit || null }, observedAt: new Date().toISOString(), acquisition: 'newly-acquired', redaction: { homePaths: [root] } });
}
function suggestedRepairTargets() {
  if (!inspection) return [];
  const guidance = contracts.getGuidance({kind:'inspect',result:inspection},{platform:process.platform});
  return [...new Set((guidance.items||[]).flatMap(item => item.repairs||[]).filter(repair => repair.id==='node-npm-ca').flatMap(repair => repair.targets))];
}
async function state() {
  const installed = await inventory();
  return { mode, installedGroups:installedGroups(installed,requests,catalogSelections), repairInfo:{platform:process.platform,suggestedTargets:suggestedRepairTargets(),definition:harnessPublic.repairIndex.find(repair => repair.id === 'node-npm-ca')}, connectedFramework: { unit:'extensions', id:'extensions', name:'AIH Extensions', version:'0.6.0', plugin:'aih-extensions' }, extensionsDerivation:extensionsInstaller.derivation(), project, home: process.env.USERPROFILE || process.env.HOME, organization, policyDigest: policyDigest(), reviews, generation, draft, inventory: installed, installedPolicyChecks: await installedPolicyChecks(installed), prepared: review ? { id: review.id, context: review.context, result: clean(review.result), operation: review.operation, catalogSelection: review.catalogSelection, applyAllowed: review.applyAllowed, nativePlugin: review.nativePlugin } : null, history, inspection, repair, report: latestReport, reportDigest: latestReport?.status === 'ok' ? hash(latestReport.snapshot) : null, source: sourceResult ? { status: sourceResult.status, reason: sourceResult.reason, commit: sourceResult.source?.commit } : null };
}
async function storePrepared(result, operation, request, allowNative = false, catalogSelection = null) {
  const context = hash({ draft, organization, generation });
  // Only the connected native Extensions route may approve its reviewed client commands.
  const program = result.review?.steps?.some(step => ['run-program', 'opaque-process'].includes(step.effect) || step.commands?.length);
  review = { id: randomUUID(), context, result, operation, request, catalogSelection, applyAllowed: !!result.handle && (!program || allowNative) };
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
    const { company, reviewer, team, note, decision, evidence, concern } = body;
    const entry = { id:randomUUID(), recordedAt:new Date().toISOString(), company, reviewer, team, decision, note,
      attribution:'Self-declared local reviewer', policyId:organization.id, policySha256:body.digest, evidence, ...(concern ? {concern} : {}) };
    const filename = entry.recordedAt.replaceAll(':','-') + '-' + entry.id + '.json';
    const temporary = join(journal, filename + '.tmp');
    await writeFile(temporary, JSON.stringify(entry, null, 2), {flag:'wx'});
    await rename(temporary, join(journal, filename));
    reviews.push(entry);
    return state();
  }
  if (action === 'profile-admission') {
    if (!organization) return { policy: null, policyNote: 'Save an organization policy to check this plan.' };
    const { client, ...parts } = body;
    const selected = selectedClientTarget(harnessPublic,client || 'claude-code');
    if (!selected) return {policy:null,policyNote:'Core does not recognize this client.'};
    const request = { ...parts, schema: 'urn:aihq:core:plan-request:0.1.0', mode, scope: 'project', target:{...target,client:selected} };
    const policy = await contracts.previewAdmission({ organization, request, installed: await inventory() });
    return { policy, policyNote: 'Saved policy ' + organization.id + ' · admission applies to the planned Catalog steps.' };
  }
  if (action === 'state') return state();
  if (action === 'draft') { invalidate(); draft = { ...body, choices: { ...draft.choices, ...body.choices } }; await persist(); return state(); }
  if (action === 'policy' || action === 'policy-preview') {
    const policy = buildPolicyDraft(organization, body, {data:catalogInput.data,frameworks:catalogInput.documents.map(text => JSON.parse(text).framework)}, identity.changeIdentity);
    const validation = contracts.validateOrganizationPolicy(policy);
    if (validation.status !== 'ok') return { validation };
    if (action === 'policy-preview') {
      const installed = await inventory(), impact = [];
      for (const [unit,saved] of Object.entries(requests)) {
        const request = catalogSelections[unit] ? currentCatalogPolicyRequest(unit,installed) : saved;
        if(!request){impact.push({unit,status:'unknown'});continue;}
        const reference = request.files ? {...request,files:request.files.map(({bytes,...file}) => file)} : request;
        const result = await contracts.previewAdmission({organization:validation.value,request:reference,installed});
        impact.push({unit,status:result.status === 'ok' ? result.value.admitted ? 'allowed':'denied':'unknown'});
      }
      let selectionImpact = null;
      if (body.selection) {
        const selected = harnessPublic.selectTool(body.selection.client);
        if (body.selectionRequest && selected.status === 'ok') {
          const request = {...body.selectionRequest,schema:'urn:aihq:core:plan-request:0.1.0',mode:'enterprise',scope:'project',target:{...target,client:{id:selected.tool.id,surface:selected.tool.surface}}};
          selectionImpact = {items:body.selection.items,client:body.selection.client,before:organization?await contracts.previewAdmission({organization,request,installed}):null,after:await contracts.previewAdmission({organization:validation.value,request,installed})};
        } else selectionImpact = {items:body.selection.items,client:body.selection.client,unavailable:'A complete selection plan is needed.'};
      }
      return { validation, policy:validation.value, changes:policyChanges(organization,validation.value), impact, selectionImpact, posture:policyPosture(validation.value) };
    }
    await writeFile(policyPath + '.tmp', JSON.stringify(validation.value, null, 2));
    await rename(policyPath + '.tmp', policyPath);
    organization = validation.value; invalidate();
    return { ...await state(), validation };
  }
  if (action === 'catalog-prepare') {
    invalidate();
    const { parts, items, client } = body;
    const clientTarget=selectedClientTarget(harnessPublic,client);
    if(!clientTarget) throw Error('Core does not recognize this client.');
    const request={ ...parts, schema:'urn:aihq:core:plan-request:0.1.0', mode, scope:'project', target:{ ...target, client:clientTarget } };
    const installed=await inventory();
    const admission=await currentAdmission(request,installed);
    if (mode==='enterprise' && (!admission?.value?.admitted || admission.status!=='ok')) return {...await state(),outcome:{status:'refused',reason:'The current organization policy does not admit this selection.',admission}};
    request.files=await verifiedCatalogFiles(parts,{root,catalogNode,sourceCache:sourceResult});
    const result=await core.prepare(request,controls(request));
    const key='catalog-'+hash([client,[...items].sort()]).slice(0,24);
    return storePrepared(result,'install',request,false,{key,items,client});
  }
  if (action === 'prepare') {
    invalidate();
    const chosen = ['extensions','superpowers','instructions'].filter(unit => draft.choices[unit]);
    const selected = body.unit || (chosen.length === 1 ? chosen[0] : null);
    if (!selected || !draft.choices[selected]) return { ...await state(), outcome: { status: 'refused', reason: 'Choose the selected unit to review. Units are prepared independently; other selections stay chosen.' } };
    const built = selected === 'extensions' ? await extensionsInstaller.request({ mode, target, profile }) : selected === 'superpowers' ? await superpowersRequest() : { request: instructionsRequest() };
    if (built.result) return { ...await state(), outcome: built.result };
    const request = built.request, current = await inventory();
    const ids = selected === 'instructions' ? ['project-instructions'] : installedGroups(current,requests,catalogSelections).find(group => group.wholePlugin && group.framework === selected)?.managementIds || [];
    const installed = current.entries?.some(entry => ids.includes(entry.managementId));
    const result = installed ? await core.prepareUpdate({ target: { project }, scope: 'project', updates: [{ managementIds: ids, request }] }, controls(request)) : await core.prepare(request, controls(request));
    return storePrepared(result, installed ? 'update' : 'install', request, selected === 'extensions');
  }
  if (action === 'remove') {
    invalidate();
    const current = await inventory();
    if (!current.entries?.some(entry => entry.managementId === body.managementId)) throw Object.assign(Error('Unknown managed unit'), { code: 'UNKNOWN_UNIT' });
    const group = installedGroups(current,requests,catalogSelections).find(group => group.id === body.managementId);
    const result = await core.prepareRemoval({ mode, target, scope: 'project', removals: (group?.managementIds || [body.managementId]).map(managementId => ({managementId})) }, controls());
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
    if (selected.catalogSelection) {
      pendingCatalogApply={selection:selected.catalogSelection,request:selected.request};
      await persist();
    }
    const result = await core.apply(selected.result.handle, { approved: true, origin: 'interactive', reviewDigest: body.reviewDigest }, controls(selected.request));
    const retainedPartial = selected.catalogSelection && ['incomplete','cancelled'].includes(result.completion) &&
      (await inventory()).entries.some(entry => selectionOwnsEntry(selected.catalogSelection,entry));
    if (selected.request && (result.completion === 'complete' || retainedPartial)) {
      lastRequest = selected.request;
      const key=selected.catalogSelection?.key || requestUnit(selected.request);
      if (selected.catalogSelection) catalogSelections[key]=selected.catalogSelection;
      requests[key] = selected.request;
    }
    if (selected.catalogSelection || selected.request && result.completion === 'complete') {
      pendingCatalogApply=null;
      await persist();
    }
    if (selected.operation === 'remove' && result.completion === 'complete') {
      const remaining = await inventory();
      const stillPresent = selected.removedUnit === 'instructions' ? remaining.entries.some(entry => entry.managementId === 'project-instructions') : installedGroups(remaining,requests,catalogSelections).some(group => group.wholePlugin && group.framework === selected.removedUnit);
      for (const [key, selection] of Object.entries(catalogSelections)) {
        if (!remaining.entries.some(entry => selectionOwnsEntry(selection,entry))) {
          delete requests[key];delete catalogSelections[key];
        }
      }
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
      const current = catalogSelections[unit] ? currentCatalogPolicyRequest(unit, installed) : saved;
      if (!current) {
        checks.push({unit,check:{status:'refused',reason:'The remaining installed selection could not be reconstructed.'},admission:null});
        continue;
      }
      const request = catalogSelections[unit] ? {...current,files:await Promise.all(current.files.map(async ref=>({...ref,bytes:await cachedCatalogBytes(root,ref)})))} : saved.files ? { ...saved, files: saved.files.map(file => ({ ...file, bytes: file.bytes || (unit === 'extensions' ? extensionsInstaller.files() : sourceResult?.files)?.find(source => source.path === file.sourcePath && source.sha256 === file.sha256)?.bytes })) } : saved;
      const checkControls = request.schema === 'urn:aihq:core:plan-request:0.1.0' ? { catalog: controls(request).catalog } : {};
      const result = await core.checkFiles(request, checkControls);
      const admission = await currentAdmission(current, installed);
      checks.push({ unit:catalogSelections[unit]?retainedCatalogItems(catalogSelections[unit],installed).join(', '):unit, check: result, admission, explanation:explainFileCheck(unit, saved, result, installed) });
    }
    const result = checks.at(-1) || { check: { status: 'refused', reason: 'No completed request retained in this workspace.' }, admission: null };
    return { ...await state(), ...result, checks, coverage: { retainedUnits: checks.map(row => row.unit), untrackedInventory: installed.entries.filter(entry => !Object.entries(requests).some(([key,request]) => {
      if (catalogSelections[key]) return selectionOwnsEntry(catalogSelections[key],entry);
      return request.changes?.some(change => change.managementId===entry.managementId) || request.plan && (entry.framework===key || entry.items?.some(item => item.startsWith(key+'.')));
    })).map(entry => entry.managementId) } };
  }
  if (action === 'inspect') {
    inspection = await core.inspect({ target: ['node', 'npm', 'git'], offline: true, project }); remember('inspect', inspection);
    return state();
  }
  if (action === 'repair') {
    const targets=suggestedRepairTargets();
    if (!targets.length) return {...await state(),repairApply:'The current inspection has not suggested this repair. Inspect the environment and resolve the reported problem first.'};
    const request = { schema: 'urn:aihq:core:repair-request:0.1.0', repair: 'node-npm-ca', targets, network: 'off' };
    const result = await core.prepare(request, { logging: 'off' });
    repair = clean(result); remember('prepare', result, { repair: { id: 'node-npm-ca', targets } });
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

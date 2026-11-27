import { readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadPublic } from './local-packages.mjs';
import { readProfile } from './profile-reader.mjs';
import { indexedAssets, itemRoot, readRevisions, selectionNote } from './scan-revisions.mjs';

const recipeDigests = new Map([
  ['7c525bd7d8b6e8a0c756d79f7e29f44ec38bff26', '7bdb820e826980a8ad94c4d847f42db0cca2bc0e065f38317811adc83da5848a'],
  ['a6495fc3d9a34dedc58f8e53e385a8661e209aed', '38cc0a0666a9ceabdfadf9439811e32357437df96917885470f3f3eb53519b96'],
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => Object.assign(Error(message), { code: 'CATALOG_INPUT_INVALID', status: 400 });

// Only attribute a title when the public SARIF drivers agree on it.
function reportedRuleTitles(bytes) {
  const titles = new Map();
  for (const run of JSON.parse(bytes).runs || []) {
    const driver = run.tool?.driver;
    for (const rule of driver?.rules || []) {
      const key = JSON.stringify([driver.name, rule.id]);
      const title = rule.shortDescription?.text;
      if (titles.has(key) && titles.get(key) !== title) titles.set(key, null);
      else if (!titles.has(key)) titles.set(key, title);
    }
  }
  return titles;
}

// Scan names files relative to the item (under root). Catalog owns the pinned repository path.
function findingSource(finding, selected, cache, texts, root) {
  const path = finding.path;
  if (typeof path !== 'string' || !path || !finding.fileSha256 || root === null) return {};
  const matches = selected.item.files.filter(f => f.sha256 === finding.fileSha256 && f.sourcePath === root + path);
  if (matches.length !== 1) return {};
  const file = matches[0], source = selected.entry.sources.find(s => s.id === file.sourceId);
  if (!source || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(source.repository) ||
      !/^[a-f0-9]{40}$/.test(source.commit)) return {};
  const segments = file.sourcePath.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) return {};
  const line = Number.isSafeInteger(finding.line) && finding.line > 0 ? finding.line : 0;
  const sourceUrl = source.repository + '/blob/' + source.commit + '/' + segments.map(encodeURIComponent).join('/') + (line ? '#L' + line : '');
  if (!line || source.repository !== cache?.source?.repository || source.commit !== cache?.source?.commit) return {sourceUrl};
  if (!texts.has(file.sha256)) {
    const cached = cache.files?.find(f => f.path === file.sourcePath && f.sha256 === file.sha256);
    const encoded = cached?.bytes?.data;
    const bytes = typeof encoded === 'string' && encoded.length <= 4 * Math.ceil(1024 * 1024 / 3) && Buffer.from(encoded, 'base64');
    let lines = null;
    if (bytes && bytes.length <= 1024 * 1024 && !bytes.includes(0) && hash(bytes) === file.sha256) {
      try { lines = new TextDecoder('utf-8', {fatal:true}).decode(bytes).split(/\r\n|\r|\n/); }
      catch { /* Binary or non-UTF-8 content still has a pinned file link. */ }
    }
    texts.set(file.sha256, lines);
  }
  const lines = texts.get(file.sha256);
  if (!lines || line > lines.length) return {sourceUrl};
  const startLine = Math.max(1, line - 2);
  return {sourceUrl, excerpt:{startLine, lines:lines.slice(startLine - 1, line + 2).map(s => s.length > 240 ? s.slice(0,240) + '…' : s)}};
}

// This input root is chosen by the host at startup. Requests select known IDs only.
export async function createLocalCatalog(consumer, sourceCache, inputConsumer = consumer) {
  const root = resolve(inputConsumer, 'public');
  const cache = sourceCache ? JSON.parse(await readFile(sourceCache, 'utf8')) : null;
  const { api: reader } = await loadPublic(consumer, '@aihq/catalog', './reader');
  const { api: contracts } = await loadPublic(consumer, '@aihq/catalog', './contracts');
  const { api: scan } = await loadPublic(consumer, '@aihq/scan', './read');
  const snapshot = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
  const index = JSON.parse(await readFile(join(root, 'scan', 'index.json'), 'utf8'));
  const pin = snapshot.data?.commit;
  if (!recipeDigests.has(pin) || snapshot.data?.repository !== 'https://github.com/samartomar/aih-catalog' || index.catalogCommit !== pin) throw invalid('Catalog and Scan index must match the pinned data commit');
  // Pinned Catalog port-report/ai-setup.json and data/qualifications/*.json.
  const toolData = JSON.parse(await readFile(join(root, 'workbench', 'tool-setup-data.json'), 'utf8'));
  if (toolData.source.commit !== pin || toolData.source.repository !== snapshot.data.repository) throw invalid('Tool setup data does not match the Catalog pin');
  const metadata = { name: toolData.recipe.id, version: '1.0.0', description: 'Catalog tool combination', author: 'Workbench', license: 'Apache-2.0', keywords: [] };
  const trio = reader.readRecipe(Buffer.from(JSON.stringify(metadata)), Buffer.from(JSON.stringify(toolData.recipe)));
  if (trio.status !== 'ok' || trio.sha256 !== recipeDigests.get(pin)) throw invalid('The Catalog tool recipe differs from the pinned combination');
  const qualifications = Object.entries(toolData.qualifications).map(([digest, record]) => {
    const read = reader.readQualification(Buffer.from(JSON.stringify(record, null, 2) + '\n'));
    if (read.status !== 'ok' || read.sha256 !== digest) throw invalid('Invalid pinned tool qualification');
    return read.qualification;
  });
  const platform = (process.platform === 'win32' ? 'windows' : process.platform) + '-' + process.arch;
  const toolCombination = { id: trio.recipe.id, members: trio.recipe.members.map(member => member.item), overrides: trio.recipe.aiSetup };
  const profiles = new Map();
  for (const [id, text] of Object.entries(contracts.toolProfiles)) {
    const read = reader.readToolProfile(Buffer.from(text));
    if (read.status !== 'ok') throw invalid('A published client profile did not read');
    profiles.set(id, read.profile);
  }
  const contents = [], frameworks = [], items = [], byId = new Map(), assets = new Map(), evidenceCache = new Map();
  function assetPath(asset) {
    if (!asset || !/^\/scan\/[a-zA-Z0-9/_-]+\.(?:json|sigstore|sarif)$/.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) throw invalid('Invalid indexed evidence asset');
    const file = resolve(root, '.' + asset.url);
    if (relative(root, file).startsWith('..')) throw invalid('Evidence outside configured snapshot');
    const url = '/catalog-assets' + asset.url;
    assets.set(url, { ...asset, file }); return url;
  }
  for (const text of snapshot.documents) {
    const read = reader.readContent(Buffer.from(text));
    if (read.status !== 'ok') throw invalid('A Catalog content document did not read');
    const content = read.content, framework = content.framework;
    const manifest = snapshot.data.files.find(file => file.path === `data/${framework.id}/content.json`);
    if (!manifest || hash(Buffer.from(text)) !== manifest.sha256) throw invalid('Content bytes differ from the pinned Catalog manifest');
    contents.push(content);frameworks.push({ ...framework, count: reader.listItems(content).length, sha256: manifest.sha256 });
    for (const item of reader.listItems(content)) {
      if (byId.has(item.id)) throw invalid('Duplicate Catalog item');
      const derived = reader.derive(item, content), indexed = index.records[item.scanKey];
      const entry = { id: item.id, title: item.name || item.id, kind: item.kind, description: item.description || '', framework: framework.id, frameworkName: framework.name, scanKey: item.scanKey, paths: derived.packagePath, bytes: derived.size, sources: content.sources.filter(source => derived.sourceIds.includes(source.id)), availability: Object.fromEntries([...profiles].map(([id, profile]) => [id, reader.availability(item, profile)])), status: indexed ? 'indexed' : 'missing' };
      if (item.kind === 'ai-setup') {
        const { version, executable, launch, settings, mcpItem } = item.aiSetup;
        const server = content.items.find(member => member.id === mcpItem);
        entry.setup = { version, executable, launch, settings, mcpItem, platform, runtime:item.aiSetup.runtime, doNotRun:item.aiSetup.doNotRun, qualifications:qualifications.filter(record => record.subject.aiSetup === item.id).map(record => ({platform:record.subject.cell,status:record.result.status,reason:record.result.reason})), env: server?.env, enabledTools: server?.enabledTools, disabledTools: server?.disabledTools, startupSeconds: server?.startupSeconds, callSeconds: server?.callSeconds };
      }
      if (indexed) for (const asset of indexedAssets(indexed)) assetPath(asset);
      byId.set(item.id, { item, content, entry });items.push(entry);
    }
  }
  if (frameworks.length !== snapshot.data.files.length) throw invalid('Catalog document/manifest count differs');
  // The pinned reader can reject an isolated item that references shared files.
  // Include its framework document and consult the full Catalog for missing dependencies.
  for (const entry of items) {
    for (const [client, availability] of Object.entries(entry.availability)) {
      if (entry.setup) {
        const result = planTools([entry.id], client);
        entry.availability[client] = { available: result.status === 'ok', label: 'Tool setup' };
        continue;
      }
      if (availability.reason === 'incomplete' || availability.reason === 'platform-required') {
        entry.availability[client] = { ...availability, label: availability.reason === 'incomplete' ? 'Incomplete plan' : 'Platform needed' };
        continue;
      }
      if (availability.reason !== 'invalid') continue;
      const owner = byId.get(entry.id).content;
      let result = planItems([entry.id], client, [owner]);
      if (result.missing?.length) result = planItems([entry.id], client, contents);
      let label = 'Preview unavailable';
      if (result.status === 'ok') label = 'Placeable';
      else if (result.status === 'incomplete') label = 'Incomplete plan';
      else if (result.problems?.some(problem => problem.path === 'options/cell')) label = 'Platform needed';
      entry.availability[client] = { available: result.status === 'ok', label };
    }
  }
  const catalog = { data: snapshot.data, frameworks, items, clients: [...profiles].map(([id, profile]) => ({ id, name: profile.name || id, version: profile.version })), coverage: { indexed: items.filter(item => item.status === 'indexed').length, missing: items.filter(item => item.status === 'missing').length }, scanRelease: index.release };
  catalog.toolCombination = toolCombination;
  async function readAsset(url) {
    const asset = assets.get(url);if (!asset) throw Object.assign(invalid('Unknown evidence asset'), { status: 404 });
    if ((await stat(asset.file)).size !== asset.bytes) throw invalid('Evidence size changed');
    const bytes = await readFile(asset.file);
    if (hash(bytes) !== asset.sha256) throw invalid('Evidence digest changed');
    return bytes;
  }
  // The item's pinned bytes from the host's source cache, or null when any file is unavailable.
  function pinnedFiles(selected) {
    const files = [];
    for (const file of selected.item.files) {
      const source = selected.entry.sources.find(s => s.id === file.sourceId);
      if (!source || source.repository !== cache?.source?.repository || source.commit !== cache?.source?.commit) return null;
      const encoded = cache.files?.find(f => f.path === file.sourcePath && f.sha256 === file.sha256)?.bytes?.data;
      const bytes = typeof encoded === 'string' && Buffer.from(encoded, 'base64');
      if (!bytes || hash(bytes) !== file.sha256) return null;
      files.push({ sourcePath: file.sourcePath, sha256: file.sha256, executable: file.executable === true, bytes });
    }
    return files.length ? files : null;
  }
  const revisionCache = new Map();
  async function evidence(id, revision) {
    const selected = byId.get(id);if (!selected) throw invalid('Unknown Catalog item');
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw invalid('Choose a recorded Scan revision');
    const { entry } = selected, record = index.records[entry.scanKey];
    if (!record) return { id, scanKey: entry.scanKey, status: 'missing', reason: 'No assessment indexed for this exact item identity', findings: [] };
    const read = revisionCache.get(id) ?? await readRevisions({ scan, scanKey: entry.scanKey, entry: record, readAsset, assetPath, files: pinnedFiles(selected) });
    if (read.revisions.every(value => value.verification.status === 'ok')) revisionCache.set(id, read);
    const shownRevision = revision ?? read.defaultRevision ?? read.fallbackRevision;
    const selection = revision !== undefined ? 'chosen' : read.defaultRevision !== null ? 'default' : 'fallback';
    const revisions = read.revisions.map(value => ({ revision: value.revision, readable: value.readable, ...(value.reason && { reason: value.reason }),
      scannedAt: value.scannedAt, mode: value.mode, producer: value.producer, verificationLabel: value.verificationLabel, trusted: value.trusted,
      withdrawn: value.withdrawn, match: value.match.status, matchLabel: value.matchLabel, default: value.revision === read.defaultRevision }));
    const note = selectionNote({ selection, revision: shownRevision, defaultRevision: read.defaultRevision, fallbackTier: read.fallbackTier });
    const context = { revision: shownRevision, defaultRevision: read.defaultRevision, selection, fallbackTier: read.fallbackTier, selectionNote: note, revisions };
    if (shownRevision === null) return { id, scanKey: entry.scanKey, status: 'unreadable', reason: note, ...context, findings: [] };
    const cacheKey = id + '@' + shownRevision + '@' + selection;
    if (evidenceCache.has(cacheKey)) return evidenceCache.get(cacheKey);
    const shown = read.revisions.find(value => value.revision === shownRevision);
    if (!shown) throw invalid('Choose a recorded Scan revision');
    const { summary, verification, summaryUrl, bundleUrl } = shown;
    if (!shown.readable) return { id, scanKey: entry.scanKey, status: 'unreadable', reason: shown.verificationLabel, ...context, verification, summaryUrl, bundleUrl, findings: [] };
    const root = itemRoot(selected.item.files, summary.files);
    const findings = [], links = [], texts = new Map();
    for (const asset of shown.record.sarif) {
      const url = assetPath(asset), sarif = await readAsset(url);
      const result = await scan.readFindings(summary, sarif, entry.scanKey);
      if (result.status !== 'ok') return { id, scanKey: entry.scanKey, status: 'unreadable', reason: result.reason || result.status, ...context, verification, findings: [] };
      const titles = reportedRuleTitles(sarif);
      for (const finding of result.findings) {
        const ruleTitle = titles.get(JSON.stringify([finding.tool, finding.ruleId]));
        findings.push({ ...finding, message: finding.text, evidenceUrl: url, ...(typeof ruleTitle === 'string' && {ruleTitle}), ...findingSource(finding, selected, cache, texts, root) });
      }
      links.push({ url, sha256: asset.sha256 });
    }
    // Ready only for a trusted, unwithdrawn revision whose content was not contradicted.
    const usable = shown.trusted && !['differs', 'refused'].includes(shown.match.status);
    const result = { id, scanKey: entry.scanKey, status: usable ? 'ready' : 'unverified', summary, findings, verification, verificationLabel: shown.verificationLabel,
      ...context, producer: shown.producer, match: shown.match.status, matchLabel: shown.matchLabel,
      summaryUrl, bundleUrl, assets: links, verdict: summary.label, riskScore: summary.score, coverage: summary.coverage, verifiedAt: new Date().toISOString(),
      scopeNote: 'Exact recorded item evidence. Withdrawals are those this index records; current source bytes are matched only when the host holds them, and newer evidence is not looked up.' };
    if (result.status === 'ready') evidenceCache.set(cacheKey, result);return result;
  }
  // The evidence a review record binds: the exact revision read for it and its assets' digests.
  async function reviewEvidence(itemId, revision) {
    const record = await evidence(itemId, revision);
    const reference = url => url && ({ url, sha256: assets.get(url).sha256 });
    return { record, evidence: { itemId: record.id, scanKey: record.scanKey, catalogCommit: catalog.data.commit,
      status: record.status, revision: record.summary?.revision ?? null, verdict: record.verdict ?? null,
      verification: record.verificationLabel ?? null, reason: record.reason ?? null,
      summary: reference(record.summaryUrl) ?? null, bundle: reference(record.bundleUrl) ?? null, findings: record.assets ?? [] } };
  }
  function planItems(ids, client, documents) {
    return reader.planInstall(ids, documents, [profiles.get(client)], {
      scope: 'project', data: { repository: snapshot.data.repository, commit: pin },
    });
  }
  function plan(ids, client, configureTools = false, cell = platform) {
    if (!profiles.has(client) || !Array.isArray(ids) || !ids.length || ids.some(id => !byId.has(id)) || new Set(ids).size !== ids.length) throw invalid('Choose known items and one published client');
    if (configureTools && ids.every(id => byId.get(id).entry.setup)) {
      return { client, selection: ids, execution: 'preview-only', notice: 'Configuration preview for the selected tools on ' + cell + '.', plan: planTools(ids, client, cell) };
    }
    return { client, selection: ids, execution: 'preview-only', notice: 'Preview the planned project changes. Review installation verifies the required source files and asks Core for an approval review.', plan: planItems(ids, client, contents) };
  }
  function admissionParts(result, ids, client) {
    if (result.status !== 'ok') return null;
    return {plan:result, profiles:[profiles.get(client)], contents:contents.filter(content => content.items.some(item => ids.has(item.id))), files:[]};
  }
  function planTools(ids, client, cell = platform) {
    const options = { scope: 'project', data: toolData.source, cell, qualifications };
    const selected = [profiles.get(client)];
    if (ids.length === toolCombination.members.length && toolCombination.members.every(id => ids.includes(id))) {
      return reader.planRecipe(trio.recipe, contents, selected, {}, { ...options, source: toolData.source });
    }
    return reader.planInstall(ids, contents, selected, options);
  }
  function catalogPreview(ids, client, cell = platform) {
    const response = plan(ids, client, true, cell);
    return {response, requestParts:admissionParts(response.plan, new Set(ids), client)};
  }
  function profilePreview(bundle, client) {
    const profile = profiles.get(client);
    if (!profile) throw invalid('Choose a published client for this setup.');
    const { read, choices, selection } = readProfile(bundle, reader);
    const ids = new Set(selection);
    let result, identity, notice;
    if (selection) {
      if (bundle.data.repository !== snapshot.data.repository || bundle.data.commit !== pin) throw invalid('This profile uses a different Catalog revision from the loaded workspace.');
      result = plan(selection, client).plan;
      identity = { profileDigest: hash(Buffer.from(JSON.stringify(bundle))) };
      notice = 'Catalog preview of your selected items. Your first task and accompanying Markdown travel in the profile download.';
    } else {
      result = reader.planRecipe(read.recipe, contents, [profile], choices, {
        scope: 'project', source: bundle.source,
        data: { repository: snapshot.data.repository, commit: pin },
      });
      for (const member of read.recipe.members) if (member.preTicked) ids.add(member.item);
      for (const option of read.recipe.options ?? []) {
        for (const id of choices[option.id] ?? option.items.filter(member => member.preTicked).map(member => member.item)) ids.add(id);
      }
      identity = { recipeDigest: read.sha256 };
      notice = 'Recipe preview only. The source pin is contributor-declared. Companion Markdown is available in the download; placing it and checking client loading are separate steps.';
    }
    for (const step of result.plan ?? []) {
      if (step.item) ids.add(step.item);
      for (const id of [...(step.items ?? []), ...(step.contains ?? [])]) ids.add(id);
    }
    const items = [...ids].map(id => {
      const entry = byId.get(id)?.entry;
      return { id, title: entry?.title ?? id, status: entry?.status ?? 'unknown' };
    });
    const response = { status: 'ok', profile: bundle, ...identity, plan: result, items,
      policy: null, policyNote: 'Vibe mode has no organization boundary.', notice };
    // Core needs the content records for selectors such as kind and framework.
    const requestParts = admissionParts(result, ids, client);
    return { response, requestParts };
  }
  function previewTools(items, client, cell) {
    if (!profiles.has(client) || !/^(windows|darwin|linux)-(x64|arm64)$/.test(cell)) {
      throw invalid('Choose a published CLI target and platform.');
    }
    const ids = items.map(({ id, itemId }) => {
      const entry = byId.get(itemId)?.entry;
      const framework = frameworks.find(value => value.id === entry?.framework);
      if (!entry?.setup || id !== `${framework?.sha256}/${itemId}`) {
        throw invalid('This exact tool recipe is unavailable from the pinned Catalog source.');
      }
      return itemId;
    });
    return { ...planTools(ids, client, cell), source: toolData.source,
      recipe: ids.length === toolCombination.members.length && toolCombination.members.every(id => ids.includes(id)) ? toolCombination.id : null };
  }
  // A Tool Setup recipe can be planned for another qualified platform cell than this host's.
  function prepareSelection(items, client, cell = platform) {
    if (!/^(windows|darwin|linux)-(x64|arm64)$/.test(cell)) throw invalid('Choose a published platform.');
    const ids = items.map(({ id, itemId }) => {
      const entry = byId.get(itemId)?.entry;
      const framework = frameworks.find(value => value.id === entry?.framework);
      if (!entry || id !== `${framework?.sha256}/${itemId}`) throw invalid('The exact item is unavailable from the prepared Catalog source.');
      return itemId;
    });
    return catalogPreview(ids, client, cell);
  }
  return { catalog, evidence, reviewEvidence, plan, assets, readAsset, profilePreview, catalogPreview, previewTools, prepareSelection };
}

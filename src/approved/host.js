import { createAuthoringClient } from '../app/authoring-client.js';
import { publishedClients } from '../app/core-targets.js';
import { projectItems } from '../catalog/authoring-model.js';
import { sourcePresentation } from '../catalog/source-facts.js';

async function read(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const unavailable = reason => ({ status: 'unavailable', reason });
const failed = reason => ({ status: 'failed', reason });

function presentCatalog(catalog) {
  const configured = catalog.frameworks ?? [];
  const byRelease = new Map(configured.map(framework => [framework.sha256, framework]));
  const installed = new Map();
  const demonstration = new Set((catalog.templates ?? []).map(template => template.releaseSha256));
  const items = [];
  for (const { entryId, authoringItem: item } of projectItems(catalog.items)) {
    const sha256 = item.root.releaseSha256;
    if (demonstration.has(sha256) || item.role === 'supporting' || byRelease.get(sha256)?.kind === 'fixture') continue;
    let framework = byRelease.get(sha256) ?? installed.get(sha256);
    if (!framework) {
      framework = { id: sha256, name: item.family, sha256, kind: 'installed', state: 'ready' };
      installed.set(sha256, framework);
    }
    const { name, description } = sourcePresentation(item);
    items.push({ id: entryId, itemId: item.id, title: name, description, kind: item.kind,
      framework: framework.id, frameworkName: framework.name, root: item.root });
  }
  return { items, frameworks: [...configured.filter(framework => framework.kind !== 'fixture'), ...installed.values()] };
}

// The authoring client keeps the ephemeral identity used for acquired Scan evidence.
// Each plan carries its own policy bytes so concurrent previews cannot combine drafts.
export async function loadWorkbench() {
  const client = createAuthoringClient({ sessionRecovery: false });
  const [catalog, packages, toolList] = await Promise.allSettled([
    client.loadCatalog(), read('/api/packages'), read('/api/tools'),
  ]);
  const gaps = {
    profiles: 'No Profile source is connected.',
    publication: 'No organization publication host is connected.',
    selfScan: 'This host can inspect supplied evidence. It does not start a repository scan.',
  };
  let content = { items: [], frameworks: [] };
  const readOnly = catalog.status === 'fulfilled' && catalog.value?.state === 'read-only';
  if (readOnly) {
    content = { items: catalog.value.items, frameworks: catalog.value.frameworks };
    gaps.plan = 'This Catalog host supports browsing. A setup plan requires a connected recipe source.';
    if (catalog.value.problems.length) gaps.catalog = catalog.value.problems.join(' ');
  } else if (catalog.status === 'fulfilled' && Array.isArray(catalog.value?.items)) content = presentCatalog(catalog.value);
  else gaps.catalog = 'The installed Catalog could not be loaded.';

  const coreTargets = packages.status === 'fulfilled' ? packages.value.coreTargets : undefined;
  const packageList = packages.status === 'fulfilled' && Array.isArray(packages.value.packages) ? packages.value.packages : [];
  const published = publishedClients(coreTargets);
  const clients = published?.ids.map(id => ({ id, name: published.labels[id] ?? id })) ?? [];
  if (!published) gaps.clients = coreTargets?.reason ?? 'Core client targets are unavailable.';

  const toolResult = toolList.status === 'fulfilled' ? toolList.value : undefined;
  const tools = toolResult?.state === 'published' && Array.isArray(toolResult.tools) ? toolResult.tools : [];
  if (!tools.length) gaps.tools = toolResult?.reason ?? 'The Core tool list is unavailable.';
  const exactItems = new Map(content.items.map(item => [item.id, item]));

  async function inspectItem(item, { tool, enterprise = false } = {}) {
    const exact = exactItems.get(item.id);
    if (!exact) return { evidence: unavailable('This exact Catalog item is unavailable.') };
    if (readOnly) {
      const evidence = await read('/api/approved-evidence?' + new URLSearchParams({ item: exact.id }))
        .catch(() => failed('The evidence check failed.'));
      return { evidence, compatibility: unavailable('This source has no connected tool profile.'), source: { status: 'published' } };
    }
    const { releaseSha256, itemId } = exact.root;
    const pending = [
      client.request('scan-evidence', { target: exact.id, projection: 'inspector', evaluationTime: new Date().toISOString() }),
      client.request('source-material', { target: exact.id }),
      tool ? client.request('browse-content', { tool, releaseSha256, itemId, enterprise }) : unavailable('Choose a tool to check compatibility.'),
    ];
    const [evidence, source, compatibility] = await Promise.allSettled(pending);
    return {
      evidence: evidence.status === 'fulfilled' ? evidence.value : failed('The evidence check failed.'),
      source: source.status === 'fulfilled' ? source.value : failed('The source material could not be read.'),
      compatibility: compatibility.status === 'fulfilled' ? compatibility.value : failed('The compatibility check failed.'),
    };
  }

  async function previewPlan(items, { tool, enterprise = false } = {}) {
    if (readOnly) return unavailable(gaps.plan);
    const selections = [...new Set(items.map(item => item.id))].map(id => exactItems.get(id));
    if (!selections.length || selections.some(item => !item)) return unavailable('Choose items from the current Catalog before previewing a plan.');
    try {
      let result = await client.request('new', { mode: enterprise ? 'enterprise' : 'vibe' });
      for (const item of selections) {
        if (result.status !== 'ok' || result.diagnostics?.length || result.value.diagnostics?.length) return result;
        result = await client.request('edit', {
          policyBytes: result.value.policyBytes,
          operation: { type: 'select', root: item.root, ...(tool ? { tool } : {}) },
        });
      }
      if (result.status !== 'ok' || result.diagnostics?.length || result.value.diagnostics?.length) return result;
      return { ...result, bytes: Uint8Array.from(result.value.policyBytes) };
    } catch {
      return failed('The authoring host could not preview this plan.');
    }
  }

  const hostMode = readOnly ? 'read-only' : catalog.status === 'fulfilled' && Array.isArray(catalog.value?.items) ? 'legacy' : 'unavailable';
  return { ...content, clients, tools, gaps, hostMode, repositoryScanAvailable: readOnly,
    packages: Object.fromEntries(packageList.map(pkg => [pkg.name, pkg])),
    inspectTools: () => read('/api/tool-inspection').catch(() => failed('Core could not inspect this machine.')),
    inspectItem, previewPlan };
}

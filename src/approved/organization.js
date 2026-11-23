import {checkedFiles} from './source-files.js';
import { action, downloadJson, facts, fileField, hint, node, readStored, section, store } from './dom.js';

const format = 'aih-workbench-team-selection/1';
const key = 'aih-workbench-local-policy-v1';
const importedKey = 'aih-workbench-imported-policy-v1';

function matchingVersion(current, expected) {
  return typeof current === 'string' && current === expected;
}

export function checkSelection(selection, data) {
  const issues = [];
  if (!selection.organization) issues.push('Enter an organization name.');
  if (!selection.owner) issues.push('Enter a policy owner.');
  if (!selection.clients.length) issues.push('Choose at least one CLI target.');
  if (selection.clients.some(id => !data.clients.some(client => client.id === id))) issues.push('One or more CLI targets are unavailable.');
  if (selection.items.some(id => !data.items.some(item => item.id === id))) issues.push('One or more exact Catalog items are unavailable.');
  for (const [name, version] of Object.entries(selection.versions)) {
    if (!matchingVersion(data.packages?.[name]?.version, version)) issues.push('The installed ' + name + ' version does not match this selection.');
  }
  const available = Object.entries(data.packages ?? {}).filter(([name, info]) =>
    ['core', 'catalog', 'scan'].includes(name) && typeof info?.version === 'string');
  if (!available.length || available.some(([name]) => !selection.versions[name])) issues.push('Pin the installed package versions.');
  return issues;
}

function normalize(value) {
  if (!value || value.format !== format || typeof value.organization !== 'string' ||
    typeof value.owner !== 'string' || typeof value.source !== 'string' ||
    !Array.isArray(value.clients) || !Array.isArray(value.items) ||
    [...value.clients, ...value.items].some(id => typeof id !== 'string') ||
    !value.versions || typeof value.versions !== 'object' || Array.isArray(value.versions) ||
    Object.entries(value.versions).some(([name, version]) => !['core', 'catalog', 'scan'].includes(name) || typeof version !== 'string')) {
    throw new Error('Open a team selection exported by this Workbench.');
  }
  return {
    format, organization: value.organization.trim(), owner: value.owner.trim(),
    source: value.source.trim(), files: checkedFiles(value.files), clients: [...new Set(value.clients)],
    items: [...new Set(value.items)], versions: { ...value.versions },
  };
}

export function selectionFor(draft) {
  return normalize({ format, organization: draft.organization, owner: draft.owner, source: draft.source, files: draft.files,
    clients: draft.clients, items: draft.items, versions: draft.versions });
}

export function publishedSelection() {
  const shared = readStored(key, null);
  const published = shared ?? readStored(importedKey, null);
  if (!published || typeof published.revision !== 'string') return null;
  try {
    return { revision: published.revision, selection: normalize(published.selection), origin: shared ? 'shared locally' : 'imported' };
  } catch {
    return null;
  }
}

export function restrictEnterprise(data, published) {
  const checked = published && checkSelection(published.selection, data).length === 0;
  const allowed = checked ? published.selection : { clients: [], items: [] };
  const choices = new Set(allowed.items);
  const items = data.items.filter(item => choices.has(item.id));
  const frameworks = new Set(items.map(item => item.framework));
  return {
    ...data, items, frameworks: data.frameworks.filter(entry => frameworks.has(entry.id)),
    clients: data.clients.filter(client => allowed.clients.includes(client.id)),
    tools: data.tools.filter(tool => allowed.clients.includes(tool.id)),
    gaps: { ...data.gaps,
      clients: checked ? data.gaps.clients : 'Open a local organization selection to see its CLI targets.',
      catalog: checked ? data.gaps.catalog : 'Open a local organization selection to see its Catalog items.',
    },
  };
}

export function reviewTeamSelection(host, api, publish = false) {
  const current = selectionFor(api.draft);
  const problems = checkSelection(current, api.data);
  const review = JSON.stringify(current);
  const reviewed = api.draft.reviewed === review;
  const latest = publishedSelection();
  const output = node('p', null, 'ix-hint');
  output.setAttribute('role', 'status');
  const info = facts([
    ['Organization', current.organization || 'Required'],
    ['Policy owner', current.owner || 'Required'],
    ['CLI targets', String(current.clients.length)],
    ['Exact Catalog items', String(current.items.length)],
    ['Supporting files shared with members', current.files.map(file=>file.name).join(', ') || 'None'],
    ['Current local revision', latest?.revision],
  ]);
  const list = node('ul');
  for (const issue of problems) list.append(node('li', issue));
  const buttons = node('div', null, 'ix-buttons');
  let save;
  if (publish) {
    save = action('Share revision in this browser', () => {
      const latestDraft = selectionFor(api.draft);
      if (JSON.stringify(latestDraft) !== api.draft.reviewed || checkSelection(latestDraft, api.data).length) {
        output.textContent = 'Review the current selection before sharing it.';
        return;
      }
      const revision = crypto.randomUUID();
      if (!store(key, { revision, selection: latestDraft })) {
        output.textContent = 'The browser could not store this revision.';
        return;
      }
      output.textContent = 'Shared in this browser. Switch to Enterprise User to see this revision.';
      save.disabled = true;
    }, true);
    save.disabled = !reviewed || problems.length > 0;
    if (!reviewed) output.textContent = 'Record a review of this exact draft first.';
  } else {
    save = action('Record review of this draft', () => {
      api.change('reviewed', review);
      output.textContent = 'Review recorded for this draft.';
      save.disabled = true;
    }, true);
    save.disabled = reviewed || problems.length > 0;
    if (reviewed) output.textContent = 'Review recorded for this draft.';
  }
  buttons.append(save, action('Export selection', () => downloadJson('workbench-team-selection.json', current)));
  host.append(section(publish ? 'Local organization selection' : 'Review the organization selection', info,
    hint('This selection controls what the Enterprise User can choose in this browser. Core remains the policy and execution authority.'),
    list, buttons, output));
}

export function showEnterprisePolicy(host, api) {
  const { published, fullData } = api;
  const output = section('Organization selection');
  if (published) {
    output.append(facts([
      ['Organization', published.selection.organization],
      ['Policy owner', published.selection.owner],
      ['Local revision', published.revision],
      ['Source', published.origin],
      ['CLI targets', String(published.selection.clients.length)],
      ['Catalog items', String(published.selection.items.length)],
    ]));
    for (const issue of checkSelection(published.selection, fullData)) output.append(hint(issue));
  } else {
    output.append(hint('There is no organization selection available in this browser.'));
  }
  if (published?.origin === 'shared locally') {
    host.append(output);
    return;
  }
  output.append(fileField('Open team selection', '.json,application/json', async file => {
    if (file.size > 1024 * 1024) throw new Error('Choose a team selection smaller than 1 MB.');
    const selection = normalize(JSON.parse(await file.text()));
    const issues = checkSelection(selection, fullData);
    if (issues.length) throw new Error(issues.join(' '));
    if (!store(importedKey, { revision: crypto.randomUUID(), selection })) throw new Error('The browser could not open this selection.');
    api.refresh();
    api.status('Team selection opened for this browser.');
  }, api.status));
  host.append(output);
}

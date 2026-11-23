import { action, checkbox, download, downloadJson, facts, field, fileField, hint, input, link, node, section } from './dom.js';
import { repositoryScan } from './repository-scan.js';
import { renderCatalog } from './catalog.js';
import { showEnterprisePolicy, reviewTeamSelection } from './organization.js';
import { renderScan } from './scan.js';

const personalSteps = [
  ['clients', 'CLI targets', 'Choose the clients and a base for each.'],
  ['content', 'Catalog and your files', 'Add Catalog items or record your own configuration sources.'],
  ['tools', 'Guides and Tool Setup', 'Choose the tools and instructions for this repository.'],
  ['self-scan', 'Self-scan', 'Review evidence for the content you are considering.'],
  ['preview', 'Preview and verify', 'Check the choices for each CLI before saving.'],
  ['files', 'Saved setup files', 'Export or reopen a setup you can use again.'],
];

const adminSteps = [
  ['org', 'Your organization', 'Identify the policy owner and choose the clients this policy covers.'],
  ['versions', 'Choose version pins', 'Review the product and data versions this policy can refer to.'],
  ['catalog', 'Select from Catalog', 'Choose the Catalog items to include in policy review.'],
  ['byo', 'Bring your own content', 'Record organization-owned sources separately from Catalog.'],
  ['scan', 'Scan your repository', 'Review available Scan evidence before continuing.'],
  ['review', 'Review policy changes', 'Review the draft and check whether the host can prepare it.'],
  ['publish', 'Publish for your team', 'Confirm the organization destination and available publication capability.'],
];

export function stepsFor(role) {
  const steps = role === 'admin' ? adminSteps : [
    role === 'enterprise'
      ? ['start', 'Organization policy', 'Read the policy that governs this setup.']
      : ['start', 'Starting point', 'Start fresh, open a setup file, or choose a reusable Profile.'],
    ...personalSteps,
  ];
  return steps.map(([id, title, description]) => ({ id, title, description }));
}

const draftFormat = 'aih-workbench-setup/1';
export const emptyDraft = () => ({
  format: draftFormat, clients: [], items: [], organization: '', owner: '', source: '', instructions: '', firstTask: '', tools: [], versions: {}, reviewed: '',
});

function cleanDraft(value) {
  if (value?.format !== draftFormat) throw new Error('Open a setup exported by this Workbench.');
  const draft = emptyDraft();
  for (const key of Object.keys(draft)) {
    const field = value[key] ?? emptyDraft()[key];
    if (Array.isArray(draft[key])) {
      if (!Array.isArray(field) || field.some(entry => typeof entry !== 'string')) throw new Error('Invalid setup selection.');
      draft[key] = [...new Set(field)];
    } else if (key === 'versions') {
      if (typeof field !== 'object' || Array.isArray(field) || Object.values(field).some(version => typeof version !== 'string')) throw new Error('Invalid version pins.');
      draft.versions = { ...field };
    } else {
      if (typeof field !== 'string') throw new Error('Invalid setup details.');
      draft[key] = field;
    }
  }
  return draft;
}

function setChoice(api, key, id, checked) {
  const choices = api.draft[key];
  api.change(key, checked ? [...new Set([...choices, id])] : choices.filter(old => old !== id));
}

function clients(api) {
  const choices = node('div', null, 'ix-client-options');
  for (const client of api.data.clients) {
    choices.append(checkbox(client.name, api.draft.clients.includes(client.id),
      checked => setChoice(api, 'clients', client.id, checked)));
  }
  if (!choices.childElementCount) choices.append(hint(api.data.gaps.clients ?? 'No CLI targets were published.'));
  return choices;
}

function files(api) {
  const buttons = node('div', null, 'ix-buttons');
  buttons.append(action('Export setup', () => downloadJson('workbench-setup.json', api.draft), true),
    fileField('Open a saved setup', '.json,application/json', async file => {
      if (file.size > 1024 * 1024) throw new Error('Choose a saved setup smaller than 1 MB.');
      const draft = cleanDraft(JSON.parse(await file.text()));
      if (api.role === 'enterprise' && (
        draft.clients.some(id => !api.data.clients.some(client => client.id === id)) ||
        draft.items.some(id => !api.data.items.some(item => item.id === id)))) {
        throw new Error('This setup contains choices outside the current organization selection.');
      }
      if (api.role === 'admin') draft.reviewed = '';
      api.replaceDraft(draft);
      api.status('Saved setup opened.');
    }, api.status));
  return buttons;
}

function plan(host, api) {
  const { draft, data, role } = api;
  const selected = draft.items.map(id => data.items.find(item => item.id === id)).filter(Boolean);
  const eligibleClients = data.clients.filter(client => draft.clients.includes(client.id));
  const details = section('Draft selections', facts([
    ['CLI targets', eligibleClients.map(client => client.name).join(', ') || 'None'],
    ['Catalog items', selected.map(item => item.title).join(', ') || 'None'],
    ['Tool preferences', draft.tools.map(id => data.tools.find(tool => tool.id === id)?.label ?? id).join(', ') || null],
    ['Unavailable selections', selected.length === draft.items.length ? null : String(draft.items.length - selected.length)],
    ['First task', draft.firstTask || null],
    ['Personal files and supporting instructions', draft.source || draft.instructions ? 'Recorded in the setup file' : 'None'],
  ]));
  const output = node('div', null, 'ix-stack');
  output.setAttribute('role', 'status');
  const preview = action('Check Catalog selection', async () => {
    preview.disabled = true;
    output.replaceChildren(hint('Checking the Catalog selections with the authoring host…'));
    try {
      output.replaceChildren();
      for (const client of eligibleClients) {
        const row = section(client.name);
        row.append(hint('Checking…'));
        output.append(row);
        const result = await data.previewPlan(selected, { tool: client.id, enterprise: role !== 'individual' });
        const diagnostics = [...(result.diagnostics ?? []), ...(result.value?.diagnostics ?? [])];
        row.replaceChildren(node('h3', client.name),
          hint(result.bytes ? 'Catalog selection prepared for this target.' : result.reason ?? 'Review the authoring result for this target.'));
        for (const diagnostic of diagnostics) row.append(hint(diagnostic.message ?? diagnostic.code));
        if (result.bytes) row.append(action('Export reviewed selection', () => download('workbench-selection.json', result.bytes)));
      }
    } catch (error) {
      output.append(hint(error.message));
    } finally {
      preview.disabled = false;
    }
  }, true);
  if (data.gaps.plan) details.append(hint(data.gaps.plan));
  preview.disabled = !data.previewPlan || Boolean(data.gaps.plan) || !selected.length || selected.length !== draft.items.length || !eligibleClients.length;
  host.append(details, section(null, preview, output));
}

function tools(host, api) {
  const choices = node('div', null, 'ix-tool-list');
  for (const tool of api.data.tools) {
    const details = node('details', null, 'ix-tool-card');
    const name = tool.label ?? tool.name ?? tool.id;
    details.append(node('summary', name), facts([
      ['Tool ID', tool.id], ['Surface', tool.surface],
    ]), checkbox('Include ' + name + ' in the setup notes', api.draft.tools.includes(tool.id),
      checked => setChoice(api, 'tools', tool.id, checked)));
    choices.append(details);
  }
  if (!choices.childElementCount) choices.append(hint(api.data.gaps.tools ?? 'No tools were published.'));
  const result = node('div', null, 'ix-stack');
  const inspect = action('Check tools on this machine', async () => {
    inspect.disabled = true;
    result.replaceChildren(hint('Core is checking local tools…'));
    try {
      const report = await api.data.inspectTools();
      result.replaceChildren(hint(report.reason ?? 'Core tool inspection results'));
      const rows = report.tools ?? report.observations ?? report.value?.tools;
      if (Array.isArray(rows)) {
        for (const tool of rows) result.append(facts([
          ['Tool', tool.label ?? tool.id], ['Status', tool.status ?? tool.state], ['Version', tool.version],
        ]));
      }
    } catch (error) {
      result.replaceChildren(hint(error.message));
    } finally {
      inspect.disabled = false;
    }
  });
  inspect.disabled = !api.data.inspectTools;
  host.append(section('Guides and supporting instructions',
    field('Supporting instructions', input(api.draft.instructions, value => api.change('instructions', value), true))),
  section('Core tools', inspect, result, choices));
}

export function renderJourney(host, step, api) {
  const { draft, data, role, change } = api;
  if (step === 'start') {
    if (role === 'enterprise') showEnterprisePolicy(host, api);
    else host.append(section('Start a personal setup',
      hint('Select your CLI targets now or choose a reusable starting point.'),
      field('First task', input(draft.firstTask, value => change('firstTask', value))),
      link('Choose a Profile', api.route('profiles')), files(api)));
  } else if (step === 'org') {
    host.append(section('Organization details',
      field('Organization name', input(draft.organization, value => change('organization', value))),
      field('Policy owner', input(draft.owner, value => change('owner', value))),
      section('CLI targets', clients(api))));
  } else if (step === 'versions') {
    const entries = Object.entries(data.packages ?? {}).flatMap(([name, value]) => {
      const version = typeof value === 'string' ? value : value?.version;
      return version ? [[name, version]] : [];
    });
    const supported = entries.filter(([name]) => ['core', 'catalog', 'scan'].includes(name));
    const pin = action('Pin installed versions', () => {
      change('versions', Object.fromEntries(supported));
      api.refresh();
      api.status('Installed versions pinned in this draft.');
    }, true);
    pin.disabled = !supported.length;
    host.append(section('Installed package versions', supported.length ? facts(supported) : hint('No installed package versions were supplied.'),
      section('Draft version pins', Object.keys(draft.versions).length ? facts(Object.entries(draft.versions)) : hint('No versions pinned.'), pin)),
      section('Catalog sources', data.frameworks.length ? facts(data.frameworks.map(f => [f.name, f.sha256 ?? f.state])) : hint(data.gaps.catalog ?? 'No sources are configured.')));
  } else if (step === 'clients') {
    host.append(section('Choose CLI targets', clients(api)));
  } else if (step === 'content' || step === 'catalog') {
    const panel = section('Select from Catalog');
    host.append(panel);
    renderCatalog(panel, api, draft.items, items => change('items', items));
    if (step === 'content') host.append(section('Your files',
      field('Source reference', input(draft.source, value => change('source', value)))));
  } else if (step === 'byo') {
    host.append(section('Organization-owned source',
      field('Source reference', input(draft.source, value => change('source', value)))));
  } else if (step === 'tools') {
    tools(host, api);
  } else if (step === 'scan' || step === 'self-scan') {
    if (api.data.repositoryScanAvailable) repositoryScan(host);
    renderScan(host, api);
  } else if (step === 'review') {
    reviewTeamSelection(host, api);
  } else if (step === 'preview') {
    plan(host, api);
  } else if (step === 'files' || step === 'publish') {
    if (step === 'publish') {
      reviewTeamSelection(host, api, true);
      host.append(section('Organization publication',
        hint(data.gaps.publication ?? 'An organization publication service must review and accept the policy.')));
    }
    host.append(section(step === 'publish' ? 'Keep the draft' : 'Saved setup files', files(api)));
  }
}

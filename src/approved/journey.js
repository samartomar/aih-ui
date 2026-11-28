import {checkedFiles, sourceFiles} from './source-files.js';
import { action, checkbox, download, downloadJson, facts, field, fileField, hint, input, link, node, section } from './dom.js';
import { repositoryScan } from './repository-scan.js';
import { renderVersionSets, versionUnavailable } from './versions.js';
import { renderCatalog } from './catalog.js';
import { savedCatalogChoices } from './catalog-choices.js';
import { showEnterprisePolicy, reviewTeamSelection } from './organization.js';
import { renderToolSetup } from './tool-setup.js';
import { renderScan } from './scan.js';
import { personalPreparation } from './personal.js';
import { enterprisePreparation } from './enterprise.js';

const personalSteps = [
  ['clients', 'CLI targets', 'Choose the clients and a base for each.'],
  ['content', 'Catalog and your files', 'Add Catalog items or record your own configuration sources.'],
  ['tools', 'Guides and Tool Setup', 'Choose the tools and instructions for this repository.'],
  ['self-scan', 'Self-scan', 'Review evidence for the content you are considering.'],
  ['preview', 'Preview and verify', 'Check the choices for each CLI before saving.'],
  ['files', 'Saved setup files', 'Export or reopen a setup you can use again.'],
];

const adminSteps = [
  ['org', 'Your organization', 'Name the organization and choose the clients this policy covers.'],
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
  format: draftFormat, allowPersonal:false, clients: [], items: [], catalogChoices: {}, organization: '', source: '', instructions: '', instructionUpdates: 'review', firstTask: '', files: [], tools: [], bases: {}, toolExclusions: [], toolClientExclusions: [], guides: 'included', toolPlatform: 'windows-x64', versions: {}, versionSet: '', reviewed: '',
});

function cleanDraft(value) {
  if (value?.format !== draftFormat) throw new Error('Open a setup exported by this Workbench.');
  const draft = emptyDraft();
  for (const key of Object.keys(draft)) {
    const field = value[key] ?? draft[key];
    if (key === 'allowPersonal') {
      if (typeof field !== 'boolean') throw Error('Invalid personal file permission.');
      draft.allowPersonal = field;
    } else if (key === 'files') {
      draft.files = checkedFiles(field);
    } else if (key === 'catalogChoices') {
      draft.catalogChoices = savedCatalogChoices(field, draft.items);
    } else if (Array.isArray(draft[key])) {
      if (!Array.isArray(field) || field.some(entry => typeof entry !== 'string')) throw new Error('Invalid setup selection.');
      draft[key] = [...new Set(field)];
    } else if (key === 'versions' || key === 'bases') {
      if (typeof field !== 'object' || Array.isArray(field) || Object.values(field).some(version => typeof version !== 'string')) throw new Error('Invalid selections.');
      draft[key] = { ...field };
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

function targets(api) {
  const panel = section('Choose CLI targets', clients(api));
  const setup = section('Choose a starting framework');
  function refresh() {
    setup.replaceChildren(node('h3', 'Choose a starting framework'));
    const chosen = api.data.clients.filter(client => api.draft.clients.includes(client.id));
    if (!chosen.length) setup.append(hint('Select a CLI target to choose its starting framework.'));
    for (const client of chosen) {
      const select = node('select');
      select.append(new Option('Choose later', ''));
      for (const framework of api.data.frameworks) {
        if (framework.state === 'ready' || api.data.items.some(item => item.framework === framework.id)) {
          select.append(new Option(framework.name, framework.id));
        }
      }
      const saved = api.draft.bases?.[client.id];
      if (saved && !Array.from(select.options).some(option => option.value === saved)) {
        const option = new Option('Saved framework is unavailable', saved);
        option.disabled = true;
        select.append(option);
      }
      select.value = saved ?? '';
      select.addEventListener('change', () => api.change('bases', { ...api.draft.bases, [client.id]: select.value }));
      setup.append(field(client.name + ' framework', select));
    }
  }
  panel.addEventListener('change', refresh);
  refresh();
  return [panel, setup];
}

function files(api) {
  const buttons = node('div', null, 'ix-buttons');
  buttons.append(action('Export setup', () => downloadJson('workbench-setup.json', api.draft), true),
    fileField('Open a saved setup', '.json,application/json', async file => {
      if (file.size > 1024 * 1024) throw new Error('Choose a saved setup smaller than 1 MB.');
      const draft = cleanDraft(JSON.parse(await file.text()));
      if (api.role === 'enterprise' && (
        draft.clients.some(id => !api.data.clients.some(client => client.id === id)) ||
        draft.items.some(id => !api.data.items.some(item => item.id === id)) ||
        Object.values(draft.bases).some(id => id && !api.data.frameworks.some(framework => framework.id === id)))) {
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
    ['Starting frameworks', eligibleClients.flatMap(client => {
      const saved = draft.bases[client.id];
      if (!saved) return [];
      return [client.name + ': ' + (data.frameworks.find(framework => framework.id === saved)?.name ?? 'Unavailable')];
    }).join(', ') || null],
    ['Catalog items', selected.map(item => item.title).join(', ') || 'None'],
    ['Guides', draft.guides === 'included' ? 'Included in draft' : 'Omitted from draft'],
    ['Tool Setup platform', draft.toolPlatform],
    ['Unavailable selections', selected.length === draft.items.length ? null : String(draft.items.length - selected.length)],
    ['First task', draft.firstTask || null],
    ['Supporting files', draft.files.map(file => file.name).join(', ') || 'None'],
    ['Source and instructions', draft.source || draft.instructions ? 'Recorded in the setup file' : 'None'],
  ]));
  if (selected.length !== draft.items.length) {
    details.append(link('Review earlier Catalog choices', api.route('content')));
  }
  const output = node('div', null, 'ix-stack');
  if (role === 'enterprise' && data.hostMode === 'read-only') {
    host.append(details);
    enterprisePreparation(host, api, selected, eligibleClients);
    return;
  }
  if (role === 'individual' && data.hostMode === 'read-only') {
    host.append(details);
    personalPreparation(host, api, selected.length === draft.items.length ? selected : [], eligibleClients);
    return;
  }
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

export function renderJourney(host, step, api) {
  const { draft, data, role, change } = api;
  if (role === 'admin' && step !== 'versions' && step !== 'org' && versionUnavailable(draft.versions, data)) {
    host.append(section('Version set unavailable', hint('This draft refers to a version set that is not installed.'),
      link('Choose installed versions', api.route('versions'))));
    return;
  }
  if (step === 'start') {
    if (role === 'enterprise') showEnterprisePolicy(host, api);
    else host.append(section('Start a personal setup',
      hint('Select your CLI targets now or choose a reusable starting point.'),
      field('First task', input(draft.firstTask, value => change('firstTask', value))),
      link('Choose a Profile', api.route('profiles')), files(api)));
  } else if (step === 'org') {
    host.append(section('Organization details',
      field('Organization name', input(draft.organization, value => change('organization', value))),
      section('CLI targets', clients(api))));
  } else if (step === 'versions') {
    renderVersionSets(host, api);
  } else if (step === 'clients') {
    host.append(...targets(api));
  } else if (step === 'content' || step === 'catalog') {
    const panel = section('Select from Catalog');
    host.append(panel);
    renderCatalog(panel, api);
    if (step === 'content') sourceFiles(host, api);
  } else if (step === 'byo') {
    sourceFiles(host, api);
    host.append(checkbox('Permit members to add a personal instruction file', draft.allowPersonal, value=>change('allowPersonal',value)));
  } else if (step === 'tools') {
    renderToolSetup(host, api);
  } else if (step === 'scan' || step === 'self-scan') {
    if (api.data.repositoryScanAvailable) repositoryScan(host, api);
    renderScan(host, api);
  } else if (step === 'review') {
    reviewTeamSelection(host, api);
  } else if (step === 'preview') {
    plan(host, api);
  } else if (step === 'files' || step === 'publish') {
    if (step === 'publish') {
      reviewTeamSelection(host, api, true);

    }
    host.append(section(step === 'publish' ? 'Keep the draft' : 'Saved setup files', files(api)));
  }
}

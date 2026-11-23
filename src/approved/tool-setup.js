import { action, checkbox, downloadJson, field, hint, input, link, node, section } from './dom.js';

const platforms = {
  'windows-x64': 'Windows · x64', 'windows-arm64': 'Windows · Arm64',
  'darwin-arm64': 'macOS · Apple silicon', 'darwin-x64': 'macOS · Intel',
  'linux-x64': 'Linux · x64', 'linux-arm64': 'Linux · Arm64',
};

export function selectedToolRecipes(items, exclusions = []) {
  return items.filter(item => item.kind === 'ai-setup' && !exclusions.includes(item.id));
}

async function previewSetup(ids, client, platform) {
  const query = new URLSearchParams({ client, platform });
  for (const id of ids) query.append('item', id);
  const response = await fetch('/api/approved-tool-plan?' + query);
  if (response.headers.get('content-type')?.includes('application/json')) return response.json();
  return { status: 'unavailable', reason: 'A pinned Catalog recipe source is required to preview tool setup.' };
}

function planResult(client, result) {
  const operations = result.plan ?? [];
  const state = { ok: 'Ready for local review', incomplete: 'Needs input' }[result.status] ?? 'Unavailable';
  const box = node('details', null, 'ix-tool-card');
  box.open = true;
  box.append(node('summary', client.name + ' · ' + state + ' · ' + operations.length + ' proposed changes'));
  if (result.reason) box.append(hint(result.reason));
  for (const note of [...(result.unavailable ?? []), ...(result.messages ?? [])]) {
    box.append(hint(note.detail ?? note.message ?? note.reason ?? note.code));
  }
  if (operations.length) {
    const list = node('ol');
    for (const operation of operations) {
      const label = { acquire: 'Prepare tool', write: 'Write file', merge: 'Update configuration', 'tool-command': 'Set tool option' }[operation.op] ?? operation.op;
      const detail = operation.path ?? operation.into ?? operation.argv?.join(' ') ?? operation.aiSetup ?? operation.item;
      list.append(node('li', [label, detail].filter(Boolean).join(' · ')));
    }
    box.append(list);
  }
  return box;
}

export function renderToolSetup(host, api) {
  const { draft, data, change } = api;
  const guide = checkbox('Include AIH Guides', draft.guides !== 'excluded',
    checked => change('guides', checked ? 'included' : 'excluded'));
  const guides = section('Guides and supporting instructions', guide,
    field('Supporting instructions', input(draft.instructions, value => change('instructions', value), true)),
    checkbox('Allow suggested updates to these instructions', draft.instructionUpdates === 'allowed',
      checked => change('instructionUpdates', checked ? 'allowed' : 'review')));
  host.append(guides);

  const recipes = selectedToolRecipes(data.items);
  if (!recipes.length) {
    const reason = api.role === 'enterprise' ? 'The current organization selection offers no Tool Setup recipes.'
      : 'No Tool Setup recipes are available from the connected Catalog.';
    host.append(section('Tool Setup', hint(reason)));
    return;
  }
  const choices = node('fieldset', null, 'ix-tool-list');
  choices.append(node('legend', 'Pick tools'));
  const selected = () => selectedToolRecipes(recipes, draft.toolExclusions);
  for (const item of recipes) {
    const card = node('div', null, 'ix-tool-card');
    card.append(checkbox(item.frameworkName ?? item.title, selected().includes(item), checked => {
      const exclusions = new Set(draft.toolExclusions);
      if (checked) exclusions.delete(item.id);
      else exclusions.add(item.id);
      change('toolExclusions', [...exclusions]);
      invalidate();
    }));
    if (item.description) card.append(hint(item.description));
    choices.append(card);
  }

  const clients = data.clients.filter(client => draft.clients.includes(client.id));
  const targets = () => clients.filter(client => !draft.toolClientExclusions?.includes(client.id));
  const targetChoices = node('fieldset', null, 'ix-tool-list');
  targetChoices.append(node('legend', 'CLI targets'));
  for (const client of clients) {
    targetChoices.append(checkbox(client.name, targets().includes(client), checked => {
      const exclusions = new Set(draft.toolClientExclusions);
      if (checked) exclusions.delete(client.id);
      else exclusions.add(client.id);
      change('toolClientExclusions', [...exclusions]);
      invalidate();
    }));
  }
  const platform = node('select');
  for (const [id, name] of Object.entries(platforms)) platform.add(new Option(name, id));
  platform.value = Object.hasOwn(platforms, draft.toolPlatform) ? draft.toolPlatform : 'windows-x64';
  platform.addEventListener('change', () => {
    change('toolPlatform', platform.value);
    invalidate();
  });
  const status = hint('');
  status.setAttribute('role', 'status');
  const output = node('div', null, 'ix-stack');
  let revision = 0;
  const preview = action('Preview setup', async () => {
    const began = ++revision;
    const ids = selected().map(item => item.id);
    const targetPlatform = platform.value;
    preview.disabled = true;
    status.textContent = 'Reading the pinned Catalog preview…';
    output.replaceChildren();
    try {
      const results = await Promise.all(targets().map(async client => ({
        client, result: await previewSetup(ids, client.id, targetPlatform),
      })));
      if (revision !== began || !host.isConnected) return;
      status.textContent = 'Review the proposed project changes for each CLI.';
      for (const { client, result } of results) output.append(planResult(client, result));
      if (results.some(({ result }) => result.source)) {
        output.append(action('Export tool setup preview', () => downloadJson('aih-tool-setup-preview.json', {
          format: 'aih-tool-setup-preview/1', platform: targetPlatform, execution: 'preview-only', recipeIds: ids, results,
        })));
      }
    } catch {
      if (revision === began) status.textContent = 'The pinned Catalog preview could not be read.';
    } finally {
      if (revision === began) preview.disabled = false;
    }
  }, true);

  function invalidate() {
    revision++;
    output.replaceChildren();
    status.textContent = !selected().length ? 'Choose a tool to preview its setup.'
      : !targets().length ? 'Choose a CLI target to preview its setup.' : '';
    preview.disabled = !targets().length || !selected().length;
  }
  invalidate();
  host.append(section('Tool Setup', choices,
    field('Target platform', platform),
    clients.length ? targetChoices : link('Choose CLI targets', api.route('clients')),
    preview, status, output));
}

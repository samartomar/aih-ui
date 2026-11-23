import { action, checkbox, downloadJson, facts, field, fileField, hint, input, node, section, readStored, store } from './dom.js';
import { make as icon } from './icons.js';

const libraryKey = 'aih-workbench-profiles-v1';
const format = 'aih-workbench-profile/1';
const priorFormat = 'aih-portable-profile/1';
const optionalText = value => typeof value === 'string' ? value : '';

function readProfile(value) {
  if (value?.format === priorFormat) {
    const { id, name, description, catalogIds, firstTask, instructions, byo } = value;
    value = { format, id: optionalText(id) || crypto.randomUUID(), name, description: optionalText(description),
      items: catalogIds, clients: [], firstTask, instructions, byo };
  }
  if (value?.format !== format || typeof value.id !== 'string' ||
    typeof value.name !== 'string' || !value.name.trim() ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.items) || value.items.some(id => typeof id !== 'string') ||
    !Array.isArray(value.clients) || value.clients.some(id => typeof id !== 'string')) {
    throw new Error('Open a Profile exported by this Workbench.');
  }
  const { id, name, description, items, clients, firstTask, instructions, byo } = value;
  return { format, id, name, description, items: [...new Set(items)], clients: [...new Set(clients)],
    firstTask: optionalText(firstTask), instructions: optionalText(instructions),
    byo: Array.isArray(byo) ? byo.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      return [{ name: optionalText(entry.name), kind: optionalText(entry.kind), source: optionalText(entry.source), revision: optionalText(entry.revision) }];
    }) : [] };

}

function library() {
  const saved = readStored(libraryKey, []);
  if (!Array.isArray(saved)) return [];
  return saved.flatMap(profile => {
    try { return [readProfile(profile)]; } catch { return []; }
  });
}

function put(profile) {
  return store(libraryKey, [...library().filter(old => old.id !== profile.id), profile]);
}

export function renderProfiles(host, api) {
  const shelf = node('div', null, 'ix-profile-grid');
  const inspector = section(null);
  const privateNote = hint('Profiles you create or import here stay in this browser. Export a copy to share it.');
  let selected = null;

  function showShelf() {
    const profiles = library();
    shelf.replaceChildren();
    for (const profile of profiles) {
      const button = action(profile.name, () => {
        selected = profile.id;
        showShelf();
        preview(profile);
      });
      button.className = 'ix-profile-card';
      button.setAttribute('aria-pressed', String(profile.id === selected));
      button.prepend(icon('book', { size: 21 }));
      if (profile.description) button.append(hint(profile.description));
      shelf.append(button);
    }
    if (!profiles.length) shelf.append(hint(api.data.gaps.profiles ?? 'Your Profile library is empty.'));
  }

  function preview(profile) {
    const items = new Map(api.data.items.map(item => [item.id, item]));
    const resolve = id => {
      if (items.has(id)) return items.get(id);
      const matching = api.data.items.filter(item => item.itemId === id);
      return matching.length === 1 ? matching[0] : undefined;
    };
    const clients = new Map(api.data.clients.map(client => [client.id, client.name]));
    const list = node('ul');
    for (const id of profile.items) list.append(node('li', resolve(id)?.title ?? id + ' · unavailable'));
    inspector.replaceChildren(node('h3', profile.name), hint(profile.description), facts([
      ['CLI targets', profile.clients.map(id => clients.get(id) ?? id + ' · unavailable').join(', ') || 'None'],
      ['Catalog items', String(profile.items.length)],
      ['First task', profile.firstTask || null],
      ['Supporting instructions', profile.instructions || null],
      ['Own sources', profile.byo?.map(source => source.name || source.source).filter(Boolean).join(', ') || null],
    ]), list);
    const buttons = node('div', null, 'ix-buttons');
    buttons.append(action('Edit Profile', () => edit(profile)), action('Export Profile', () => downloadJson('workbench-profile.json', profile)));
    if (api.role !== 'admin') buttons.prepend(action('Use this Profile', () => {
      if (api.role === 'enterprise' && (!api.published || profile.items.some(id => !resolve(id)) ||
        profile.clients.some(id => !clients.has(id)))) {
        api.status('This Profile contains choices outside the current organization selection.');
        return;
      }
      api.change('items', [...new Set([...api.draft.items, ...profile.items.map(id => resolve(id)?.id ?? id)])]);
      api.change('clients', [...new Set([...api.draft.clients, ...profile.clients])]);
      if (profile.firstTask) api.change('firstTask', profile.firstTask);
      if (profile.instructions) api.change('instructions', [api.draft.instructions, profile.instructions].filter(Boolean).join('\n\n'));
      if (profile.byo?.length) api.change('source', [api.draft.source, ...profile.byo.map(entry => entry.source)].filter(Boolean).join('\n'));
      api.returnFromProfiles('Profile added to your setup.');
    }, true));
    inspector.append(buttons);
  }

  function edit(profile) {
    const draft = profile ? { ...profile } : {
      format, id: crypto.randomUUID(), name: '', description: '',
      items: [...api.draft.items], clients: [...api.draft.clients],
      firstTask: api.draft.firstTask, instructions: api.draft.instructions,
      byo: api.draft.source ? [{ name: '', kind: '', source: api.draft.source, revision: '' }] : [],
    };
    const name = input(draft.name, value => { draft.name = value; });
    const chooser = node('div', null, 'ix-options');
    for (const client of api.data.clients) chooser.append(checkbox(client.name, draft.clients.includes(client.id), checked => {
      draft.clients = checked ? [...draft.clients, client.id] : draft.clients.filter(id => id !== client.id);
    }));
    inspector.replaceChildren(node('h3', profile ? 'Edit Profile' : 'Create a Profile'),
      field('Profile name', name),
      field('Description', input(draft.description, value => { draft.description = value; }, true)),
      field('First task', input(draft.firstTask, value => { draft.firstTask = value; })),
      field('Supporting instructions', input(draft.instructions, value => { draft.instructions = value; }, true)),
      field('CLI targets', chooser),
      hint(draft.items.length + ' Catalog items from the saved selection'),
      action('Save Profile', () => {
        draft.name = draft.name.trim();
        if (!draft.name) { name.focus(); api.status('Enter a Profile name.'); return; }
        if (!put(draft)) { api.status('The browser could not save this Profile.'); return; }
        selected = draft.id;
        showShelf();
        preview(draft);
        api.status('Profile saved in this browser.');
      }, true));
    name.focus();
  }

  const controls = node('div', null, 'ix-buttons');
  controls.append(action('Create Profile', () => edit(), true),
    fileField('Import Profile', '.json,application/json', async file => {
      if (file.size > 1024 * 1024) throw new Error('Choose a Profile smaller than 1 MB.');
      const profile = readProfile(JSON.parse(await file.text()));
      if (library().some(entry => entry.id === profile.id)) profile.id = crypto.randomUUID();
      if (!put(profile)) throw new Error('The browser could not save this Profile.');
      selected = profile.id;
      showShelf();
      preview(profile);
    }, api.status));
  host.append(section(null, controls, privateNote, shelf), inspector);
  showShelf();
}

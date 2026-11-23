import { action, checkbox, downloadJson, facts, field, fileField, hint, input, node, section, readStored, store } from './dom.js';
import { make as icon } from './icons.js';

const libraryKey = 'aih-workbench-profiles-v1';
const sharedKey = 'aih-workbench-shared-profiles-v1';
const format = 'aih-workbench-profile/1';
const priorFormat = 'aih-portable-profile/1';
const optionalText = value => typeof value === 'string' ? value : '';

export function readProfile(value) {
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

function library(key = libraryKey) {
  const saved = readStored(key, []);
  if (!Array.isArray(saved)) return [];
  return saved.flatMap(profile => {
    try { return [readProfile(profile)]; } catch { return []; }
  });
}

function put(profile, key = libraryKey) {
  return store(key, [...library(key).filter(old => old.id !== profile.id), profile]);
}

export function renderProfiles(host, api) {
  const personalKey = api.role === 'individual' ? libraryKey : libraryKey + ':' + api.role;
  const shelf = node('ul', null, 'ix-profile-grid');
  const inspector = section(null);
  const sources = new Map([['saved', 'Saved in this browser'], ['shared', 'Shared in this browser'], ['host', 'Host library']]);
  const filter = node('select');
  filter.append(new Option('All sources', ''));
  for (const [id, label] of sources) filter.append(new Option(label, id));
  const privateNote = hint('Local publication makes a copy available to the other roles in this browser. Export a Profile file to share it elsewhere.');
  let hostLibrary = [];
  let hostStatus = 'Loading the host library…';
  let selected = null;

  function showShelf() {
    const collections = [
      ['saved', library(personalKey)],
      ['shared', library(sharedKey)],
      ['host', hostLibrary],
    ];
    const profiles = collections.filter(([kind]) => !filter.value || filter.value === kind)
      .flatMap(([kind, entries]) => entries.map(profile => ({ kind, profile })));
    shelf.replaceChildren();
    for (const { kind, profile } of profiles) {
      const key = kind + ':' + profile.id;
      const button = action(profile.name, () => {
        selected = key;
        showShelf();
        preview(profile, kind);
      });
      button.className = 'ix-profile-card';
      button.setAttribute('aria-pressed', String(key === selected));
      const cover = node('span', null, 'ix-profile-cover');
      cover.append(icon('book', { size: 21 }), icon('arrow-up-right', { size: 13 }));
      button.prepend(cover);
      if (profile.description) button.append(hint(profile.description));
      button.append(hint(sources.get(kind)));
      const entry = node('li');
      entry.append(button);
      shelf.append(entry);
    }
    if (!profiles.length) shelf.append(node('li', filter.value === 'host' ? hostStatus : 'No Profiles in this view.', 'ix-hint'));
  }

  function preview(profile, kind = 'saved') {
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
      ['Source', sources.get(kind)],
      ['CLI targets', profile.clients.map(id => clients.get(id) ?? id + ' · unavailable').join(', ') || 'None'],
      ['Catalog items', String(profile.items.length)],
      ['First task', profile.firstTask || null],
      ['Supporting instructions', profile.instructions || null],
      ['Own sources', profile.byo?.map(source => source.name || source.source).filter(Boolean).join(', ') || null],
    ]), list);
    const buttons = node('div', null, 'ix-buttons');
    buttons.append(action(kind === 'saved' ? 'Edit Profile' : 'Copy to edit', () => edit(kind === 'saved' ? profile : { ...profile, id: crypto.randomUUID() })),
      action('Export Profile', () => downloadJson('workbench-profile.json', profile)));
    if (kind === 'saved') {
      const publish = action('Publish Profile in this browser', () => {
        if (!put(profile, sharedKey)) {
          api.status('The browser could not publish this Profile.');
          return;
        }
        selected = 'shared:' + profile.id;
        filter.value = 'shared';
        showShelf();
        preview(profile, 'shared');
        api.status('Profile published in this browser.');
      });
      buttons.append(publish);
    }
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
    const chooser = node('fieldset', null, 'ix-section ix-client-options');
    chooser.append(node('legend', 'CLI targets'));
    for (const client of api.data.clients) chooser.append(checkbox(client.name, draft.clients.includes(client.id), checked => {
      draft.clients = checked ? [...draft.clients, client.id] : draft.clients.filter(id => id !== client.id);
    }));
    inspector.replaceChildren(node('h3', profile ? 'Edit Profile' : 'Create a Profile'),
      field('Profile name', name),
      field('Description', input(draft.description, value => { draft.description = value; }, true)),
      field('First task', input(draft.firstTask, value => { draft.firstTask = value; })),
      field('Supporting instructions', input(draft.instructions, value => { draft.instructions = value; }, true)),
      chooser,
      hint(draft.items.length + ' Catalog items from the saved selection'),
      action('Save Profile', () => {
        draft.name = draft.name.trim();
        if (!draft.name) { name.focus(); api.status('Enter a Profile name.'); return; }
        if (!put(draft, personalKey)) { api.status('The browser could not save this Profile.'); return; }
        selected = 'saved:' + draft.id;
        filter.value = 'saved';
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
      if (library(personalKey).some(entry => entry.id === profile.id)) profile.id = crypto.randomUUID();
      if (!put(profile, personalKey)) throw new Error('The browser could not save this Profile.');
      selected = 'saved:' + profile.id;
      filter.value = 'saved';
      showShelf();
      preview(profile);
    }, api.status));
  filter.addEventListener('change', () => {
    selected = null;
    inspector.replaceChildren();
    showShelf();
  });
  host.append(section(null, controls, field('Profile source', filter), privateNote, shelf), inspector);
  showShelf();
  fetch('/api/approved-profiles', { signal: api.signal }).then(async response => {
    if (!response.ok) throw new Error('Profile host unavailable.');
    const result = await response.json();
    const unique = new Map();
    for (const value of result.profiles ?? []) {
      try {
        const profile = readProfile(value);
        if (!unique.has(profile.id)) unique.set(profile.id, profile);
      } catch { /* An invalid entry cannot populate the library. */ }
    }
    hostLibrary = [...unique.values()];
    hostStatus = result.status === 'unconfigured' ? 'No host Profile library is configured.' :
      result.status === 'ready' ? 'The host Profile library is empty.' : 'The host Profile library is unavailable or incomplete.';
    showShelf();
  }).catch(() => {
    if (api.signal.aborted) return;
    hostStatus = 'The host Profile library is unavailable.';
    showShelf();
  });
}

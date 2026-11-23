import { action, checkbox, facts, field, fileField, hint, input, link, node, section, readStored, store } from './dom.js';
import { make as icon } from './icons.js';
import { format, readProfile, readTeamProfile, resolveProfileChoices } from './profile-model.js';
import { loadPublicProfile, profileLimit, profileText, renderProfileSharing, teamProfileRequest } from './profile-sharing.js';

export { readProfile, readTeamProfile } from './profile-model.js';

const libraryKey = 'aih-workbench-profiles-v1';
const sharedKey = 'aih-workbench-shared-profiles-v1';
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
  const sources = new Map([['saved', 'Saved in this browser'], ['shared', 'Shared in this browser'],
    ['host', 'Host library'], ['team', 'Team Profiles on GitHub'], ['public', 'Public link']]);
  if (api.role === 'individual') sources.delete('team');
  const filter = node('select');
  filter.append(new Option('All sources', ''));
  for (const [id, label] of sources) filter.append(new Option(label, id));
  let hostLibrary = [];
  let hostStatus = 'Loading the host library…';
  let teamLibrary = [];
  let teamStatus = 'Loading team Profiles…';
  let publicProfile;
  let selected = null;
  const teamReceipt = node('div', null, 'ix-stack');

  function showShelf() {
    const collections = [
      ['saved', library(personalKey).map(profile => ({ profile }))],
      ['shared', library(sharedKey).map(profile => ({ profile }))],
      ['host', hostLibrary.map(profile => ({ profile }))],
      ['team', teamLibrary],
      ['public', publicProfile ? [publicProfile] : []],
    ];
    const profiles = collections.filter(([kind]) => sources.has(kind) && (!filter.value || filter.value === kind))
      .flatMap(([kind, entries]) => entries.map(entry => ({ kind, ...entry })));
    shelf.replaceChildren();
    for (const { kind, profile, source } of profiles) {
      const key = kind + ':' + profile.id;
      const button = action(profile.name, () => {
        selected = key;
        showShelf();
        preview(profile, kind, source);
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
    if (!profiles.length) {
      const empty = { host: hostStatus, team: teamStatus, public: 'Open a public Profile link to preview it here.' };
      shelf.append(node('li', empty[filter.value] ?? 'No Profiles in this view.', 'ix-hint'));
    }
  }

  function preview(profile, kind = 'saved', source) {
    const enterprise = api.role === 'enterprise';
    const choices = resolveProfileChoices(profile, api.fullData ?? api.data, enterprise ? api.data : undefined);
    const availability = ({ value, id }, label) => (value?.[label] ?? id) +
      (enterprise ? value ? ' · eligible under current policy' : ' · unavailable under current policy' : value ? '' : ' · unavailable');
    const list = node('ul');
    for (const choice of choices.items) list.append(node('li', availability(choice, 'title')));
    const heading = node('h3', profile.name);
    heading.tabIndex = -1;
    inspector.replaceChildren(heading, ...(profile.description ? [hint(profile.description)] : []), facts([
      ['Source', sources.get(kind)],
      ['Repository', source?.repository],
      ['Author', kind === 'team' ? source?.author || 'Unavailable' : null],
      ['Revision', source?.revision ?? source?.commitSha],
      ['File', source?.path],
      ['CLI targets', choices.clients.map(choice => availability(choice, 'name')).join(', ') || 'None'],
      ['Catalog items', String(profile.items.length)],
      ['Own sources', profile.byo?.map(source => source.name || source.source).filter(Boolean).join(', ') || null],
    ]), ...(list.childElementCount ? [list] : []),
    ...(profile.firstTask ? [profileText('First task', profile.firstTask)] : []),
    ...(profile.instructions ? [profileText('Supporting instructions', profile.instructions)] : []),
    ...(profile.files ?? []).map(file => profileText(file.name, file.text)));
    const buttons = node('div', null, 'ix-buttons');
    const share = destination => renderProfileSharing(inspector, {
      profile, choices, destination, signal: api.signal,
      back: () => preview(profile, kind, source),
      publish: payload => {
        if (!put(payload, sharedKey)) return api.status('The browser could not share this Profile.');
        selected = 'shared:' + profile.id;
        filter.value = 'shared';
        showShelf();
        preview(readProfile(payload), 'shared');
        api.status('Profile shared in this browser.');
      },
      onTeamProposal: showProposal,
    });
    buttons.append(action(kind === 'saved' ? 'Edit Profile' : 'Copy to edit', () =>
      edit(kind === 'saved' ? profile : { ...profile, id: crypto.randomUUID() })),
    action('Export Profile', () => share('export')), action('Prepare public Profile', () => share('public')));
    if (kind === 'saved') buttons.append(action('Share in this browser', () => share('local')));
    if (api.role !== 'individual' && (kind === 'saved' || kind === 'team')) {
      buttons.append(action('Propose team Profile', () => share('team')));
    }
    const use = action('Use this Profile', () => {
      const current = resolveProfileChoices(profile, api.fullData ?? api.data, enterprise ? api.currentData() : undefined);
      if (enterprise && (!api.published || !current.eligible)) {
        return api.status('This Profile contains choices outside the current organization policy.');
      }
      api.change('items', [...new Set([...api.draft.items, ...current.items.map(({ id, value }) => value?.id ?? id)])]);
      api.change('clients', [...new Set([...api.draft.clients, ...profile.clients])]);
      if (profile.firstTask) api.change('firstTask', profile.firstTask);
      if (profile.instructions) api.change('instructions', [api.draft.instructions, profile.instructions].filter(Boolean).join('\n\n'));
      if (profile.byo?.length) api.change('source', [api.draft.source, ...profile.byo.map(entry => entry.source)].filter(Boolean).join('\n'));
      const names = new Set(api.draft.files.map(file => file.name));
      const additions = (profile.files ?? []).filter(file => !names.has(file.name));
      if (additions.length) api.change('files', [...api.draft.files, ...additions]);
      api.returnFromProfiles('Profile added to your setup.');
    }, true);
    if (api.role !== 'admin') {
      use.disabled = enterprise && (!api.published || !choices.eligible);
      buttons.prepend(use);
      if (use.disabled) inspector.append(hint('Choose a Profile whose Catalog items and CLI targets are available under your current organization policy.'));
      if (profile.files?.some(file => api.draft.files.some(existing => existing.name === file.name))) {
        inspector.append(hint('Your setup keeps its existing copy of files with the same name.'));
      }
    }
    inspector.append(buttons);
    heading.focus();
  }

  function edit(profile) {
    const draft = profile ? { ...profile } : {
      format, id: crypto.randomUUID(), name: '', description: '',
      items: [...api.draft.items], clients: [...api.draft.clients],
      firstTask: api.draft.firstTask, instructions: api.draft.instructions,
      files: api.draft.files.map(file => ({ ...file })),
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
      ...(draft.files ?? []).map(file => profileText(file.name, file.text)),
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
      if (file.size > profileLimit) throw new Error('Choose a Profile smaller than 1 MB.');
      const profile = readProfile(JSON.parse(await file.text()));
      if (library(personalKey).some(entry => entry.id === profile.id)) profile.id = crypto.randomUUID();
      if (!put(profile, personalKey)) throw new Error('The browser could not save this Profile.');
      selected = 'saved:' + profile.id;
      filter.value = 'saved';
      showShelf();
      preview(profile);
    }, api.status));
  const publicImport = node('details');
  const publicAddress = node('input');
  publicAddress.type = 'url';
  const publicStatus = hint('');
  publicStatus.setAttribute('role', 'status');
  const openPublic = action('Open public link', async () => {
    openPublic.disabled = true;
    publicStatus.textContent = 'Opening the public Profile…';
    try {
      publicProfile = await loadPublicProfile(publicAddress.value.trim(), api.signal);
      publicStatus.textContent = '';
      selected = 'public:' + publicProfile.profile.id;
      filter.value = 'public';
      showShelf();
      preview(publicProfile.profile, 'public', publicProfile.source);
    } catch (error) {
      if (!api.signal.aborted) publicStatus.textContent = error.message;
    } finally {
      openPublic.disabled = false;
    }
  });
  publicImport.append(node('summary', 'Open a public Profile by link'),
    field('GitHub file link pinned to a commit', publicAddress), openPublic, publicStatus);
  const refreshTeam = action('Refresh team Profiles', async () => {
    refreshTeam.disabled = true;
    teamStatus = 'Loading team Profiles…';
    showShelf();
    try {
      const result = await teamProfileRequest('/profiles', api.signal);
      teamLibrary = (result.profiles ?? []).flatMap(({ profile, source }) => {
        try { return [{ profile: readTeamProfile(profile), source }]; } catch { return []; }
      });
      teamStatus = result.status === 'ready' ? 'The base branch has no team Profiles.' :
        'The team Profile library is unavailable or incomplete.';
    } catch (error) {
      if (api.signal.aborted) return;
      teamLibrary = [];
      teamStatus = error.message;
    } finally {
      refreshTeam.disabled = false;
    }
    showShelf();
  });
  if (sources.has('team')) controls.append(refreshTeam);

  function showProposal(receipt) {
    const note = hint('Team Profile pull request is ' + receipt.status + '.');
    note.setAttribute('role', 'status');
    const check = action('Check pull request status', async () => {
      check.disabled = true;
      try {
        const result = await teamProfileRequest('/status', api.signal, { receipt });
        showProposal(result.receipt);
        if (result.receipt.status === 'merged' && !refreshTeam.disabled) refreshTeam.click();
      } catch (error) {
        if (!api.signal.aborted) note.textContent = error.message;
      } finally {
        check.disabled = false;
      }
    });
    teamReceipt.replaceChildren(note, link('Open GitHub pull request #' + receipt.number, receipt.url), check);
  }

  filter.addEventListener('change', () => {
    selected = null;
    inspector.replaceChildren();
    showShelf();
  });
  host.append(section(null, controls, publicImport, field('Profile source', filter), teamReceipt, shelf), inspector);
  showShelf();
  if (sources.has('team')) refreshTeam.click();
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

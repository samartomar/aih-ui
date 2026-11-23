import { action, downloadJson, facts, field, fileField, hint, node, readStored, section, store } from './dom.js';

const format = 'aih-workbench-version-reference/1';
const savedKey = 'aih-workbench-version-reference';
const names = ['core', 'catalog', 'scan'];

export function installedVersions(data) {
  return Object.fromEntries(names.flatMap(name => {
    const value = data.packages?.[name];
    const version = typeof value === 'string' ? value : value?.version;
    return version ? [[name, version]] : [];
  }));
}

export function versionUnavailable(versions, data) {
  if (!Object.keys(versions).length) return false;
  const installed = installedVersions(data);
  return names.some(name => (versions[name] ?? null) !== (installed[name] ?? null));
}

function readReference(value) {
  const versions = value?.versions;
  if (value?.format !== format || !versions || Array.isArray(versions) || typeof versions !== 'object' ||
    !Object.keys(versions).length || Object.entries(versions).some(([name, version]) =>
      !names.includes(name) || typeof version !== 'string' || !version.trim() || version.length > 120)) {
    throw new Error('Choose a Workbench version reference with supported package names.');
  }
  return { format, versions: Object.fromEntries(names.filter(name => Object.hasOwn(versions, name)).map(name => [name, versions[name]])) };
}

function savedReference() {
  try { return readReference(readStored(savedKey, null)); } catch { return null; }
}

export function renderVersionSets(host, api) {
  const installed = installedVersions(api.data);
  const saved = savedReference();
  const pins = api.draft.versions;
  const historical = versionUnavailable(pins, api.data);
  const sets = node('select');
  sets.append(new Option('Installed version set', 'installed'));
  if (saved) sets.append(new Option('Saved reference', 'saved'));
  const usingSaved = saved && JSON.stringify(saved.versions) === JSON.stringify(pins);
  if (historical && !usingSaved) sets.append(new Option('Version set in this draft', 'draft'));
  sets.value = historical ? usingSaved ? 'saved' : 'draft' : usingSaved && api.draft.versionSet === 'saved' ? 'saved' : 'installed';
  sets.addEventListener('change', () => {
    if (sets.value === 'saved') api.change('versions', saved.versions);
    else if (sets.value === 'installed') api.change('versions', installed);
    api.change('versionSet', sets.value);
    api.refresh();
  });

  function saveReference(value) {
    if (!store(savedKey, value)) throw new Error('The browser could not save this reference.');
  }

  const pin = action('Pin installed versions', () => {
    api.change('versions', installed);
    api.change('versionSet', 'installed');
    api.refresh();
    api.status('Installed versions pinned in this draft.');
  }, true);
  pin.disabled = !Object.keys(installed).length;
  const save = action('Save installed versions as a reference', () => {
    try {
      saveReference({ format, versions: installed });
      api.refresh();
      api.status('Version reference saved in this browser.');
    } catch (error) { api.status(error.message); }
  });
  save.disabled = !Object.keys(installed).length;
  const controls = node('div', null, 'ix-buttons');
  controls.append(pin, save);
  if (saved) controls.append(action('Export saved reference', () => downloadJson('workbench-version-reference.json', saved)));
  host.append(section('Version set', field('Choose version set', sets),
    fileField('Open a saved version reference', '.json,application/json', async file => {
      if (file.size > 16384) throw new Error('Choose a version reference smaller than 16 KiB.');
      const reference = readReference(JSON.parse(await file.text()));
      if (api.signal.aborted) return;
      saveReference(reference);
      api.change('versions', reference.versions);
      api.change('versionSet', 'saved');
      api.refresh();
      api.status('Saved reference opened.');
    }, api.status), controls));
  if (historical) {
    host.append(section('Saved reference · unavailable', facts(Object.entries(pins)),
      hint('This version set is not installed. Catalog, Scan and policy review are unavailable for this reference.')));
    return;
  }
  host.append(section('Installed package versions', Object.keys(installed).length ? facts(Object.entries(installed)) : hint('No installed package versions were supplied.')),
    section('Draft version pins', Object.keys(pins).length ? facts(Object.entries(pins)) : hint('No versions pinned.')),
    section('Catalog sources', api.data.frameworks.length ? facts(api.data.frameworks.map(f => [f.name, f.sha256 ?? f.state])) :
      hint(api.data.gaps.catalog ?? 'No sources are configured.')));
}

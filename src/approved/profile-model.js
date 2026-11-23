import { checkedFiles } from './source-files.js';

export const format = 'aih-workbench-profile/1';
const priorFormat = 'aih-portable-profile/1';
const optionalText = value => typeof value === 'string' ? value : '';

export function readProfile(value) {
  if (value?.format === priorFormat) {
    const { id, name, description, catalogIds, firstTask, instructions, byo, files } = value;
    value = { format, id: optionalText(id) || crypto.randomUUID(), name, description: optionalText(description),
      items: catalogIds, clients: [], firstTask, instructions, byo, files };
  }
  if (value?.format !== format || typeof value.id !== 'string' ||
    typeof value.name !== 'string' || !value.name.trim() ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.items) || value.items.some(id => typeof id !== 'string') ||
    !Array.isArray(value.clients) || value.clients.some(id => typeof id !== 'string')) {
    throw new Error('Open a Profile exported by this Workbench.');
  }
  const { id, name, description, items, clients, firstTask, instructions, byo, files } = value;
  return { format, id, name, description, items: [...new Set(items)], clients: [...new Set(clients)],
    firstTask: optionalText(firstTask), instructions: optionalText(instructions),
    files: checkedFiles(files),
    byo: Array.isArray(byo) ? byo.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      return [{ name: optionalText(entry.name), kind: optionalText(entry.kind), source: optionalText(entry.source), revision: optionalText(entry.revision) }];
    }) : [] };
}

const teamFields = new Set(['format', 'id', 'name', 'description', 'items', 'clients', 'firstTask', 'instructions', 'files']);
const fileFields = new Set(['name', 'text', 'allowUpdates']);

export function readTeamProfile(value) {
  if (!value || value.format !== format || Object.keys(value).some(key => !teamFields.has(key)) ||
    typeof value.id !== 'string' || !value.id.trim() ||
    ['firstTask', 'instructions'].some(key => Object.hasOwn(value, key) && typeof value[key] !== 'string')) {
    throw new Error('This file is not a portable Profile.');
  }
  const { byo, files, ...profile } = readProfile(value);
  if (files.some(file => file.allowUpdates || /[/\\\x00-\x1f]/.test(file.name) || file.name === '.' || file.name === '..') ||
    new Set(files.map(file => file.name)).size !== files.length ||
    value.files?.some(file => Object.keys(file).some(key => !fileFields.has(key)))) {
    throw new Error('Use unique file names without paths in a portable Profile.');
  }
  if (!Object.hasOwn(value, 'firstTask')) delete profile.firstTask;
  if (!Object.hasOwn(value, 'instructions')) delete profile.instructions;
  if (Object.hasOwn(value, 'files')) profile.files = files;
  return profile;
}

export function resolveProfileChoices(profile, data, allowed = data) {
  const allowedItems = new Set(allowed.items.map(item => item.id));
  const allowedClients = new Set(allowed.clients.map(client => client.id));
  const items = profile.items.map(id => {
    const exact = data.items.find(item => item.id === id);
    const matching = exact ? [] : data.items.filter(item => item.itemId === id);
    const item = exact ?? (matching.length === 1 ? matching[0] : undefined);
    const eligible = item && allowedItems.has(item.id) && (!allowed.itemClients ||
      profile.clients.every(client => allowed.itemClients[item.id]?.includes(client)));
    return { id, value: eligible ? item : undefined };
  });
  const clients = profile.clients.map(id => ({
    id, value: allowedClients.has(id) ? data.clients.find(client => client.id === id) : undefined,
  }));
  return { items, clients, eligible: [...items, ...clients].every(choice => choice.value) };
}

export function portableProfile(profile, choices, inclusion = {}) {
  const payload = {
    format, id: profile.id, name: profile.name, description: profile.description,
    items: [...new Set(choices.items.flatMap(({ value }) => value ? [value.id] : []))],
    clients: choices.clients.flatMap(({ value }) => value ? [value.id] : []),
  };
  if (inclusion.firstTask) payload.firstTask = profile.firstTask;
  if (inclusion.instructions) payload.instructions = profile.instructions;
  const files = (profile.files ?? []).filter((_, index) => inclusion.files?.has(index));
  if (files.length) payload.files = files.map(({ name, text }) => ({ name, text, allowUpdates: false }));
  return readTeamProfile(payload);
}

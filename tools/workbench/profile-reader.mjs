import { readFile } from 'node:fs/promises';

const example = async name => JSON.parse(await readFile(new URL('./profiles/' + name, import.meta.url), 'utf8'));
export async function profileLibrary() {
  const index = await example('index.json');
  return {
    profiles: await Promise.all(index.profiles.map(example)),
    example: await example(index.contributorExample),
  };
}

function reject(message) {
  throw Object.assign(new Error(message), { status: 400, code: 'PROFILE_INVALID' });
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function prose(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readProfile(profile, reader) {
  if (!plain(profile) || !['workbench-profile/1', 'workbench-profile/2'].includes(profile.format)) reject('Choose a supported Workbench profile.');
  if (Buffer.byteLength(JSON.stringify(profile)) > 65536) reject('Profile exceeds 64 KiB.');
  if (![profile.title, profile.role, profile.outcome, profile.firstTask].every(prose)) reject('Include a title, role, outcome and first task.');
  const files = profile.files;
  if (!Array.isArray(files) || files.some(file => !plain(file) || !prose(file.path) ||
    !file.path.split('/').every(segment => /^[\w-][\w. -]*$/.test(segment)) ||
    !file.path.endsWith('.md') || !prose(file.text))) reject('Companion files must have relative Markdown paths and text.');
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) reject('Each companion file needs a distinct path.');
  if (profile.format === 'workbench-profile/2') {
    if (typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(profile.id)) reject('Include a valid profile ID.');
    if (typeof profile.author !== 'string') reject('Include the profile author field.');
    if (!plain(profile.data) || !prose(profile.data.repository) || !prose(profile.data.commit)) reject('Include the Catalog revision used for this selection.');
    if (!Array.isArray(profile.items) || !profile.items.length || !profile.items.every(prose) || new Set(profile.items).size !== profile.items.length) reject('Select one or more distinct Catalog items.');
    return { selection: profile.items };
  }
  let url;
  try { url = new URL(profile.source?.repository); } catch { reject('Include the recipe source repository and commit.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{40}$/.test(profile.source?.commit)) reject('Use an HTTPS source and a complete Git commit.');
  const choices = profile.choices ?? {};
  if (!plain(choices) || Object.values(choices).some(list => !Array.isArray(list) || !list.every(prose))) reject('Recipe choices must contain lists of item IDs.');
  if (!plain(profile.plugin) || !plain(profile.recipe)) reject('Include both plugin metadata and a Catalog recipe.');
  const read = reader.readRecipe(Buffer.from(JSON.stringify(profile.plugin)), Buffer.from(JSON.stringify(profile.recipe)));
  if (read.status !== 'ok') reject('Catalog could not read this recipe: ' + JSON.stringify(read.problems ?? read.reason ?? read.status));
  return { read, choices };
}

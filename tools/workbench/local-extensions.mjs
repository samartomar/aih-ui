import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPublic } from './local-packages.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Public producer inventory identity of the 149-file upstream 2481164a tree. The runtime
// must reproduce it; a cache cannot relabel changed bytes as that Git pin.
const PLUGIN_SCAN_KEY = 'git-sha1:0ba6ac361747ff360be2c4141ad0e3f9f3cd19c1';
const bytesOf = value => value instanceof Uint8Array ? value : value?.data ? Buffer.from(value.data, typeof value.data === 'string' ? 'base64' : undefined) :
  value && Object.keys(value).every((key, index) => key === String(index)) ? Buffer.from(Object.values(value)) : (() => { throw Error('Extensions source cache has no file bytes.'); })();

// This is a Workbench-authored input derivation through public producer/reader APIs,
// not a replacement for the published Catalog content document.
export async function createExtensionsInstaller({ consumer, root, recipeCommit, sourceCache }) {
  const { api: reader, version } = await loadPublic(consumer, '@aihq/catalog', './reader');
  const { api: producer } = await loadPublic(consumer, '@aihq/catalog', './producer');
  const { api: node } = await loadPublic(consumer, '@aihq/catalog', './node');
  const pluginJson = await readFile(new URL('./local-extensions-plugin.json', import.meta.url), 'utf8');
  const recipeJson = await readFile(new URL('./local-extensions-recipe.json', import.meta.url), 'utf8');
  const parsedRecipe = reader.readRecipe(Buffer.from(pluginJson), Buffer.from(recipeJson));
  if (parsedRecipe.status !== 'ok') throw Error('The local Extensions recipe did not validate.');
  const authored = parsedRecipe.recipe, pin = authored.content;
  const snapshot = JSON.parse(await readFile(join(consumer, 'public', 'catalog.json'), 'utf8'));
  const document = snapshot.documents.find(text => JSON.parse(text).framework.id === 'extensions');
  const recorded = snapshot.data.files.find(file => file.path === 'data/extensions/content.json');
  if (!document || digest(Buffer.from(document)) !== recorded?.sha256 || snapshot.data.repository !== authored.data.repository || snapshot.data.commit !== authored.data.commit)
    throw Error('Extensions content does not match its pinned Catalog document.');
  const original = reader.readContent(Buffer.from(document));
  if (original.status !== 'ok') throw Error('The pinned Extensions document did not validate.');
  const source = original.content.sources.find(source => source.id === 'extensions');
  if (source?.repository !== pin.repository || source?.commit !== pin.commit) throw Error('Extensions recipe and Catalog source differ.');
  const cachePath = join(root, 'extensions-source-cache.json');
  let acquisition = null, derivation = null;
  const restore = value => {
    if (value.status !== 'ok' || value.source.repository !== pin.repository || value.source.commit !== pin.commit) throw Error('Extensions source cache has a different pin.');
    return { ...value, files: value.files.map(file => ({ ...file, bytes: bytesOf(file.bytes) })) };
  };
  try { acquisition = restore(JSON.parse(await readFile(sourceCache || cachePath, 'utf8'))); }
  catch (error) { if (sourceCache || error.code !== 'ENOENT') throw error; }
  return {
    files: () => acquisition?.files || [],
    derivation: () => derivation,
    async request({ mode, target, profile }) {
      if (!/^[a-f0-9]{40}$/.test(recipeCommit || '')) return { result: { status: 'refused', reason: 'The Extensions walkthrough needs the exact UI commit containing its authored recipe.' } };
      if (!acquisition) {
        const outDir = join(root, 'acquisition', 'extensions');await mkdir(outDir, { recursive: true });
        const fetched = await node.fetchSource({ kind: 'git', repository: pin.repository, ref: pin.commit }, { outDir, timeoutMs: 60000 });
        if (fetched.status !== 'ok') return { result: { status: fetched.status, stage: 'extensions-source', reason: fetched.reason || fetched.code || 'Pinned Extensions source could not be acquired.' } };
        acquisition = restore(fetched);
        await writeFile(cachePath + '.tmp', JSON.stringify(fetched, (key, value) => value instanceof Uint8Array ? { data: Buffer.from(value).toString('base64') } : value));await rename(cachePath + '.tmp', cachePath);
      }
      const built = await producer.buildContent(acquisition.source, acquisition.files, [], {
        framework: original.content.framework, sourceId: 'extensions', plugins: ['/'],
      });
      if (built.status !== 'ok') return { result: { ...built, stage: 'extensions-plugin-inventory' } };
      if (built.content.plugins?.[0]?.scanKey !== PLUGIN_SCAN_KEY) return { result: { status: 'refused', reason: 'Extensions plugin bytes differ from the checked source pin.', stage: 'extensions-plugin-inventory' } };
      const merged = reader.readContent(Buffer.from(JSON.stringify({ ...original.content, plugins: built.content.plugins })));
      if (merged.status !== 'ok') return { result: { ...merged, stage: 'extensions-derived-content' } };
      const content = merged.content;
      derivation = { kind: 'workbench-derived-plugin-inventory', catalogDocument: { ...authored.data, sha256: recorded.sha256 },
        source: pin, producer: { package: '@aihq/catalog', version }, pluginScanKey: built.content.plugins[0].scanKey,
        pluginFiles: built.content.plugins[0].files.length, contentSha256: digest(Buffer.from(JSON.stringify(content))),
        recipe: { id: authored.id, sha256: parsedRecipe.sha256, repository: 'https://github.com/samartomar/aih-ui', commit: recipeCommit } };
      const choices = { hooks: authored.options.find(option => option.id === 'hooks').items.map(item => item.item) }, recipeSource = { repository: 'https://github.com/samartomar/aih-ui', commit: recipeCommit };
      const plan = reader.planRecipe(authored, [content], [profile], choices, { scope: 'project', source: recipeSource, data: authored.data });
      if (plan.status !== 'ok') return { result: { ...plan, stage: 'extensions-plan' } };
      const sourceFiles = new Map(acquisition.files.map(file => [file.path, file])), references = new Map();
      for (const step of plan.plan) if (step.from) references.set(step.from.sourceId + '\0' + step.from.sourcePath, step.from);
      const files = [];
      for (const reference of references.values()) {
        const file = sourceFiles.get(reference.sourcePath);
        if (reference.sourceId !== 'extensions' || !file?.bytes || file.sha256 !== reference.sha256) return { result: { status: 'refused', reason: 'A reviewed Extensions plugin file does not match the pinned source.', stage: 'extensions-source' } };
        files.push({ ...reference, bytes: file.bytes });
      }
      return { request: { schema: 'urn:aihq:core:plan-request:0.1.0', mode, scope: 'project', target, plan,
        contents: [content], profiles: [profile], files, recipeProof: { pluginJson, recipeJson, choices, options: { data: authored.data } } } };
    }
  };
}

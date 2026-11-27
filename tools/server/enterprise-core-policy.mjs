import { createHash } from 'node:crypto';
import { selectedClientTarget } from '../workbench/client-target.mjs';
import { loadPublic } from '../workbench/local-packages.mjs';

const schema = 'urn:aihq:core:organization:0.1.0';
const selectionFormat = 'aih-workbench-team-selection/1';
const selectionError = message => Object.assign(Error(message), {enterpriseStatus:422});
// A Tool Setup recipe's plan also configures its companion MCP item. Core has no
// recipe-scoped admission, so the companion is permitted with its recipe. Members are
// not offered it as a separate item while the same policy permits that recipe.
const companionPrefix = 'tool-setup-companion-';
// Plan with the Catalog source's own platform cell.
const hostPlatform = undefined;
const entryId = (prefix, value) => prefix + '-' + createHash('sha256').update(value).digest('hex').slice(0, 24);

export const personalFileChange = {
  schema: 'urn:aihq:core:change:0.1.0',
  id: 'workbench-personal-file',
  description: 'Place a personal supporting file in this project',
  targets: ['project'],
  inputs: {
    name: {type:'string', required:true, maxLength:80},
    text: {type:'string', required:true, maxLength:32768},
  },
  materials: [], prerequisites: [], checks: [],
  operations: [{
    id:'write', purpose:'Place the reviewed personal file', kind:'file.write', scope:'project',
    target:{root:'project', segments:[{literal:'workbench-personal'}, {input:'name'}]},
    content:{input:'text'}, requires:[], checks:[],
  }],
};

export const organizationFileChange = name => ({
  ...personalFileChange,
  id:'workbench-organization-file',
  description:'Place a reviewed organization supporting file in this project',
  operations:[{...personalFileChange.operations[0], purpose:'Place the reviewed organization file',
    target:{root:'project', segments:[{literal:'workbench-organization'}, {literal:name}]}}],
});

const uniqueStrings = values => Array.isArray(values) && values.length <= 256 &&
  values.every(value => typeof value === 'string') && new Set(values).size === values.length;
const checkedText = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');

export function validPersonalFile(file) {
  return file && typeof file.name === 'string' && /^[a-z0-9][a-z0-9_-]{0,60}\.(md|txt|json|yaml|yml)$/i.test(file.name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(file.name) && checkedText(file.text, 32768);
}

// `core` can supply the public Core contracts and harness modules; the default loads them from the consumer.
export function createEnterprisePolicy({ consumer, published, summary, catalog, core }) {
  const items = new Map(published.items.map(item => [item.id, item]));
  const versions = Object.fromEntries((summary?.packages ?? []).filter(pkg => ['core','catalog','scan'].includes(pkg.name))
    .map(pkg => [pkg.name, pkg.version]));
  let loaded;
  const modules = core ?? (() => Promise.all([
    loadPublic(consumer, '@aihq/core', './contracts'),
    loadPublic(consumer, '@aihq/core', './harness'),
  ]).then(([{api:contracts}, {api:harness}]) => ({contracts, harness})));
  const load = () => loaded ??= modules().then(async ({contracts, harness}) => {
    const change = await contracts.deriveChangeIdentity({ change: personalFileChange });
    if (change.status !== 'ok') throw Error('Core could not validate the personal-file change.');
    return { contracts, harness, personalIdentity:change.changeIdentity };
  });

  function validate(contracts, document) {
    if (document?.schema !== schema) throw Error('This branch must contain a Core organization 0.1.0 document.');
    const result = contracts.validateOrganizationPolicy(document);
    if (result.status !== 'ok') throw Error('Core refused the organization document. ' + (result.problems?.[0]?.message ?? result.status));
    return result.value;
  }

  async function buildPolicy(selection) {
    const { contracts, harness, personalIdentity } = await load();
    if (selection?.format !== selectionFormat || !checkedText(selection.organization, 100) || !selection.organization.trim() ||
      (selection.owner !== undefined && !checkedText(selection.owner, 160)) || !checkedText(selection.source, 500) ||
      !uniqueStrings(selection.clients) || !selection.clients.length || !uniqueStrings(selection.items) ||
      !Array.isArray(selection.files) ||
      !selection.versions || Object.keys(versions).length !== 3 ||
      Object.keys(selection.versions).length !== 3 || Object.entries(versions).some(([name, version]) => selection.versions[name] !== version) ||
      (selection.allowPersonal !== undefined && typeof selection.allowPersonal !== 'boolean')) {
      throw selectionError('Choose an organization, CLI targets and the currently installed product version pins.');
    }
    if (selection.files.length > 16 || selection.files.some(file => !validPersonalFile(file) || typeof file.allowUpdates !== 'boolean') ||
      new Set(selection.files.map(file => file.name.toLowerCase())).size !== selection.files.length) {
      throw selectionError('Choose up to sixteen uniquely named supporting text files. Each file can contain up to 32,768 characters.');
    }
    if (selection.source.trim()) throw selectionError('Add the organization source as supporting text files. A source reference alone cannot be published as native content.');
    if (!selection.items.length && !selection.files.length && !selection.allowPersonal) {
      throw selectionError('Choose Catalog items, add organization supporting files, or allow personal files.');
    }
    const source = await catalog();
    if (!source) throw selectionError('The prepared Catalog data is unavailable.');
    const inventory = source.catalog;
    const clientIds = [...new Set(inventory.clients.map(({id}) => selectedClientTarget(harness, id)).filter(tool => tool?.surface === 'cli').map(tool => tool.id))];
    const cli = selection.clients.map(id => selectedClientTarget(harness, id));
    if (cli.some(tool => tool?.surface !== 'cli' || !clientIds.includes(tool.id)) || new Set(cli.map(tool => tool.id)).size !== cli.length) {
      throw selectionError('Choose CLI targets supported by the pinned Catalog and Core registry.');
    }
    const selectedClients = cli.map(tool => tool.id);
    const chosen = selection.items.map(id => items.get(id));
    const exact = new Map(inventory.items.map(item => {
      const framework = inventory.frameworks.find(entry => entry.id === item.framework);
      return [framework?.sha256 + '/' + item.id, item];
    }));
    if (chosen.some(item => !item || !exact.has(item.id))) throw selectionError('A selected item is unavailable from the exact pinned Catalog.');
    const itemKey = item => JSON.stringify([item.framework, item.id]);
    const selectedIds = new Set(chosen.map(item => itemKey(exact.get(item.id))));
    const companions = chosen.map(item => exact.get(item.id)).filter(recipe => recipe.kind === 'ai-setup' && recipe.setup?.mcpItem)
      .flatMap(recipe => {
        const mcp = inventory.items.find(item => item.framework === recipe.framework && item.id === recipe.setup.mcpItem);
        return mcp && !selectedIds.has(itemKey(mcp)) ? [{item:mcp.id, framework:mcp.framework, title:mcp.title ?? mcp.id,
          recipe:recipe.id, recipeTitle:recipe.title ?? recipe.id}] : [];
      });
    const companionIds = new Set(companions.map(companion => itemKey({framework:companion.framework, id:companion.item})));
    const excludedClients = harness.listTools().tools.map(tool => tool.id).filter(id => !selectedClients.includes(id));
    const allowedFrameworks = new Set(chosen.map(item => exact.get(item.id).framework));
    const entries = inventory.items.filter(item => allowedFrameworks.has(item.framework)).flatMap(item => {
      const content = { item: item.id, framework: item.framework };
      const key = itemKey(item);
      const companion = companionIds.has(key);
      if (!selectedIds.has(key) && !companion) return [{id:entryId('exclude', key), obligation:'prohibited', content}];
      return [{id:companion ? companionPrefix + entryId('entry', key) : entryId('selected', key), obligation:'permitted', scopes:['project'], clients:selectedClients, content},
        ...(excludedClients.length ? [{id:entryId('other-clis', key), obligation:'prohibited', scopes:['project'], clients:excludedClients, content}] : []),
        {id:entryId('other-scope', key), obligation:'prohibited', scopes:['user'], content}];
    });
    if (selection.allowPersonal) entries.push({
      id:'workbench-personal-file', obligation:'permitted', change:{ identity:personalIdentity }, scopes:['project'],
      clients:selectedClients, inputs:{ name:{allowDeclared:true}, text:{allowDeclared:true} },
    });
    for (const file of selection.files) {
      const change = await contracts.deriveChangeIdentity({change:organizationFileChange(file.name)});
      if (change.status !== 'ok') throw Error('Core could not validate the organization-file change.');
      entries.push({
        id:entryId('organization-file', file.name.toLowerCase()), obligation:'permitted', change:{identity:change.changeIdentity},
        scopes:['project'], clients:selectedClients, inputs:{name:{fixed:file.name}, text:{fixed:file.text}},
        lifecycle:{replace:file.allowUpdates},
      });
    }
    const id = selection.organization.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0,64).replace(/^-|-$/g, '');
    if (!id) throw selectionError('Enter an organization name that includes an ASCII letter or digit.');
    const content = { schema, id, entries,
      sources:{ frameworks:[...allowedFrameworks], published:[{repository:inventory.data.repository,commit:inventory.data.commit}], own:{kinds:[]} } };
    validate(contracts, content);
    return {content, companions, selection: {format:selectionFormat, organization:selection.organization.trim(),
      source:selection.source.trim(), clients:selection.clients, items:selection.items, versions, files:selection.files,
      allowPersonal:selection.allowPersonal === true}};
  }

  async function openPolicy(content) {
    const { contracts, harness, personalIdentity } = await load();
    const document = validate(contracts, content);
    const source = await catalog();
    const data = source?.catalog.data;
    const catalogPin = document.sources?.published?.find(pin =>
      pin.repository === data?.repository && pin.commit === data?.commit);
    if (!catalogPin) throw Error('The managed policy does not pin this prepared Catalog revision.');

    const permits = document.entries.filter(entry => ['permitted','required','recommended'].includes(entry.obligation) &&
      (!entry.scopes || entry.scopes.includes('project')) && !entry.repositories);
    const tools = source.catalog.clients.map(({id}) => ({id, target:selectedClientTarget(harness, id)}))
      .filter(({target}) => target?.surface === 'cli');
    const canUse = (entry, target) => !entry.clients || entry.clients.includes(target.id);
    const accepted = async request => {
      const result = await contracts.previewAdmission({organization:document, request});
      return result.status === 'ok' && result.value.admitted;
    };
    const requestFor = (name, target) => ({
      schema:'urn:aihq:core:' + name + '-request:0.1.0',mode:'enterprise',scope:'project',target:{project:null,client:target},
    });
    const acceptsFile = (change, inputs, target) => accepted({
      ...requestFor('change', target),changes:[{managementId:change.id,change,inputs,requires:[]}],
    });
    // Hide a companion entry only while this document also permits a recipe that configures it.
    const contentKey = (framework, item) => JSON.stringify([framework, item]);
    const configured = new Set(permits.filter(entry => !entry.id.startsWith(companionPrefix) && entry.content?.item).flatMap(entry => {
      const recipe = source.catalog.items.find(item => item.id === entry.content.item && item.framework === entry.content.framework);
      return recipe?.kind === 'ai-setup' && recipe.setup?.mcpItem ? [contentKey(recipe.framework, recipe.setup.mcpItem)] : [];
    }));
    const companionEntry = entry => entry.id.startsWith(companionPrefix) &&
      configured.has(contentKey(entry.content?.framework, entry.content?.item));
    const itemClients = new Map();
    for (const item of published.items) {
      const framework = source.catalog.frameworks.find(framework => framework.sha256 === item.framework);
      if (!framework) continue;
      const matching = permits.filter(entry => !companionEntry(entry) && entry.content?.item === item.itemId && entry.content.framework === framework.id &&
        !entry.content.recipe && (!entry.content.kind || entry.content.kind === item.kind));
      if (!matching.length) continue;
      // A Tool Setup recipe is planned for this host's platform first, then for each other
      // platform Catalog qualifies it on, so members receive it whatever their host's platform.
      // A recipe without a qualified platform is not offered. Core admits each plan.
      const setup = item.kind === 'ai-setup' ? source.catalog.items.find(entry => entry.id === item.itemId &&
        entry.framework === framework.id)?.setup : null;
      const cells = item.kind !== 'ai-setup' ? [undefined] : [...new Set((setup?.qualifications ?? [])
        .filter(record => record.status === 'qualified' && typeof record.platform === 'string').map(record => record.platform))];
      if (cells.length && item.kind === 'ai-setup') cells.unshift(hostPlatform);
      const clients = [];
      for (const {id, target} of tools) {
        if (!matching.some(entry => canUse(entry, target))) continue;
        for (const cell of cells) {
          let requestParts;
          if (cell === hostPlatform) ({requestParts} = source.prepareSelection([item], id));
          else {
            // A qualified cell this Catalog source cannot plan is skipped.
            try { ({requestParts} = source.prepareSelection([item], id, cell)); } catch { continue; }
          }
          if (requestParts && await accepted({...requestParts,...requestFor('plan', target)})) {
            clients.push(target.id);
            break;
          }
        }
      }
      if (clients.length) itemClients.set(item.id, clients);
    }

    const personal = permits.filter(entry => entry.change?.identity === personalIdentity &&
      entry.inputs?.name?.allowDeclared === true && entry.inputs?.text?.allowDeclared === true);
    const personalClients = [];
    for (const {target} of tools) {
      if (personal.some(entry => canUse(entry, target)) &&
        await acceptsFile(personalFileChange, {name:'workbench-preview.md',text:'Personal supporting file'}, target)) {
        personalClients.push(target.id);
      }
    }

    const files = [];
    for (const entry of permits) {
      const file = {name:entry.inputs?.name?.fixed, text:entry.inputs?.text?.fixed};
      if (!entry.change || !validPersonalFile(file)) continue;
      const change = organizationFileChange(file.name);
      const identity = await contracts.deriveChangeIdentity({change});
      if (identity.status !== 'ok' || entry.change.identity !== identity.changeIdentity) continue;
      const clients = [];
      for (const {target} of tools) {
        if (canUse(entry, target) && await acceptsFile(change, file, target)) clients.push(target.id);
      }
      if (clients.length) files.push({...file, allowUpdates:entry.lifecycle?.replace === true, clients});
    }
    const clients = [...new Set([...itemClients.values()].flat().concat(personalClients, files.flatMap(file => file.clients)))];
    return { format:selectionFormat, organization:document.id, catalogPin, items:[...itemClients.keys()],
      clients, itemClients:Object.fromEntries(itemClients), personalClients, files, allowPersonal:personalClients.length > 0 };
  }

  return { buildPolicy, openPolicy };
}

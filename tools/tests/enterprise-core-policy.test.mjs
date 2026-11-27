import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnterprisePolicy } from '../server/enterprise-core-policy.mjs';

// Stub seams for the public Core contracts and harness and the prepared Catalog source.
// The host plans on windows-x64, which no recipe here is qualified for.
const release = 'f'.repeat(64);
const recipe = (id, title, mcpItem, qualifications) => ({ id, title, kind: 'ai-setup', framework: 'tools', setup: { mcpItem, qualifications } });
const inventory = [
  recipe('serena.ai-setup.serena', 'Serena', 'serena.mcp.serena',
    [{ platform: 'solaris-sparc', status: 'qualified' }, { platform: 'linux-x64', status: 'qualified' }]),
  { id: 'serena.mcp.serena', title: 'Serena MCP', kind: 'mcp', framework: 'tools' },
  recipe('crg.ai-setup.code-review-graph', 'Code Review Graph', 'crg.mcp.code-review-graph', [{ platform: 'linux-x64', status: 'blocked' }]),
  { id: 'crg.mcp.code-review-graph', title: 'Code Review Graph MCP', kind: 'mcp', framework: 'tools' },
];
const published = { frameworks: [{ id: release, frameworkId: 'tools', sha256: release }],
  items: inventory.map(item => ({ id: release + '/' + item.id, itemId: item.id, framework: release, kind: item.kind, title: item.title })) };
const qualified = id => published.items.find(item => item.itemId === id).id;
const versions = { core: '1', catalog: '2', scan: '3' };
const summary = { packages: Object.entries(versions).map(([name, version]) => ({ name, version })) };
const clients = ['claude-code', 'codex'];
const choices = { format: 'aih-workbench-team-selection/1', organization: 'Fixture Org', source: '', versions, clients,
  items: [qualified('serena.ai-setup.serena')], files: [], allowPersonal: false };

const harness = {
  selectTool: id => ({ status: 'ok', tool: { id, surface: 'cli' } }),
  listTools: () => ({ tools: [...clients, 'kiro'].map(id => ({ id })) }),
};
// Core's decision as the stub models it: each planned item needs an applicable permit and no prohibition.
// In a plan that acquires a recipe, its companion MCP item is judged by the recipe's entries (C81).
const contracts = {
  deriveChangeIdentity: ({ change }) => ({ status: 'ok', changeIdentity: 'change-' + change.id }),
  validateOrganizationPolicy: document => ({ status: 'ok', value: document }),
  previewAdmission({ organization, request }) {
    const client = request.target.client.id;
    const setups = request.plan.plan.map(step => inventory.find(item => item.id === step.item && item.framework === step.framework))
      .filter(item => item?.kind === 'ai-setup');
    const admitted = request.plan.plan.every(planned => {
      const setup = setups.find(item => item.setup.mcpItem === planned.item && item.framework === planned.framework);
      const step = setup ? { item: setup.id, framework: setup.framework } : planned;
      const applicable = organization.entries.filter(entry => entry.content?.item === step.item && entry.content.framework === step.framework &&
        (!entry.scopes || entry.scopes.includes('project')) && (!entry.clients || entry.clients.includes(client)));
      return !applicable.some(entry => entry.obligation === 'prohibited') && applicable.some(entry => entry.obligation === 'permitted');
    });
    return { status: 'ok', value: { admitted } };
  },
};

function catalogSource({ hostPlansWithoutRecord = false } = {}) {
  return {
    catalog: { data: { repository: 'https://example.test/catalog', commit: 'c'.repeat(40) }, clients: clients.map(id => ({ id })),
      frameworks: [{ id: 'tools', sha256: release }], items: inventory },
    prepareSelection([selected], client, cell) {
      if (cell !== undefined && !/^(windows|darwin|linux)-(x64|arm64)$/.test(cell)) throw Error('Choose a published platform.');
      const item = inventory.find(entry => entry.id === selected.itemId);
      const steps = [{ item: item.id, framework: item.framework }];
      if (item.kind === 'ai-setup') {
        const host = cell === undefined;
        const ready = host ? hostPlansWithoutRecord : item.setup.qualifications.some(record => record.platform === cell && record.status === 'qualified');
        if (!ready) return { requestParts: null };
        steps.push({ item: item.setup.mcpItem, framework: item.framework });
      }
      return { requestParts: { plan: { status: 'ok', plan: steps } } };
    },
  };
}

const policyWith = source => createEnterprisePolicy({ consumer: '/unused', published, summary,
  catalog: async () => source, core: async () => ({ contracts, harness }) });

test('a Tool Setup recipe gets no companion entry: its MCP item is prohibited like any unselected item', async () => {
  const policy = policyWith(catalogSource());
  const { content, companions } = await policy.buildPolicy(choices);
  assert.ok(content.entries.every(entry => !entry.id.startsWith('tool-setup-companion-')), 'No companion entry is written.');
  const companion = content.entries.filter(entry => entry.content?.item === 'serena.mcp.serena');
  assert.deepEqual(companion.map(entry => entry.obligation), ['prohibited']);
  assert.equal(companion[0].clients, undefined);
  assert.deepEqual(companions, [{ item: 'serena.mcp.serena', framework: 'tools', title: 'Serena MCP',
    recipe: 'serena.ai-setup.serena', recipeTitle: 'Serena' }]);
  // Core admits the companion inside the recipe's plan, so members still receive the recipe.
  const opened = await policy.openPolicy(content);
  assert.deepEqual(opened.items, [qualified('serena.ai-setup.serena')]);
  assert.deepEqual(opened.itemClients, { [qualified('serena.ai-setup.serena')]: clients });
});

test('an earlier policy\'s companion entry stays hidden while the same policy permits its recipe', async () => {
  const policy = policyWith(catalogSource());
  const { content } = await policy.buildPolicy(choices);
  // Policies published before this change permitted the companion with its recipe's clients.
  const legacy = { id: 'tool-setup-companion-entry-' + '1'.repeat(24), obligation: 'permitted', scopes: ['project'], clients,
    content: { item: 'serena.mcp.serena', framework: 'tools' } };
  const entries = [...content.entries.filter(entry => entry.content?.item !== legacy.content.item), legacy];
  const opened = await policy.openPolicy({ ...content, entries });
  assert.deepEqual(opened.items, [qualified('serena.ai-setup.serena')]);
  // Without the recipe, the same entry is an ordinary permit.
  const alone = entries.filter(entry => entry.content?.item !== 'serena.ai-setup.serena');
  assert.deepEqual((await policy.openPolicy({ ...content, entries: alone })).items, [qualified('serena.mcp.serena')]);
});

test('a companion-prefixed entry without a recipe that configures it is still offered', async () => {
  const policy = policyWith(catalogSource());
  const { content } = await policy.buildPolicy(choices);
  const orphan = { id: 'tool-setup-companion-entry-' + '0'.repeat(24), obligation: 'permitted', scopes: ['project'], clients,
    content: { item: 'crg.mcp.code-review-graph', framework: 'tools' } };
  // A hand-edited document: the orphan replaces the prohibition buildPolicy wrote for this item.
  const entries = content.entries.filter(entry => entry.content?.item !== orphan.content.item);
  const opened = await policy.openPolicy({ ...content, entries: [...entries, orphan] });
  assert.ok(opened.items.includes(qualified('crg.mcp.code-review-graph')), JSON.stringify(opened.items));
});

test('a recipe is offered from a qualified platform other than the host, skipping a cell the source cannot plan', async () => {
  const source = catalogSource();
  assert.equal(source.prepareSelection([published.items[0]], 'codex').requestParts, null);
  const policy = policyWith(source);
  const opened = await policy.openPolicy((await policy.buildPolicy(choices)).content);
  assert.deepEqual(opened.itemClients[qualified('serena.ai-setup.serena')], clients);
});

test('a recipe without a qualified platform is not offered, even when the host plans it', async () => {
  const policy = policyWith(catalogSource({ hostPlansWithoutRecord: true }));
  const { content } = await policy.buildPolicy({ ...choices, items: [qualified('crg.ai-setup.code-review-graph')] });
  assert.deepEqual((await policy.openPolicy(content)).items, []);
});

test('a recipe the policy prohibits is not offered, whatever its companion\'s entries', async () => {
  const policy = policyWith(catalogSource());
  const { content } = await policy.buildPolicy(choices);
  const entries = content.entries.map(entry => entry.content?.item === 'serena.ai-setup.serena' && entry.obligation === 'permitted'
    ? { ...entry, obligation: 'prohibited' } : entry);
  assert.deepEqual((await policy.openPolicy({ ...content, entries })).items, []);
});

test('buildPolicy needs no owner and ignores the owner of an earlier selection', async () => {
  const policy = policyWith(catalogSource());
  const current = await policy.buildPolicy(choices);
  assert.equal(Object.hasOwn(current.selection, 'owner'), false);
  const earlier = await policy.buildPolicy({ ...choices, owner: 'Fixture Steward' });
  assert.deepEqual(earlier.content, current.content);
  assert.equal(Object.hasOwn(earlier.selection, 'owner'), false);
  await assert.rejects(policy.buildPolicy({ ...choices, owner: 7 }), /Choose an organization/);
});

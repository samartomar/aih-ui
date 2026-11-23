import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorkbench } from '../../src/approved/host.js';

const item = (id, releaseSha256, details = {}) => ({
  id, label: id, kind: 'skill', family: 'Catalog',
  root: { itemId: id, releaseSha256, scope: 'project', configuration: {} },
  ...details,
});
const json = value => Response.json(value);

test('approved Workbench displays the checked Catalog and preserves exact item identity', async t => {
  const records = [item('same', 'a'), item('same', 'b'), item('dependency', 'b', { role: 'supporting' }),
    item('demo', 'notes'), item('fixture', 'c')];
  const routes = {
    '/api/authoring-catalog': { items: records, templates: [{ releaseSha256: 'notes' }],
      frameworks: [{ id: 'configured', name: 'Configured', sha256: 'b', state: 'ready' },
        { id: 'specimen', sha256: 'c', kind: 'fixture' }] },
    '/api/packages': { coreTargets: { state: 'published', targets: ['alpha'], labels: { alpha: 'Alpha' } } },
    '/api/tools': { state: 'unavailable', reason: 'Tool registry unavailable.' },
  };
  t.mock.method(globalThis, 'fetch', async path => json(routes[path]));
  const workbench = await loadWorkbench();
  assert.deepEqual(workbench.items.map(record => [record.id, record.frameworkName]), [['a/same', 'Catalog'], ['b/same', 'Configured']]);
  assert.deepEqual(workbench.clients, [{ id: 'alpha', name: 'Alpha' }]);
  assert.deepEqual(workbench.tools, []);
  assert.equal(workbench.gaps.tools, 'Tool registry unavailable.');
});

test('an unavailable server response leaves independently supported controls available', async t => {
  t.mock.method(globalThis, 'fetch', async path => path === '/api/tools'
    ? json({ state: 'published', tools: [{ id: 'alpha', label: 'Alpha' }] })
    : new Response('', { status: 503 }));
  const { items, clients, gaps, tools } = await loadWorkbench();
  assert.deepEqual(items, []);
  assert.deepEqual(clients, []);
  assert.deepEqual(tools, [{ id: 'alpha', label: 'Alpha' }]);
  assert.ok(gaps.catalog);
  assert.ok(gaps.clients);
  assert.equal(gaps.tools, undefined);
});

test('planning follows the host result and evidence uses the same ephemeral client identity', async t => {
  const records = [item('first', 'a'), item('second', 'b')];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/authoring-catalog') return json({ items: records });
    if (!options?.body) return json({});
    const body = JSON.parse(options.body);
    requests.push({ path, body, client: options.headers['x-aih-client'] });
    if (path.endsWith('-new')) return json({ status: 'ok', value: { policyBytes: [1] } });
    if (path.endsWith('-edit')) {
      return body.operation.root.itemId === 'first'
        ? json({ status: 'ok', value: { policyBytes: [...body.policyBytes, 2] } })
        : json({ status: 'refused', diagnostics: [{ code: 'RECIPE_UNAVAILABLE' }] });
    }
    if (path.endsWith('-scan-evidence')) return json({ status: 'unavailable' });
    if (path.endsWith('-source-material')) return json({ status: 'read', text: 'Exact material.' });
    return new Response('', { status: 503 });
  });

  const workbench = await loadWorkbench();
  const result = await workbench.previewPlan(workbench.items, { tool: 'alpha', enterprise: true });
  assert.equal(result.status, 'refused');
  assert.equal(result.bytes, undefined);
  assert.equal(requests[0].body.mode, 'enterprise');
  assert.deepEqual(requests[1].body.operation, { type: 'select', tool: 'alpha', root: records[0].root });
  assert.deepEqual(requests[2].body.policyBytes, [1, 2]);
  const { bytes } = await workbench.previewPlan([workbench.items[0]]);
  assert.deepEqual(bytes, Uint8Array.of(1, 2));

  const evidence = await workbench.inspectItem(workbench.items[0], { tool: 'alpha' });
  assert.equal(evidence.evidence.status, 'unavailable');
  assert.equal(evidence.source.text, 'Exact material.');
  assert.equal(evidence.compatibility.status, 'failed');
  assert.equal(requests.find(request => request.path.endsWith('-scan-evidence')).body.target, 'a/first');
  assert.equal(new Set(requests.map(request => request.client)).size, 1);
});

test('read-only Catalog exposes recorded Scan evidence without claiming authentication or plan support', async t => {
  const publishedItem = { id: 'sha256/guide', itemId: 'guide', title: 'Guide', framework: 'sha256' };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async path => {
    requests.push(path);
    if (path === '/api/authoring-catalog') return json({ state: 'read-only', items: [publishedItem], frameworks: [], problems: [] });
    if (path === '/api/packages') return json({ packages: [{ name: 'catalog', version: '0.0.0-dev.1' }] });
    if (path === '/api/approved-evidence?item=sha256%2Fguide') {
      return json({ status: 'read', authentication: 'not-verified', assessment: { summary: { label: 'CAUTION' } } });
    }
    if (path === '/api/tool-inspection') return json({ state: 'inspected', status: 'ok' });
    return json({});
  });
  const workbench = await loadWorkbench();
  assert.deepEqual(workbench.items, [publishedItem]);
  assert.equal(workbench.packages.catalog.version, '0.0.0-dev.1');
  assert.deepEqual(await workbench.previewPlan(workbench.items, { tool: 'codex' }),
    { status: 'unavailable', reason: workbench.gaps.plan });
  const { evidence, compatibility } = await workbench.inspectItem(publishedItem);
  assert.equal(evidence.authentication, 'not-verified');
  assert.equal(evidence.assessment.summary.label, 'CAUTION');
  assert.equal(compatibility.status, 'unavailable');
  assert.equal((await workbench.inspectTools()).status, 'ok');
  assert.equal(requests.includes('/api/authoring-new'), false);
});

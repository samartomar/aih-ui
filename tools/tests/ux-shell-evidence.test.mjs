import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectorEvidence } from '../../src/app/inspector-evidence.js';
import { el } from '../../src/app/dom.js';

function node(tagName) {
  return { tagName, children: [], attributes: {}, dataset: {}, listeners: {}, textContent: '',
    append(...values) { this.children.push(...values); },
    replaceChildren(...values) { this.children = values; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, value) { this.listeners[key] = value; },
  };
}
const descendants = value => [value, ...value.children.flatMap(descendants)];
function harness(t, result) {
  t.mock.method(globalThis, 'setInterval', () => 1);
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: node } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  let show;
  const calls = [];
  const evidence = createInspectorEvidence({
    authoring: { evidenceRevision: 1, request: async (operation, body) => { calls.push({ operation, body }); return result; } },
    subscribeSecurity: listener => { show = listener; listener(false); },
  });
  evidence.show({ id: 'item-one', root: { releaseSha256: 'release-one' } });
  show(true);
  return { ...evidence, calls, read: async () => { t.mock.timers.tick(250); await new Promise(resolve => setImmediate(resolve)); } };
}

test('item coverage precedes collapsed whole-source findings and preserves coverage caveats', async t => {
  const h = harness(t, {
    status: 'selected', evaluationTime: '2026-10-21T10:00:00Z', freshness: 'current',
    assessment: { coverage: { status: 'matched', observationCount: 0 }, acquisitions: [],
      summary: { completion: 'completed', createdAt: '2026-10-20', producer: { name: 'Fixture', version: '1' },
        findings: { records: 12, occurrences: 24, bySeverity: [] }, providers: [] } },
  });
  assert.equal(h.panel.attributes['aria-busy'], 'true');
  await h.read();
  assert.equal(h.panel.attributes['aria-busy'], undefined);
  assert.equal(h.calls[0].body.target, 'release-one/item-one');
  const facts = h.panel.children[1];
  assert.match(facts.children[0].textContent, /This item.*no demonstrated detector coverage/);
  const disclosure = facts.children.find(value => value.tagName === 'details');
  assert.ok(disclosure);
  assert.equal(disclosure.open, undefined);
  assert.match(disclosure.children[0].textContent, /Whole scanned source.*separate from this item/);
  assert.ok(descendants(disclosure).some(value => /12.*24 occurrences across the source/.test(value.textContent)));
  assert.ok(descendants(facts).some(value => /not an item risk score/.test(value.textContent)));
});

test('failed evidence gives a working recheck action and leaves an announced failure', async t => {
  const h = harness(t, { status: 'error', message: 'Source offline' });
  await h.read();
  assert.match(h.panel.children[0].textContent, /Source offline.*Re-check sources to retry/);
  assert.equal(h.panel.children[0].attributes.role, 'status');
  h.panel.children[2].listeners.click();
  await h.read();
  assert.equal(h.calls.length, 2);
});

test('dynamically created decorative symbols are hidden from assistive technology', t => {
  harness(t, { status: 'unconfigured' });
  assert.equal(el('span', 'material-symbols-outlined text-primary', 'extension').attributes['aria-hidden'], 'true');
  assert.equal(el('span', 'text-primary', 'Visible label').attributes['aria-hidden'], undefined);
});

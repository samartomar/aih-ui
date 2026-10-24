import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceReview } from '../../src/app/evidence-review.js';

test('direct and subsequent review routes open the same disclosure and focus evidence without acquiring sources', t => {
  const previous = { document: globalThis.document, location: globalThis.location, Option: globalThis.Option };
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  const created = [], listeners = {};
  const make = tag => { const node = { tag, children: [], value: '', dataset: {}, listeners: {}, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, setAttribute(key, value) { this[key] = value; }, addEventListener(key, fn) { this.listeners[key] = fn; }, get options() { return this.children; }, focus() { globalThis.document.activeElement = this; }, scrollIntoView() { this.scrolled = true; } }; created.push(node); return node; };
  const reviewPanel = make('aside'); reviewPanel.id = 'policy-review-panel'; reviewPanel.hidden = true;
  let opens = 0, requests = 0;
  const trigger = make('button'); trigger.id = 'review-project-changes'; trigger.click = () => { reviewPanel.hidden = false; opens++; };
  globalThis.Option = class { constructor(text, value) { this.textContent = text; this.value = value; } };
  globalThis.location = { hash: '#review' };
  globalThis.document = { createElement: make, getElementById: id => created.find(node => node.id === id), addEventListener: (key, fn) => { listeners[key] = fn; } };
  createEvidenceReview({ catalog: { items: [] }, intent: { pins: [] }, subscribe() {}, request() { requests++; } }, () => {});
  const evidence = created.find(node => node.id === 'evidence-review');
  assert.equal(reviewPanel.hidden, false); assert.equal(evidence.open, true); assert.equal(opens, 1);
  assert.equal(document.activeElement['aria-label'], 'Review evidence files'); assert.equal(evidence.scrolled, true);
  reviewPanel.hidden = true; evidence.open = false;
  listeners['aih:view-changed']({ detail: { view: 'catalog' } });
  assert.equal(reviewPanel.hidden, true);
  listeners['aih:view-changed']({ detail: { view: 'review' } });
  assert.equal(reviewPanel.hidden, false); assert.equal(evidence.open, true); assert.equal(opens, 2);
  assert.equal(document.activeElement['aria-label'], 'Review evidence files'); assert.equal(requests, 0);
});

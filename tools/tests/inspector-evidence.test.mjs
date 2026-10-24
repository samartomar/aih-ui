import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceLoader } from '../../src/app/inspector-evidence.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [], states = [];
  const loader = createEvidenceLoader({ request: body => new Promise((resolve, reject) => calls.push({ body, resolve, reject })), onState: state => states.push(state) });
  const choose = (target, revision = 0, clientTarget = 'claude-code') => loader.select({ target, revision, clientTarget });
  const finish = async (index, label = index) => { calls[index].resolve({ status: 'selected', label }); await settle(); };
  return { calls, states, loader, choose, finish, tick: () => t.mock.timers.tick(250) };
}

test('evidence starts only while visible and cached reopening makes no request', async t => {
  const h = harness(t);
  h.choose('release/alpha'); h.tick(); assert.equal(h.calls.length, 0);
  h.loader.setVisible(true); h.tick(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.projection, 'inspector');
  await h.finish(0);
  h.loader.setVisible(false); h.loader.setVisible(true); h.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.states.at(-1).label, 0);
  h.choose('release/alpha'); h.tick(); assert.equal(h.calls.length, 1);
});

test('rapid selections serialize requests and never paint a stale response', async t => {
  const h = harness(t); h.loader.setVisible(true);
  h.choose('release/alpha'); h.tick();
  h.choose('release/beta'); h.tick();
  h.choose('release/gamma'); h.tick();
  assert.equal(h.calls.length, 1);
  await h.finish(0, 'alpha');
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.target, 'release/gamma');
  assert.ok(!h.states.some(state => state.label === 'alpha'));
  await h.finish(1, 'gamma'); assert.equal(h.states.at(-1).label, 'gamma');
});

test('closing Security cancels queued work and suppresses active response rendering', async t => {
  const h = harness(t); h.loader.setVisible(true);
  h.choose('release/alpha'); h.tick(); h.choose('release/beta'); h.tick();
  h.loader.setVisible(false); const count = h.states.length;
  await h.finish(0); h.tick();
  assert.equal(h.calls.length, 1); assert.equal(h.states.length, count);
  h.choose('release/gamma'); h.tick(); assert.equal(h.calls.length, 1);
  h.loader.setVisible(true); h.tick(); assert.equal(h.calls[1].body.target, 'release/gamma');
  await h.finish(1);
});

test('release, item, evidence revision and explicit refresh invalidate cached answers', async t => {
  const h = harness(t); h.loader.setVisible(true);
  for (const [index, selection] of [['one/alpha', 0], ['two/alpha', 0], ['two/alpha', 1], ['two/beta', 1]].entries()) {
    h.choose(...selection); h.tick(); assert.equal(h.calls.length, index + 1); await h.finish(index);
  }
  const time = h.calls[3].body.evaluationTime;
  h.loader.recheck(); h.tick(); assert.equal(h.calls.length, 5);
  assert.notEqual(h.calls[4].body.evaluationTime, time); await h.finish(4);
});

test('refresh during a request discards the old snapshot and errors can be retried', async t => {
  const h = harness(t); h.loader.setVisible(true); h.choose('release/alpha'); h.tick();
  h.loader.recheck(); h.tick(); await h.finish(0, 'old');
  assert.equal(h.calls.length, 2); assert.ok(!h.states.some(state => state.label === 'old'));
  h.calls[1].reject(new Error('offline')); await settle(); assert.equal(h.states.at(-1).status, 'error');
  h.loader.recheck(); h.tick(); await h.finish(2, 'new'); assert.equal(h.states.at(-1).label, 'new');
});

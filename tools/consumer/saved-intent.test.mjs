import test from 'node:test';
import assert from 'node:assert/strict';
import { freshIntent, composeIntent, reopenIntent, transactIntent, reviewIntentUpdate, itemKey, indexReleases, LIMITS } from './saved-intent.mjs';
import { journeyFixture, fixtureRelease, fixtureItem, rootFor, crossRef } from './intent-fixtures.mjs';
const fixture = journeyFixture();
const { index, templates, entries: [shared, app] } = fixture;
const okay = result => { assert.equal(result.valid, true, JSON.stringify(result.diagnostics)); return result; };
const compose = (roots, exclusions = [], extra = {}) => okay(composeIntent({ index, templates, intent: { ...freshIntent(), roots, exclusions }, capture: true, ...extra }));
const edit = (original, operation) => transactIntent({ index, templates, policyText: original.policyText, operation });
const root = id => rootFor(app, id);
const exclude = id => { const { scope, configuration, ...ref } = rootFor(shared, id); return ref; };

test('two checked releases share one prerequisite; optional skip and provenance round-trip in both modes', () => {
  for (const mode of ['vibe', 'enterprise']) {
    const authored = compose([root('app.alpha'), root('app.beta')], [exclude('shared.optional')], { mode });
    assert.equal(authored.policy.selections.length, 3);
    assert.equal(authored.optional[0].skipped, true);
    const prerequisite = authored.policy.selections.find(selection => selection.id.endsWith('--shared.base'));
    assert.equal(authored.reasons[prerequisite.id].length, 2);
    assert.equal(authored.intent.provenance.length, 2);
    const reopened = okay(reopenIntent({ index, templates, policyText: authored.policyText }));
    assert.equal(reopened.policyText, authored.policyText);
    assert.deepEqual(reopened.intent, authored.intent);
  }
});

test('removal preserves shared requirement and explicit roots; last removal can Keep orphan', () => {
  const authored = compose([root('app.alpha'), root('app.beta')]);
  const first = okay(edit(authored, { type: 'remove-root', key: itemKey(root('app.alpha')), scope: 'project' }));
  assert.equal(first.policy.selections.length, 2);
  assert.equal(first.impact.removed.length, 1);
  const kept = okay(edit(first, { type: 'remove-root', key: itemKey(root('app.beta')), scope: 'project', keepKeys: [itemKey(rootFor(shared, 'shared.base'))] }));
  assert.equal(kept.policy.selections.length, 1);
  assert.equal(kept.intent.roots[0].itemId, 'shared.base');
  const removed = okay(edit(first, { type: 'remove-root', key: itemKey(root('app.beta')), scope: 'project' }));
  assert.equal(removed.policy.selections.length, 0);
  const explicit = compose([root('app.alpha'), rootFor(shared, 'shared.base')]);
  assert.equal(okay(edit(explicit, { type: 'remove-root', key: itemKey(root('app.alpha')), scope: 'project' })).policy.selections.length, 1);
});

test('required item removal explains affected roots and requires explicit dependent removal', () => {
  const authored = compose([root('app.alpha'), root('app.beta')]);
  const key = itemKey(rootFor(shared, 'shared.base'));
  const refused = edit(authored, { type: 'remove-item', key });
  assert.equal(refused.valid, false); assert.equal(refused.affectedRoots.length, 2);
  assert.equal(refused.originalPolicyText, authored.policyText);
  assert.equal(okay(edit(authored, { type: 'remove-item', key, removeDependents: true })).policy.selections.length, 0);
});

test('template exact origin removal preserves independent ownership and skip origin', () => {
  const authored = compose([root('app.alpha')], [exclude('shared.optional')]);
  const templated = okay(edit(authored, { type: 'template', templateId: templates[0].id, templateSha256: templates[0].sha256, originId: 'starter' }));
  assert.deepEqual(templated.intent.roots[0].originIds, ['direct', 'starter']);
  const removed = okay(edit(templated, { type: 'remove-origin', originId: 'starter' }));
  assert.deepEqual(removed.intent.roots, authored.intent.roots);
  assert.deepEqual(removed.intent.exclusions, authored.intent.exclusions);
  assert.equal(edit(authored, { type: 'template', templateId: templates[0].id, templateSha256: '0'.repeat(64), originId: 'stale' }).valid, false);
});

test('required path through an optional member cannot defeat explicit exclusion; conflicts and cycles refused atomically', () => {
  const entry = fixtureRelease('paths', [fixtureItem('a', { requires: [{ itemId: 'b' }], optional: [{ itemId: 'c' }] }),
    fixtureItem('b', { requires: [{ itemId: 'c' }] }), fixtureItem('c'), fixtureItem('d', { conflicts: [{ itemId: 'a' }] })]);
  const localIndex = indexReleases([entry]);
  const ref = rootFor(entry, 'c'); delete ref.scope; delete ref.configuration;
  const intent = { ...freshIntent(), roots: [rootFor(entry, 'a')], exclusions: [ref] };
  assert.equal(composeIntent({ index: localIndex, intent, capture: true }).valid, false);
  intent.exclusions = []; intent.roots.push(rootFor(entry, 'd'));
  const conflict = composeIntent({ index: localIndex, intent, capture: true });
  assert.equal(conflict.valid, false); assert.ok(conflict.diagnostics.some(value => value.reason.includes('conflict')));
  assert.throws(() => fixtureRelease('cycles', [fixtureItem('a', { requires: [{ itemId: 'b' }] }), fixtureItem('b', { requires: [{ itemId: 'a' }] })]), /dependency-cycle/);
});

test('missing cross-release and stale exact dependency identities are refused', () => {
  assert.equal(composeIntent({ index: indexReleases([app]), intent: { ...freshIntent(), roots: [root('app.alpha')] }, capture: true }).valid, false);
  const dependency = crossRef(shared, 'shared.base'); dependency.itemSha256 = '0'.repeat(64);
  const stale = fixtureRelease('stale', [fixtureItem('stale', { requires: [dependency] })]);
  assert.equal(composeIntent({ index: indexReleases([shared, stale]), intent: { ...freshIntent(), roots: [rootFor(stale, 'stale')] }, capture: true }).valid, false);
});

test('contradictory selections, pins, origins, provenance, and malformed/bounded input refused', () => {
  const original = compose([root('app.alpha')]);
  for (const mutate of [
    policy => { policy.selections[0].configuration = { bad: true }; },
    policy => { policy.metadata['aih.workbench'].pins = []; },
    policy => { policy.metadata['aih.workbench'].roots[0].originIds = ['missing']; },
    policy => { policy.metadata['aih.workbench'].provenance[0].package.version = 'other'; },
    policy => { policy.metadata['aih.workbench'].roots[0].itemSha256 = '0'.repeat(64); }
  ]) {
    const policy = structuredClone(original.policy); mutate(policy);
    assert.equal(reopenIntent({ index, templates, policyText: JSON.stringify(policy) }).valid, false);
  }
  for (const change of [{ roots: [null] }, { roots: Array(LIMITS.roots + 1).fill(null) }, { origins: [{id:'direct',kind:'direct',payload:'x'.repeat(LIMITS.bytes)}] }]) {
    assert.equal(composeIntent({ index, intent: { ...freshIntent(), ...change }, capture: true }).valid, false);
  }
});

test('configuration collisions refuse edit without changing original; valid explicit configuration survives', () => {
  const configured = rootFor(app, 'app.configured', ['direct'], { directory: 'alpha' });
  const original = compose([configured]);
  assert.equal(edit(original, { type: 'select', root: { ...configured, configuration: { directory: 'beta' } } }).valid, false);
  assert.equal(okay(reopenIntent({ index, policyText: original.policyText })).intent.roots[0].configuration.directory, 'alpha');
});

test('changed and missing update requires explicit decisions, retains original and skips, keeps stable management identities', () => {
  const original = compose([root('app.alpha'), rootFor(shared, 'shared.retired')], [exclude('shared.optional')]);
  const args = { previousIndex: index, index: fixture.nextIndex, templates, policyText: original.policyText, replacements: fixture.replacements };
  const review = reviewIntentUpdate(args);
  assert.equal(review.valid, false);
  assert.ok(review.changes.some(change => change.state === 'changed'));
  assert.ok(review.changes.some(change => change.state === 'missing'));
  const resolutions = Object.fromEntries(review.changes.filter(change => change.state !== 'unchanged').map(change => [change.key, change.state === 'missing' ? 'remove' : 'accept']));
  const update = okay(reviewIntentUpdate({ ...args, resolutions }));
  assert.equal(update.requiresAcceptance, true); assert.equal(update.originalPolicyText, original.policyText);
  assert.equal(update.intent.exclusions[0].itemId, 'shared.optional');
  assert.deepEqual(update.policy.selections.map(value => value.managementId).sort(), original.policy.selections.filter(value => !value.id.endsWith('--shared.retired')).map(value => value.managementId).sort());
  assert.equal(okay(reopenIntent({ index, templates, policyText: original.policyText })).policyText, original.policyText);
  assert.equal(okay(reopenIntent({ index: fixture.nextIndex, templates, policyText: update.policyText })).editable, true);
});

test('removing a dependency pin during update is never silently recaptured', () => {
  const original = compose([root('app.alpha')]);
  const args = { previousIndex: index, index: fixture.nextIndex, templates, policyText: original.policyText, replacements: fixture.replacements };
  const review = reviewIntentUpdate(args);
  const resolutions = Object.fromEntries(review.changes.map(change => [change.key, change.saved.itemId === 'shared.base' ? 'remove' : 'accept']));
  assert.equal(reviewIntentUpdate({ ...args, resolutions }).valid, false);
});

test('Keep promotes a dropped changed or missing prerequisite to an exact direct root, or refuses unavailable old content', () => {
  const old = fixtureRelease('kept-orphan', [fixtureItem('dependency'), fixtureItem('parent', { requires: [{ itemId: 'dependency' }] })]);
  const previousIndex = indexReleases([old]);
  const original = okay(composeIntent({ index: previousIndex, capture: true, intent: { ...freshIntent(), roots: [rootFor(old, 'parent')] } }));
  const oldKey = itemKey(rootFor(old, 'dependency'));
  for (const missing of [false, true]) {
    const next = fixtureRelease('kept-orphan', [
      ...(missing ? [] : [fixtureItem('dependency', {}, { description: 'New changed dependency.' })]), fixtureItem('parent')
    ]);
    const args = { previousIndex, policyText: original.policyText, replacements: { [old.release.sha256]: next.release.sha256 },
      resolutions: { [itemKey(rootFor(old, 'parent'))]: 'accept', [oldKey]: 'keep' } };
    const kept = okay(reviewIntentUpdate({ ...args, index: indexReleases([old, next]) }));
    const promoted = kept.intent.roots.find(ref => itemKey(ref) === oldKey);
    assert.ok(promoted, 'the dropped prerequisite is an explicit retained root');
    assert.equal(promoted.scope, 'project'); assert.deepEqual(promoted.configuration, {}); assert.deepEqual(promoted.originIds, ['direct']);
    assert.deepEqual(kept.intent.pins.find(ref => itemKey(ref) === oldKey), original.intent.pins.find(ref => itemKey(ref) === oldKey));
    const unavailable = reviewIntentUpdate({ ...args, index: indexReleases([next]) });
    assert.equal(unavailable.valid, false); assert.equal(unavailable.diagnostics[0].reason, 'keep-unavailable');
    assert.equal(unavailable.originalPolicyText, original.policyText);
  }
});

test('unavailable original preserves exact JSON and provenance for diagnosis', () => {
  const original = compose([root('app.alpha')]);
  const result = reopenIntent({ index: fixture.nextIndex, templates, policyText: original.policyText });
  assert.equal(result.valid, false); assert.equal(result.editable, false); assert.equal(result.policyText, original.policyText);
  assert.equal(result.reconciliation[0].state, 'missing'); assert.deepEqual(result.intent.provenance, original.intent.provenance);
});

test('edits preserve unrelated metadata and refuse evidence/lifecycle stripping', () => {
  const original = compose([root('app.alpha')]);
  original.policy.metadata.other = { note: 'retained annotation' };
  original.policyText = JSON.stringify(original.policy);
  const edited = okay(edit(original, { type: 'select', root: root('app.beta') }));
  assert.deepEqual(edited.policy.metadata.other, original.policy.metadata.other);
  for (const mutate of [policy => { policy.evidence = []; }, policy => { policy.removals = [{managementId:'old',scope:'project'}]; }]) {
    const policy = structuredClone(original.policy); mutate(policy);
    const policyText = JSON.stringify(policy);
    const reopened = okay(reopenIntent({ index, policyText }));
    assert.equal(reopened.policyText, policyText);
    for (const operation of [{type:'remove-root',key:itemKey(root('app.alpha')),scope:'project'}, {type:'select',root:root('app.beta')}]) {
      const result = transactIntent({ index, policyText, operation });
      assert.equal(result.valid, false); assert.equal(result.diagnostics[0].reason, 'annotations'); assert.equal(result.originalPolicyText, policyText);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setDisplayName } from '../../src/catalog/set-name.js';

const frameworks = [
  { id: 'ecc', sha256: 'r'.repeat(64), sets: [{ id: 'ecc.rules.typescript', name: 'rules (typescript)', setSha256: 'a'.repeat(64) }] },
  { id: 'superpowers', sha256: 's'.repeat(64), sets: [{ id: 'ecc.rules.typescript', name: 'Another framework\'s set', setSha256: 'a'.repeat(64) }] },
];

test('a set is named by the name Catalog publishes for it, never by its id or digest', async () => {
  const { setLabeller } = await import('../../src/app/installed-list.js');
  const earlier = { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'b'.repeat(64) };
  assert.equal(setDisplayName(frameworks, earlier), setLabeller(frameworks)(earlier), 'every screen labels a set as the installed list does');
  assert.equal(setDisplayName(frameworks, { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) }), 'rules (typescript)');
  assert.equal(setDisplayName(frameworks, { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'b'.repeat(64) }), 'rules (typescript) (earlier release)', 'an earlier digest of an offered set is labelled as the installed list labels it');
  assert.equal(setDisplayName(frameworks, { releaseSha256: 'r'.repeat(64), setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) }), 'rules (typescript)', 'a saved request names its framework by release');
  assert.equal(setDisplayName(frameworks, { framework: 'ecc', setId: 'gone', setSha256: 'a'.repeat(64) }), undefined);
  assert.equal(setDisplayName(undefined, { framework: 'ecc', setId: 'ecc.rules.typescript' }), undefined);
});

test('the first-step line names each set by its Catalog name', async () => {
  const { firstRunWords } = await import('../../src/app/install-panel.js');
  const set = { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) };
  assert.equal(firstRunWords([{ set, reason: 'This set declares no first step.' }], frameworks),
    'First-step guidance unavailable for set rules (typescript): This set declares no first step.');
  assert.equal(firstRunWords([{ set: { ...set, setId: 'gone' }, reason: 'This set declares no first step.' }], frameworks),
    'First-step guidance unavailable for a set this catalog no longer offers: This set declares no first step.');
  assert.equal(firstRunWords([{ set, firstRun: { name: 'tdd', kind: 'skill' } }], frameworks),
    'First step: tdd (skill) — the step its set rules (typescript) declares to run first. It does not run by itself.');
});

test('a set\'s observed counts in the set picker carry its name', async () => {
  const { setFitWords } = await import('../../src/catalog/starting-sets.js');
  const value = { set: { setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) }, members: { native: 0, unconfirmed: 20, none: 1 } };
  assert.equal(setFitWords(value, frameworks[0]), 'rules (typescript) · 0 observed · 20 unconfirmed · 1 unavailable');
  assert.equal(setFitWords({ ...value, set: { setId: 'gone' } }, frameworks[0]), 'Set · 0 observed · 20 unconfirmed · 1 unavailable');
});

test('a saved request whose release Catalog has since replaced is labelled as the installed list labels it', () => {
  const gone = 'f'.repeat(64);
  assert.equal(setDisplayName(frameworks, { releaseSha256: gone, setId: 'ecc.rules.typescript', setSha256: 'a'.repeat(64) }), 'rules (typescript)',
    'the exact set, found by its digest in any framework');
  const unique = [frameworks[0], { id: 'superpowers', sha256: 's'.repeat(64), sets: [{ id: 'superpowers', name: 'Superpowers', setSha256: 'c'.repeat(64) }] }];
  assert.equal(setDisplayName(unique, { releaseSha256: gone, setId: 'ecc.rules.typescript', setSha256: 'b'.repeat(64) }), 'rules (typescript) (earlier release)',
    'else the one set of that id across frameworks, as an earlier release');
  assert.equal(setDisplayName(frameworks, { releaseSha256: gone, setId: 'ecc.rules.typescript', setSha256: 'b'.repeat(64) }), undefined,
    'a set id two frameworks offer is not guessed');
});

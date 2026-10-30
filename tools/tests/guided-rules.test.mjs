import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDED_BY_YOU, GUIDED_RULES_VERSION, KNOWN_STACK, RULE_TARGETS, addDetection, choiceReason, clientPrompt, describePolicy, detectStack, observationsFrom, provenanceText, reconcileClient, suggestStarters, wantsContent }
  from '../../src/app/guided-rules.js';

const item = (id, kind, { scopes = ['project', 'user'], requires = [], inputs = {}, description = `${id} description.`, clientId } = {}) =>
  ({ id, kind, ...(clientId === undefined ? {} : { clientId }), label: id.split('.').pop().replaceAll('-', ' '), description, scopes, inputs, dependencies: { requires: requires.map(itemId => ({ itemId })) },
    root: { releaseSha256: 'a'.repeat(64), itemId: id, itemSha256: 'b'.repeat(64), scope: scopes[0], configuration: {}, originIds: ['direct'] } });
// Catalog publishes inputs as an object keyed by input name.
const skillsDir = { agentDirectory: { description: 'Project directory that receives skills/<name>/ (Claude Code reads .claude).', default: '.claude', required: true, type: 'string' } };
const CATALOG = [
  item('mattpocock.diagnosing-bugs', 'skill', { inputs: skillsDir }),
  item('mattpocock.tdd', 'skill', { inputs: skillsDir }),
  item('mattpocock.implement', 'skill', { requires: ['mattpocock.code-review'] }),
  item('mattpocock.code-review', 'skill'),
  item('mattpocock.improve-codebase-architecture', 'skill'),
  item('mattpocock.grill-me', 'skill'),
  item('mattpocock.teach', 'skill'),
  item('mattpocock.research', 'skill'),
  item('aihq.project-context', 'project-context', { scopes: ['project'], description: 'Writes shared project context to AGENTS.md for every AI client.' }),
  item('aihq.project-context-pointer.claude-md', 'client-entry-pointer', { scopes: ['project'], requires: ['aihq.project-context'], description: 'Points CLAUDE.md at the shared project context.' }),
  item('aihq.client.claude', 'client-adapter', { clientId: 'claude', requires: ['aihq.project-context-pointer.claude-md'], description: 'Claude Code adapter note and its native entry pointer(s): claude-md.' }),
  item('aihq.client.codex', 'client-adapter', { clientId: 'codex', scopes: ['project'], description: 'Connects the Codex client to your setup.' }),
];
const file = (path, text) => (text === undefined ? { path } : { path, text });
const pkg = deps => file('package.json', JSON.stringify({ name: 'x', devDependencies: deps }));
const JS = [pkg({ vitest: '^1', react: '^18', typescript: '^5' }), file('tsconfig.json', '{}')];
const PY = [file('requirements.txt', 'pytest==8\nflask==3\n')];
const GO = [file('go.mod', 'module example.com/app\n')];

const pairs = result => result.choices.map(choice => [choice.itemId, choice.ruleId]);
const run = (files, goal, clients = [], catalogItems = CATALOG, extra = {}) =>
  suggestStarters({ goal, detections: detectStack(files).detections, clients, catalogItems, ...extra });

const ROWS = [
  { name: 'JS project, fix goal', files: JS, goal: 'fix the login bug', clients: [], status: 'confident',
    expect: [['mattpocock.diagnosing-bugs', 'goal.fix'], ['mattpocock.tdd', 'stack.tests'], ['aihq.project-context', 'stack.context']] },
  { name: 'client dependency chain absorbs context; build absorbs review', files: JS, goal: 'add a feature and review it', clients: ['claude'], status: 'confident',
    expect: [['aihq.client.claude', 'client.claude'], ['mattpocock.implement', 'goal.build'], ['mattpocock.tdd', 'stack.tests']] },
  { name: 'Python learner', files: PY, goal: 'I want to understand the code, I am new to this', clients: [], status: 'confident',
    expect: [['mattpocock.teach', 'goal.learn'], ['mattpocock.tdd', 'stack.tests'], ['aihq.project-context', 'stack.context']] },
  { name: 'no project, planning and research fill with review', files: [], goal: 'plan a new idea and research the docs', clients: [], status: 'confident',
    expect: [['mattpocock.grill-me', 'goal.plan'], ['mattpocock.research', 'goal.research'], ['mattpocock.code-review', 'fill.review']] },
  { name: 'unrecognised stack and unmatched goal', files: [file('notes.txt')], goal: 'hmm, something nice', clients: ['claude'], status: 'no-confident-suggestion', expect: [] },
  { name: 'bug goal without a project fills to three', files: [], goal: 'fix a bug', clients: [], status: 'confident',
    expect: [['mattpocock.diagnosing-bugs', 'goal.fix'], ['mattpocock.code-review', 'fill.review'], ['mattpocock.tdd', 'fill.tdd']] },
  { name: 'Go project, two clients, sorted by id', files: GO, goal: 'refactor the architecture', clients: ['codex', 'claude'], status: 'confident',
    expect: [['aihq.client.claude', 'client.claude'], ['aihq.client.codex', 'client.codex'], ['mattpocock.improve-codebase-architecture', 'goal.refactor']] },
  { name: 'at most five choices', files: [], goal: 'fix bugs, write tests, build a feature, review pull requests, refactor, plan, learn, research', clients: ['claude'], status: 'confident',
    expect: [['aihq.client.claude', 'client.claude'], ['mattpocock.diagnosing-bugs', 'goal.fix'], ['mattpocock.tdd', 'goal.test'], ['mattpocock.implement', 'goal.build'],
      ['mattpocock.improve-codebase-architecture', 'goal.refactor']] },
  { name: 'inspected project with no recognised language is not confident even when the goal matches', files: [file('mix.exs', 'defmodule X do end')], goal: 'fix a bug',
    clients: [], extra: { projectInspected: true }, status: 'no-confident-suggestion', expect: [], message: /languages were not recognised/ },
  { name: 'a language added by hand makes an inspected project recognised', files: [file('mix.exs', 'defmodule X do end')], goal: 'fix a bug',
    clients: [], extra: { projectInspected: true, addLanguage: 'python' }, status: 'confident',
    expect: [['mattpocock.diagnosing-bugs', 'goal.fix'], ['aihq.project-context', 'stack.context'], ['mattpocock.code-review', 'fill.review']] },
  { name: 'no folder inspected keeps goal-only suggestions', files: [], goal: 'fix a bug', clients: [], extra: { projectInspected: false }, status: 'confident',
    expect: [['mattpocock.diagnosing-bugs', 'goal.fix'], ['mattpocock.code-review', 'fill.review'], ['mattpocock.tdd', 'fill.tdd']] },
  { name: 'clients alone are never confident', files: [], goal: '', clients: ['claude', 'codex'], status: 'no-confident-suggestion', expect: [] },
];
for (const row of ROWS) {
  test(`suggestions: ${row.name}`, () => {
    const { addLanguage, ...extra } = row.extra ?? {};
    const detections = detectStack(row.files).detections;
    const result = suggestStarters({ goal: row.goal, detections: addLanguage ? addDetection(detections, addLanguage) : detections, clients: row.clients, catalogItems: CATALOG, ...extra });
    assert.equal(result.status, row.status);
    assert.equal(result.rulesVersion, GUIDED_RULES_VERSION);
    assert.deepEqual(pairs(result), row.expect);
    for (const choice of result.choices) assert.ok(choice.why.trim().length > 0, `${choice.itemId} explains why`);
    if (row.status === 'no-confident-suggestion') assert.match(result.message, row.message ?? /could not match your goal or project to a starter set with confidence/);
  });
}

test('a rule whose item is not in the catalog is skipped, never substituted', () => {
  const only = CATALOG.filter(entry => entry.id === 'mattpocock.diagnosing-bugs');
  const result = run([], 'fix a bug', [], only);
  assert.equal(result.status, 'no-confident-suggestion');
  assert.deepEqual(result.choices, []);
});

test('the same input twice and in shuffled file order gives deep-equal output', () => {
  const files = [...JS, ...PY, ...GO, file('Dockerfile'), file('.github/workflows/ci.yml'), file('CLAUDE.md'), file('Calc.csproj')];
  const first = run(files, 'fix a slow test', ['codex', 'claude']);
  const second = run(files, 'fix a slow test', ['codex', 'claude']);
  const shuffled = run([...files].reverse().sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? 1 : -1)), 'fix a slow test', ['claude', 'codex']);
  assert.deepEqual(second, first);
  assert.deepEqual(shuffled, first);
  assert.deepEqual(detectStack(files), detectStack([...files].reverse()));
});

test('choices carry plain-language needs, changes, helps-with and dependencies from catalog facts', () => {
  const { choices } = run(JS, 'fix the login bug', ['claude']);
  const diagnosing = choices.find(choice => choice.itemId === 'mattpocock.diagnosing-bugs');
  assert.ok(diagnosing.helpsWith.length > 0);
  assert.ok(diagnosing.needs.includes("Project directory that receives skills/<name>/ (Claude Code reads .claude). (default .claude)"), diagnosing.needs.join("|"));
  assert.ok(diagnosing.changes.some(line => /Adds the diagnosing bugs skill to your project for your AI client to use when relevant; it runs nothing by itself/.test(line)), diagnosing.changes.join('|'));
  assert.equal(diagnosing.scope, 'project');
  const client = choices.find(choice => choice.itemId === 'aihq.client.claude');
  assert.deepEqual(client.dependencies.map(dependency => dependency.itemId), ['aihq.project-context-pointer.claude-md', 'aihq.project-context']);
  assert.ok(client.needs.some(line => line.includes('project context')));
  assert.ok(client.changes.some(line => line.includes('Claude Code adapter note')));
  for (const text of [...diagnosing.needs, ...diagnosing.changes, ...client.needs, ...client.changes]) assert.doesNotMatch(text, /[0-9a-f]{16,}/);
});

test('scope is project only when the item allows it and a folder was inspected, or the item is project-only', () => {
  const user = run([], 'fix a bug').choices.find(choice => choice.itemId === 'mattpocock.diagnosing-bugs');
  assert.equal(user.scope, 'user', 'a both-scope item without an inspected folder gets the non-project scope');
  assert.equal(run(JS, 'fix a bug').choices.find(choice => choice.itemId === 'mattpocock.diagnosing-bugs').scope, 'project');
  const items = CATALOG.map(entry => entry.id === 'mattpocock.diagnosing-bugs' ? { ...entry, scopes: ['user', 'project'] } : entry);
  const notInspected = run([], 'fix a bug', [], items).choices[0];
  assert.equal(notInspected.scope, 'user');
  const inspected = run(PY, 'fix a bug', [], items, { projectInspected: true }).choices.find(choice => choice.itemId === 'mattpocock.diagnosing-bugs');
  assert.equal(inspected.scope, 'project');
  const onlyProject = run([], 'plan', ['codex']).choices.find(choice => choice.itemId === 'aihq.client.codex');
  assert.equal(onlyProject.scope, 'project');
});

test('detection: provenance paths, kinds, ordering and merged duplicates', () => {
  const { detections } = detectStack([file('tsconfig.json', '{}'), pkg({ vitest: '^1', react: '^18', typescript: '^5' }), file('package.json', undefined)]);
  const byId = Object.fromEntries(detections.map(detection => [detection.id, detection]));
  assert.deepEqual(detections.map(detection => detection.id), ['javascript', 'typescript', 'react', 'vitest']);
  assert.deepEqual(detections.map(detection => detection.kind), ['language', 'language', 'framework', 'tool']);
  assert.deepEqual(byId.typescript.provenance, ['package.json', 'tsconfig.json']);
  assert.deepEqual(byId.react.provenance, ['package.json']);
  assert.deepEqual(byId.javascript.provenance, ['package.json']);
  assert.ok(detections.every(detection => typeof detection.label === 'string' && detection.label));
});

test('detection: path-only signals and ignored folders', () => {
  const { detections } = detectStack([file('Dockerfile'), file('.github/workflows/ci.yml'), file('CLAUDE.md'), file('AGENTS.md'), file('GEMINI.md'), file('.cursor/rules/a.mdc'),
    file('.github/copilot-instructions.md'), file('src/App.csproj'), file('node_modules/left-pad/package.json', '{"dependencies":{"react":"1"}}'), file('vendor/x/go.mod')]);
  const ids = detections.map(detection => detection.id);
  for (const id of ['csharp', 'docker', 'github-actions', 'claude-md', 'agents-md', 'gemini-md', 'cursor-rules', 'copilot-instructions']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('react') && !ids.includes('go') && !ids.includes('javascript'));
  assert.deepEqual(detections.find(detection => detection.id === 'csharp').provenance, ['src/App.csproj']);
});

test('detection: unparseable manifests still count by path and never throw', () => {
  const { detections } = detectStack([file('package.json', '{not json'), file('pyproject.toml', 'dependencies = ["django>=4"]')]);
  assert.deepEqual(detections.map(detection => detection.id), ['javascript', 'python', 'django']);
});

test('wantsContent accepts only allow-listed manifest files at the folder root', () => {
  for (const path of ['package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml',
    'build.gradle', 'build.gradle.kts', 'composer.json']) assert.equal(wantsContent(path), true, path);
  for (const path of ['src/package.json', 'node_modules/x/package.json', '.env', 'README.md', 'secrets.json', '.git/config', 'package.json/evil', '../package.json', 'id_rsa'])
    assert.equal(wantsContent(path), false, path);
});

test('known stack entries are frozen, unique and carry a kind', () => {
  assert.ok(Object.isFrozen(KNOWN_STACK));
  assert.equal(new Set(KNOWN_STACK.map(entry => entry.id)).size, KNOWN_STACK.length);
  for (const entry of KNOWN_STACK) assert.ok(['language', 'framework', 'tool', 'ai-context'].includes(entry.kind) && entry.label);
});

test('a manually added stack entry is provenance "added by you" and drives suggestions', () => {
  const added = addDetection([], 'python');
  assert.deepEqual(added, [{ id: 'python', label: 'Python', kind: 'language', provenance: [ADDED_BY_YOU] }]);
  assert.deepEqual(addDetection(added, 'python'), added);
  assert.deepEqual(addDetection(added, 'not-a-known-id'), added);
  const result = suggestStarters({ goal: 'fix a bug', detections: added, clients: [], catalogItems: CATALOG });
  assert.ok(result.choices.some(choice => choice.ruleId === 'stack.context' && /added by you/.test(choice.why)));
});

test('rules never call the network or any model', t => {
  const calls = [];
  const spy = name => (...args) => { calls.push([name, args]); throw new Error(`${name} must not be called`); };
  const saved = new Map();
  const replace = (target, key, value) => { saved.set([target, key], { had: Object.hasOwn(target, key), value: target[key] }); target[key] = value; };
  replace(globalThis, 'fetch', spy('fetch'));
  replace(globalThis, 'XMLHttpRequest', spy('XMLHttpRequest'));
  replace(globalThis, 'WebSocket', spy('WebSocket'));
  replace(globalThis, 'EventSource', spy('EventSource'));
  if (globalThis.navigator && typeof globalThis.navigator.sendBeacon === 'function') replace(globalThis.navigator, 'sendBeacon', spy('sendBeacon'));
  t.after(() => { for (const [[target, key], { had, value }] of saved) { if (had) target[key] = value; else delete target[key]; } });
  const detections = detectStack(JS).detections;
  const result = suggestStarters({ goal: 'fix a bug', detections, clients: ['claude'], catalogItems: CATALOG });
  clientPrompt({ goal: 'fix a bug', detections, clients: ['claude'], choices: result.choices });
  const reason = choiceReason({ goal: 'fix a bug', detections, choice: result.choices[0], rulesVersion: result.rulesVersion });
  describePolicy({ roots: [{ itemId: result.choices[0].itemId, status: 'unresolved', reason }], pins: [], catalogItems: CATALOG });
  assert.deepEqual(calls, []);
});

test('choiceReason fits the saved reason bound and names the version, rule, goal and detections', () => {
  const goal = 'fix the checkout bug '.repeat(40);
  const detections = detectStack(JS).detections;
  const reason = choiceReason({ goal, detections, choice: { ruleId: 'goal.fix', itemId: 'mattpocock.diagnosing-bugs', why: 'x' }, rulesVersion: '1.0.0' });
  assert.ok(reason.length > 0 && reason.length <= 1000);
  assert.match(reason, /guided-setup rules 1\.0\.0/);
  assert.match(reason, /goal\.fix/);
  assert.match(reason, /fix the checkout bug/);
  assert.match(reason, /React/);
  assert.ok(!reason.includes(goal), 'the goal is truncated to 300 characters');
  const many = Array.from({ length: 400 }, (_, index) => ({ id: `x${index}`, label: `Stack ${index}`, kind: 'tool', provenance: [`dir/file-${index}.json`] }));
  assert.ok(choiceReason({ goal, detections: many, choice: { ruleId: 'stack.tests' }, rulesVersion: '1.0.0' }).length <= 1000);
  assert.match(choiceReason({ goal: 'fix a bug', detections: [], choice: { ruleId: 'goal.fix' }, rulesVersion: '1.0.0' }), /project not inspected/);
});

test('clientPrompt carries labels and provenance paths but never file contents', () => {
  const secret = 'SUPER-SECRET-TOKEN-1234';
  const files = [file('package.json', JSON.stringify({ devDependencies: { vitest: '1' }, scripts: { deploy: secret } }))];
  const detections = detectStack(files).detections;
  const { choices } = suggestStarters({ goal: 'fix a bug', detections, clients: ['claude'], catalogItems: CATALOG });
  const prompt = clientPrompt({ goal: 'fix a bug', detections, clients: ['claude'], choices });
  assert.match(prompt, /fix a bug/);
  assert.match(prompt, /Vitest/);
  assert.match(prompt, /package\.json/);
  assert.match(prompt, /claude/);
  assert.doesNotMatch(prompt, new RegExp(secret));
  assert.ok(typeof prompt === 'string' && prompt.length > 0);
});

test('describePolicy: chosen, included dependencies and unknown roots', () => {
  const roots = [
    { releaseSha256: 'a'.repeat(64), itemId: 'mattpocock.implement', scope: 'project', configuration: {}, status: 'resolved', reason: 'guided-setup rules 1.0.0: goal.build' },
    { releaseSha256: 'a'.repeat(64), itemId: 'author.mystery', scope: 'project', configuration: {}, status: 'unresolved', reason: 'kept as saved' },
  ];
  const pins = [{ releaseSha256: 'a'.repeat(64), itemId: 'mattpocock.implement' }, { releaseSha256: 'a'.repeat(64), itemId: 'mattpocock.code-review' }];
  const lines = describePolicy({ roots, pins, catalogItems: CATALOG });
  const of = kind => lines.filter(line => line.kind === kind);
  assert.equal(of('chosen').length, 2);
  assert.match(of('chosen')[0].text, /You chose implement/);
  assert.match(of('chosen')[0].text, /Saved reason: guided-setup rules 1\.0\.0: goal\.build/);
  assert.deepEqual(of('included').map(line => [line.itemId, line.text]), [['mattpocock.code-review', 'code review is included because implement needs it.']]);
  assert.deepEqual(of('unknown').map(line => [line.itemId, line.text]),
    [['author.mystery', 'Unknown: the exact source of author.mystery is not available here; your choice is kept exactly as saved.']]);
  assert.equal(lines.filter(line => line.itemId === 'author.mystery').length, 2, 'an unresolved root is never dropped');
});

test('a client adapter is explained in plain words and names the files its dependencies write', () => {
  const { choices } = suggestStarters({ goal: 'add tests', detections: [], clients: ['claude'], catalogItems: CATALOG });
  const adapter = choices.find(choice => choice.itemId === 'aihq.client.claude');
  assert.ok(adapter, JSON.stringify(choices.map(choice => choice.itemId)));
  assert.doesNotMatch(adapter.helpsWith, /adapter note|pointer\(s\)/);
  assert.match(adapter.helpsWith, /claude/);
  assert.ok(adapter.changes.some(line => line.includes('CLAUDE.md')), adapter.changes.join('|'));
  assert.ok(adapter.changes.some(line => line.includes('AGENTS.md')), adapter.changes.join('|'));
  assert.ok(adapter.changes.some(line => /^Files named in its description: /.test(line)), adapter.changes.join('|'));
  assert.ok(!adapter.changes.some(line => line.startsWith('Files it writes')), 'file names come from description text and are not promised as writes');
});

test('catalog facts stay separate from rule text: each choice carries the catalog description as its own field', () => {
  const { choices } = run(JS, 'fix the login bug', ['claude']);
  for (const choice of choices) {
    const catalogItem = CATALOG.find(entry => entry.id === choice.itemId);
    assert.equal(choice.catalogDescription, catalogItem.description, choice.itemId);
    assert.notEqual(choice.helpsWith, choice.catalogDescription);
  }
  const noDescription = CATALOG.map(entry => entry.id === 'mattpocock.diagnosing-bugs' ? { ...entry, description: undefined } : entry);
  const bare = run([], 'fix a bug', [], noDescription).choices.find(choice => choice.itemId === 'mattpocock.diagnosing-bugs');
  assert.equal(bare.catalogDescription, '');
  assert.ok(bare.helpsWith.length > 0);
});

test('provenanceText is exported and reads the same in suggestions and the prompt', () => {
  assert.equal(provenanceText({ provenance: [ADDED_BY_YOU] }), 'added by you');
  assert.equal(provenanceText({ provenance: ['a.json', 'b.json'] }), 'found in a.json, b.json');
});

test('RULE_TARGETS lists every fixed item id the rules can suggest, frozen, sorted and de-duplicated', () => {
  assert.ok(Object.isFrozen(RULE_TARGETS));
  assert.deepEqual([...RULE_TARGETS], [...new Set(RULE_TARGETS)].sort());
  assert.ok(RULE_TARGETS.every(id => !id.startsWith('aihq.client.')), 'client adapters are chosen by the person, not fixed by a rule');
  const suggested = new Set();
  for (const goal of ['fix a bug', 'write tests', 'build a feature', 'review a pull request', 'refactor', 'plan', 'learn', 'research', 'hmm'])
    for (const choice of run(JS, goal).choices) suggested.add(choice.itemId);
  assert.deepEqual([...suggested].sort(), [...RULE_TARGETS]);
});

test('describePolicy never describes an item by id alone: a different release is an unavailable source', () => {
  const otherRelease = 'c'.repeat(64);
  const sameId = CATALOG.map(entry => entry.id === 'mattpocock.tdd' ? { ...entry, description: 'Totally different thing.', root: { ...entry.root, releaseSha256: otherRelease } } : entry);
  const roots = [{ releaseSha256: 'a'.repeat(64), itemId: 'mattpocock.tdd', scope: 'project', configuration: {}, status: 'resolved', reason: 'guided-setup rules 1.0.0: goal.test' }];
  const lines = describePolicy({ roots, pins: [], catalogItems: sameId });
  assert.deepEqual(lines.map(line => [line.kind, line.itemId]), [['chosen', 'mattpocock.tdd'], ['unknown', 'mattpocock.tdd']]);
  assert.equal(lines[0].text, 'You chose mattpocock.tdd (its exact source is not available here). Saved reason: guided-setup rules 1.0.0: goal.test.');
  assert.doesNotMatch(lines.map(line => line.text).join('|'), /Totally different thing|tdd description/);
  const unresolved = describePolicy({ roots: [{ ...roots[0], status: 'unresolved' }], pins: [], catalogItems: CATALOG.filter(entry => entry.id === 'mattpocock.tdd') });
  assert.equal(unresolved[0].text, 'You chose mattpocock.tdd (its exact source is not available here). Saved reason: guided-setup rules 1.0.0: goal.test.');
  assert.ok(unresolved.some(line => line.kind === 'unknown'));
});

test('describePolicy: an included dependency pinned to another release falls back to its item id', () => {
  const roots = [{ releaseSha256: 'a'.repeat(64), itemId: 'mattpocock.implement', scope: 'project', configuration: {}, status: 'resolved', reason: 'r' }];
  const pins = [{ releaseSha256: 'd'.repeat(64), itemId: 'mattpocock.code-review' }];
  const included = describePolicy({ roots, pins, catalogItems: CATALOG }).filter(line => line.kind === 'included');
  assert.equal(included.length, 1);
  assert.equal(included[0].text, 'mattpocock.code-review is included as something your choices need.');
});

// tools/consumer/guided-setup.test.mjs saves this exact string through Core; it cannot import this module.
test('choiceReason gives exactly the reason the consumer test round-trips', () => {
  const detections = detectStack(JS).detections;
  assert.equal(choiceReason({ goal: 'add tests to my react app', detections, choice: { ruleId: 'goal.test' }, rulesVersion: GUIDED_RULES_VERSION }),
    'guided-setup rules 1.1.0: goal.test. Goal: add tests to my react app. Project: JavaScript, TypeScript, React, Vitest.');
});

// ---- Which adapter serves a client: Catalog's clientId, never the item id --------------------------------------------
const adaptersOnly = items => items.filter(other => other.kind !== 'client-adapter');
const clientChoice = (catalogItems, clients, extra = {}) =>
  suggestStarters({ goal: 'add tests', detections: [], clients, catalogItems, ...extra }).choices.find(choice => choice.ruleId.startsWith('client.'));

test('a client is served by the adapter whose clientId names it, even when the item id does not follow aihq.client.<x>', () => {
  const catalog = [...adaptersOnly(CATALOG), item('vendor.wire-claude', 'client-adapter', { clientId: 'claude' })];
  const choice = clientChoice(catalog, ['claude']);
  assert.equal(choice.itemId, 'vendor.wire-claude');
  assert.equal(choice.ruleId, 'client.claude');
});

test('an item named aihq.client.y with clientId z serves z and never y', () => {
  const catalog = [...adaptersOnly(CATALOG), item('aihq.client.y', 'client-adapter', { clientId: 'z' })];
  assert.equal(clientChoice(catalog, ['z']).itemId, 'aihq.client.y');
  assert.equal(clientChoice(catalog, ['y']), undefined);
});

test('an adapter from an earlier release format has no clientId, so no client is matched to it by its id', () => {
  const catalog = [...adaptersOnly(CATALOG), item('aihq.client.claude', 'client-adapter')];
  assert.equal(clientChoice(catalog, ['claude']), undefined);
});

test('a non-adapter item with a clientId or an aihq.client.* id never serves a client', () => {
  const catalog = [...adaptersOnly(CATALOG), item('aihq.client.claude', 'skill', { clientId: 'claude' })];
  assert.equal(clientChoice(catalog, ['claude']), undefined);
});

test('a client adapter choice states its target, Core support and installed state as three separate facts', () => {
  const claude = clientChoice(CATALOG, ['claude'], { coreClients: ['claude'] }).client;
  assert.deepEqual([claude.target.state, claude.target.clientId, claude.core.state, claude.installed.state], ['declared', 'claude', 'supported', 'not-checked']);
  const other = clientChoice([...adaptersOnly(CATALOG), item('vendor.other', 'client-adapter', { clientId: 'other' })], ['other'], { coreClients: ['claude'] }).client;
  assert.deepEqual([other.core.state, other.installed.state], ['not-supported', 'not-checked']);
  assert.equal(clientChoice(CATALOG, ['claude']).client.core.state, 'unknown', 'no Core list given');
});

test('an observation changes only the installed fact of a client choice', () => {
  const choice = clientChoice(CATALOG, ['claude'], { coreClients: ['codex'], observations: { claude: 'runnable' } });
  assert.deepEqual([choice.client.core.state, choice.client.installed.state], ['not-supported', 'found']);
  assert.equal(clientChoice(CATALOG, ['claude'], { coreClients: ['claude'], observations: { codex: 'runnable' } }).client.installed.state, 'not-checked');
});

test('a choice that is not an adapter carries no client facts', () => {
  const { choices } = suggestStarters({ goal: 'fix a bug', detections: [], clients: [], catalogItems: CATALOG });
  assert.ok(choices.length > 0 && choices.every(choice => choice.client === undefined));
});

test('observationsFrom keeps only string tool states by string id, from this one check', () => {
  assert.deepEqual(observationsFrom([{ id: 'claude', presence: 'runnable' }, { id: 'codex', presence: 'absent' }, { id: 7, presence: 'runnable' }, { id: 'zed', presence: 3 }, null]), { claude: 'runnable', codex: 'absent' });
  assert.deepEqual(observationsFrom(undefined), {});
  assert.deepEqual(Object.keys(observationsFrom([{ id: '__proto__', presence: 'runnable' }])), ['__proto__']);
});

const fresh = (extra = {}) => ({ setup: false, detected: false, broken: false, added: false, checked: false, unlisted: false, autoTicked: false, ...extra });

test('a re-check that no longer finds a client takes back "detected", the tick the check made and the stale found fact', () => {
  const first = reconcileClient(fresh(), 'runnable');
  assert.deepEqual([first.detected, first.broken, first.checked, first.autoTicked], [true, false, true, true]);
  const again = reconcileClient(first, 'absent');
  assert.deepEqual([again.detected, again.broken, again.checked, again.autoTicked, again.added], [false, false, false, false, false]);
});

test('a client the re-check did not report keeps no stale found', () => {
  const found = reconcileClient(fresh(), 'broken');
  assert.deepEqual([found.detected, found.broken], [true, true]);
  const unreported = reconcileClient(found, undefined);
  assert.deepEqual([unreported.detected, unreported.broken], [false, false]);
});

test('only a program Core found is detected; configuration alone or an unknown value is not', () => {
  for (const observation of ['config-only', 'present', 'weird']) assert.equal(reconcileClient(fresh(), observation).detected, false, observation);
  for (const observation of ['runnable', 'binary', 'broken']) assert.equal(reconcileClient(fresh(), observation).detected, true, observation);
});

test('a manual tick and a saved setup choice survive a re-check that finds nothing', () => {
  const ticked = reconcileClient(fresh({ checked: true }), 'absent');
  assert.deepEqual([ticked.checked, ticked.added, ticked.detected], [true, true, false]);
  const saved = reconcileClient(fresh({ setup: true, checked: true }), 'absent');
  assert.deepEqual([saved.checked, saved.added], [true, false]);
  const detectedAndSaved = reconcileClient(reconcileClient(fresh({ setup: true, checked: true }), 'runnable'), 'absent');
  assert.deepEqual([detectedAndSaved.checked, detectedAndSaved.autoTicked], [true, false], 'the check did not make this tick, so it stays');
});

test('a suggestion made after a re-check carries the new installed fact, not the old one', () => {
  const run = presence => clientChoice(CATALOG, ['claude'], { coreClients: ['claude'], observations: observationsFrom([{ id: 'claude', presence }]) }).client.installed.state;
  assert.deepEqual([run('runnable'), run('absent')], ['found', 'not-found']);
});

test('a guided choice shows Catalog\'s description as what the catalog says, its provider note included', () => {
  const note = 'Unverified provider: acquired from a shared configuration key.';
  const noted = CATALOG.map(entry => entry.id === 'mattpocock.tdd' ? { ...entry, kind: 'mcp-server', nameBasis: 'key', description: note } : entry);
  const result = suggestStarters({ goal: 'fix a bug', detections: [], catalogItems: noted });
  const tdd = result.choices.find(choice => choice.itemId === 'mattpocock.tdd');
  assert.ok(tdd, JSON.stringify(result));
  assert.equal(tdd.catalogDescription, note);
});

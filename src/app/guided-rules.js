/*
 * Guided setup rules: a fixed, deterministic mapping from a plain-language goal,
 * the recognised parts of a local project and the chosen AI clients to starter
 * choices that the served Catalog already offers.
 *
 * Pure module: no DOM, no network, no timers, no randomness. Folder contents are
 * read by the page only for `wantsContent` paths and never leave the page. Item
 * facts (labels, descriptions, dependencies, inputs) come from the catalog items
 * passed in; this module holds no Catalog content and no policy logic. A rule
 * whose item is absent from the served catalog is skipped, never substituted.
 *
 * A client is served by the adapter whose Catalog `clientId` names it (see client-identity.js);
 * an item id is never read as a client.
 */

import { adapterFor, describeClientIdentity, programWasFound } from './client-identity.js';
import { preferredCopy } from './source-copies.js';

// 1.1.0: the client rule matches adapters by Catalog clientId; an adapter without one is not suggested.
// 1.2.0: with a chosen Catalog tool name, a rule's item is replaced by the copy from the same declared source file that declares that tool, when one exists.
export const GUIDED_RULES_VERSION = '1.2.0';
export const ADDED_BY_YOU = 'added by you';

const MAX_GOAL = 300;
const MAX_REASON = 1000;
const MAX_FILE_BYTES = 256 * 1024;
export const MANIFEST_BYTE_LIMIT = MAX_FILE_BYTES;

const KIND_ORDER = Object.freeze(['language', 'framework', 'tool', 'ai-context']);
const entry = (id, label, kind) => Object.freeze({ id, label, kind });

/** Stack parts a person may add by hand when nothing was detected or the detection is wrong. */
export const KNOWN_STACK = Object.freeze([
  entry('javascript', 'JavaScript', 'language'), entry('typescript', 'TypeScript', 'language'), entry('python', 'Python', 'language'),
  entry('go', 'Go', 'language'), entry('rust', 'Rust', 'language'), entry('ruby', 'Ruby', 'language'), entry('java', 'Java', 'language'),
  entry('csharp', 'C#', 'language'), entry('php', 'PHP', 'language'),
  entry('react', 'React', 'framework'), entry('vue', 'Vue', 'framework'), entry('angular', 'Angular', 'framework'), entry('svelte', 'Svelte', 'framework'),
  entry('nextjs', 'Next.js', 'framework'), entry('express', 'Express', 'framework'), entry('django', 'Django', 'framework'), entry('flask', 'Flask', 'framework'),
  entry('fastapi', 'FastAPI', 'framework'), entry('rails', 'Ruby on Rails', 'framework'), entry('spring', 'Spring', 'framework'),
  entry('vitest', 'Vitest', 'tool'), entry('jest', 'Jest', 'tool'), entry('mocha', 'Mocha', 'tool'), entry('playwright', 'Playwright', 'tool'),
  entry('cypress', 'Cypress', 'tool'), entry('pytest', 'pytest', 'tool'), entry('rspec', 'RSpec', 'tool'), entry('docker', 'Docker', 'tool'),
  entry('github-actions', 'GitHub Actions', 'tool'),
  entry('claude-md', 'CLAUDE.md', 'ai-context'), entry('agents-md', 'AGENTS.md', 'ai-context'), entry('gemini-md', 'GEMINI.md', 'ai-context'),
  entry('cursor-rules', 'Cursor rules', 'ai-context'), entry('copilot-instructions', 'Copilot instructions', 'ai-context'),
]);
const KNOWN = new Map(KNOWN_STACK.map(item => [item.id, item]));
const TEST_TOOLS = Object.freeze(['cypress', 'jest', 'mocha', 'playwright', 'pytest', 'rspec', 'vitest']);

// Root manifests whose text may be read (each capped at MANIFEST_BYTE_LIMIT by the page), and the language each one implies.
const MANIFESTS = Object.freeze({
  'package.json': 'javascript', 'tsconfig.json': 'typescript', 'pyproject.toml': 'python', 'requirements.txt': 'python', Pipfile: 'python', 'setup.py': 'python',
  'go.mod': 'go', 'Cargo.toml': 'rust', Gemfile: 'ruby', 'pom.xml': 'java', 'build.gradle': 'java', 'build.gradle.kts': 'java', 'composer.json': 'php',
});
const IGNORED = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.venv']);

// package.json dependency names that identify a stack part.
const PACKAGE_SIGNALS = Object.freeze({
  react: 'react', vue: 'vue', '@angular/core': 'angular', svelte: 'svelte', next: 'nextjs', express: 'express', vitest: 'vitest', jest: 'jest',
  mocha: 'mocha', playwright: 'playwright', '@playwright/test': 'playwright', cypress: 'cypress', typescript: 'typescript',
});
// Whole-name terms found in the text of the other manifests.
const TEXT_SIGNALS = Object.freeze({
  'pyproject.toml': ['django', 'flask', 'fastapi', 'pytest'], 'requirements.txt': ['django', 'flask', 'fastapi', 'pytest'],
  Pipfile: ['django', 'flask', 'fastapi', 'pytest'], 'setup.py': ['django', 'flask', 'fastapi', 'pytest'],
  Gemfile: ['rails', 'rspec'], 'pom.xml': ['spring'], 'build.gradle': ['spring'], 'build.gradle.kts': ['spring'],
});
// Test configuration files at the folder root.
const CONFIG_FILES = Object.freeze([[/^vitest\.config\.[cm]?[jt]s$/, 'vitest'], [/^jest\.config\.[cm]?[jt]s$/, 'jest'],
  [/^playwright\.config\.[cm]?[jt]s$/, 'playwright'], [/^cypress\.config\.[cm]?[jt]s$/, 'cypress'], [/^pytest\.ini$/, 'pytest']]);

const normalize = path => String(path ?? '').replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const wordIn = (text, term) => new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_])`).test(text);

/** True only for the allow-listed manifest files at the root of the chosen folder. */
export function wantsContent(path) {
  const value = normalize(path);
  return Object.hasOwn(MANIFESTS, value);
}

/** Adds one stack part by hand with provenance "added by you"; unknown ids and duplicates leave the list unchanged. */
export function addDetection(detections, id) {
  const known = KNOWN.get(id);
  if (!known || detections.some(detection => detection.id === id)) return [...detections];
  return sortDetections([...detections, { ...known, provenance: [ADDED_BY_YOU] }]);
}

const sortDetections = list => [...list].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compare(a.id, b.id));

/** files: [{ path, text? }] relative to the chosen folder. Returns what was recognised and the paths it was recognised from. */
export function detectStack(files) {
  const found = new Map();
  const note = (id, path) => {
    const known = KNOWN.get(id);
    if (!known) return;
    const current = found.get(id) ?? { ...known, provenance: [] };
    if (!current.provenance.includes(path)) current.provenance.push(path);
    found.set(id, current);
  };
  for (const file of files ?? []) {
    const path = normalize(file?.path);
    if (!path) continue;
    const segments = path.split('/'), name = segments.at(-1);
    if (segments.slice(0, -1).some(segment => IGNORED.has(segment))) continue;
    const root = segments.length === 1;
    if (root && Object.hasOwn(MANIFESTS, name)) {
      note(MANIFESTS[name], path);
      const text = typeof file.text === 'string' ? file.text : undefined;
      if (name === 'package.json' && text !== undefined) {
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
          for (const dependency of Object.keys(parsed?.[field] && typeof parsed[field] === 'object' ? parsed[field] : {}))
            if (Object.hasOwn(PACKAGE_SIGNALS, dependency)) note(PACKAGE_SIGNALS[dependency], path);
      } else if (text !== undefined && TEXT_SIGNALS[name]) {
        const lower = text.toLowerCase();
        for (const term of TEXT_SIGNALS[name]) if (wordIn(lower, term)) note(term, path);
      }
    }
    if (root) for (const [pattern, id] of CONFIG_FILES) if (pattern.test(name)) note(id, path);
    if (name.endsWith('.csproj')) note('csharp', path);
    if (name === 'Dockerfile') note('docker', path);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) note('github-actions', path);
    if (path === 'CLAUDE.md') note('claude-md', path);
    if (path === 'AGENTS.md') note('agents-md', path);
    if (path === 'GEMINI.md') note('gemini-md', path);
    if (path.startsWith('.cursor/rules/')) note('cursor-rules', path);
    if (path === '.github/copilot-instructions.md') note('copilot-instructions', path);
  }
  return { detections: sortDetections([...found.values()].map(detection => ({ ...detection, provenance: [...detection.provenance].sort(compare) }))) };
}

// The rule table. Goal rules match whole words or phrases in the lower-cased goal. Order is fixed: client rules, goal rules,
// stack rules, then fill rules. `item` is a maintained Catalog item id; `helpsWith` is shown to the person.
const goalRule = (id, phrases, item, helpsWith) => Object.freeze({ id, phrases: Object.freeze(phrases), item, helpsWith });
const GOAL_RULES = Object.freeze([
  goalRule('goal.fix', ['bug', 'bugs', 'fix', 'fixes', 'fixed', 'fixing', 'broken', 'crash', 'crashes', 'crashing', 'error', 'errors', 'failing', 'debug', 'debugging', 'slow'],
    'mattpocock.diagnosing-bugs', 'Finding the cause of bugs, crashes, errors and slowdowns step by step before changing code.'),
  goalRule('goal.test', ['test', 'tests', 'testing', 'tdd'], 'mattpocock.tdd', 'Writing a failing test first, then the code that makes it pass.'),
  goalRule('goal.build', ['build', 'builds', 'building', 'add', 'implement', 'implementing', 'feature', 'features', 'create', 'make', 'app'],
    'mattpocock.implement', 'Turning a plan or ticket into working code in small, checked steps.'),
  goalRule('goal.review', ['review', 'reviews', 'reviewing', 'pull request', 'pull requests', 'pr', 'quality'],
    'mattpocock.code-review', 'Reviewing changes against your project’s standards and what the change was meant to do.'),
  goalRule('goal.refactor', ['refactor', 'refactoring', 'architecture', 'clean up', 'cleanup', 'restructure'],
    'mattpocock.improve-codebase-architecture', 'Finding places where the code can be restructured to be simpler and easier to change.'),
  goalRule('goal.plan', ['plan', 'planning', 'design', 'idea', 'spec'], 'mattpocock.grill-me', 'Questioning a plan or idea until its gaps are found, before any code is written.'),
  goalRule('goal.learn', ['learn', 'learning', 'understand', 'explain', 'new to'], 'mattpocock.teach', 'Explaining the code and concepts you are working with at your own pace.'),
  goalRule('goal.research', ['research', 'compare', 'docs', 'documentation'], 'mattpocock.research', 'Investigating a question against trustworthy sources and writing down what was found.'),
]);
const STACK_TESTS = Object.freeze({ id: 'stack.tests', item: 'mattpocock.tdd', helpsWith: 'Writing a failing test first, then the code that makes it pass, using the test tool your project already has.' });
const STACK_CONTEXT = Object.freeze({ id: 'stack.context', item: 'aihq.project-context', helpsWith: 'Giving every AI client the same plain description of your project so each one starts with the same context.' });
const FILL_RULES = Object.freeze([
  Object.freeze({ id: 'fill.review', item: 'mattpocock.code-review', helpsWith: GOAL_RULES[3].helpsWith }),
  Object.freeze({ id: 'fill.tdd', item: 'mattpocock.tdd', helpsWith: GOAL_RULES[1].helpsWith }),
  Object.freeze({ id: 'fill.diagnose', item: 'mattpocock.diagnosing-bugs', helpsWith: GOAL_RULES[0].helpsWith }),
]);
const MIN_CHOICES = 3, MAX_CHOICES = 5;
/** Every fixed item id the goal, stack and fill rules can suggest (client adapters are chosen by the person and excluded). */
export const RULE_TARGETS = Object.freeze([...new Set([...GOAL_RULES.map(rule => rule.item), STACK_TESTS.item, STACK_CONTEXT.item, ...FILL_RULES.map(rule => rule.item)])].sort());

const goalWords = goal => String(goal ?? '').toLowerCase().slice(0, MAX_GOAL);
function firstPhrase(text, phrases) {
  let best;
  for (const phrase of phrases) {
    const match = new RegExp(`(?<![a-z0-9])${phrase.replaceAll(/\s+/g, '\\s+')}(?![a-z0-9])`).exec(text);
    if (match && (!best || match.index < best.index)) best = { index: match.index, text: match[0] };
  }
  return best?.text;
}
const clientId = client => typeof client === 'string' ? client : client?.id;
const clientIds = clients => [...new Set((clients ?? []).map(clientId).filter(id => typeof id === 'string' && id))].sort(compare);
export const provenanceText = detection => detection.provenance.includes(ADDED_BY_YOU) ? 'added by you' : `found in ${detection.provenance.join(', ')}`;
const scopePhrase = scope => scope === 'user' ? 'for your user account' : 'in this project';

function requiredClosure(itemId, byId) {
  const seen = new Set([itemId]), order = [];
  const visit = id => {
    for (const dependency of byId.get(id)?.dependencies?.requires ?? []) {
      if (typeof dependency?.itemId !== 'string' || seen.has(dependency.itemId)) continue;
      seen.add(dependency.itemId); order.push(dependency.itemId); visit(dependency.itemId);
    }
  };
  visit(itemId);
  return order;
}
const labelOf = (id, byId) => byId.get(id)?.label || id;
const sentence = value => /[.!?]$/.test(value) ? value : `${value}.`;
const inline = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const showValue = value => typeof value === 'string' ? value : JSON.stringify(value);

function needsFor(item, byId) {
  const lines = requiredClosure(item.id, byId).map(id => `${labelOf(id, byId)} (included automatically because this choice needs it)`);
  // Catalog publishes inputs as an object keyed by input name.
  for (const [key, input] of Object.entries(item.inputs ?? {})) {
    if (input?.required === false) continue;
    const name = inline(input?.description ?? key);
    if (name) lines.push(input.default === undefined ? name : `${name} (default ${showValue(input.default)})`);
  }
  return lines;
}
function changesFor(item, scope, byId) {
  const where = scopePhrase(scope);
  if (item.kind === 'skill') return [`Adds the ${item.label || item.id} skill ${where === 'in this project' ? 'to your project' : 'to your user account'} for your AI client to use when relevant; it runs nothing by itself.`];
  // Context wiring writes its files through its required items, so their catalog descriptions say what changes.
  const descriptions = [item, ...requiredClosure(item.id, byId).map(id => byId.get(id)).filter(other => other && other.kind !== 'skill')]
    .map(other => inline(other.description)).filter(Boolean);
  const files = [...new Set(descriptions.flatMap(description => description.match(/(?:\.[\w-]+\/)*[\w.-]+\.(?:md|mdc|json|toml|ya?ml|txt)\b|\.[\w-]+rules\b/g) ?? []))];
  const lines = descriptions.length ? descriptions.map(sentence) : [`Adds ${item.label || item.id} (${item.kind}).`];
  if (files.length) lines.push(`Files named in its description: ${files.join(', ')}.`);
  lines.push(`Applies ${where}.`);
  return lines;
}

/**
 * goal: free text. detections: from detectStack, possibly edited. clients: ids (or { id }). catalogItems: the served items.
 * projectInspected (optional): true when a project folder was inspected; defaults to "some detection came from a file".
 * catalogTool (optional): the Catalog tool name the person chose (claude-code, ...); a rule then names the copy from the same declared
 * source file that declares it, when one exists (source-copies.js). It is never derived from `clients`.
 * coreClients (optional): Core's nativeClientIds; observations (optional): client id -> readiness presence. They only fill the facts a client choice
 * carries (`choice.client`: target, Core support, installed) and never decide which choices are made.
 * An inspected project whose language was not recognised (and not added by hand) is never confident, even when the goal matched.
 */
export function suggestStarters({ goal, detections = [], clients = [], catalogItems = [], projectInspected, coreClients, observations, catalogTool } = {}) {
  const byId = new Map((catalogItems ?? []).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const text = goalWords(goal);
  const inspected = projectInspected ?? detections.some(detection => detection.provenance.some(path => path !== ADDED_BY_YOU));
  const candidates = [];
  for (const id of clientIds(clients)) {
    const adapter = adapterFor(catalogItems, id);
    if (adapter) candidates.push({ ruleId: `client.${id}`, itemId: adapter.id, adapter, helpsWith: `Lets ${id} read the same shared project instructions as your other AI clients, so it starts every task with the same context.`, why: `You use ${id} as an AI client.` });
  }
  let goalMatched = false;
  for (const rule of GOAL_RULES) {
    const phrase = firstPhrase(text, rule.phrases);
    if (phrase === undefined) continue;
    goalMatched = true;
    candidates.push({ ruleId: rule.id, itemId: rule.item, helpsWith: rule.helpsWith, why: `Your goal mentions “${phrase}”.` });
  }
  const testTool = detections.filter(detection => TEST_TOOLS.includes(detection.id)).sort((a, b) => compare(a.id, b.id))[0];
  if (testTool) candidates.push({ ruleId: STACK_TESTS.id, itemId: STACK_TESTS.item, helpsWith: STACK_TESTS.helpsWith,
    why: `Your project uses ${testTool.label} (${provenanceText(testTool)}).` });
  const language = detections.find(detection => detection.kind === 'language');
  if (language) candidates.push({ ruleId: STACK_CONTEXT.id, itemId: STACK_CONTEXT.item, helpsWith: STACK_CONTEXT.helpsWith,
    why: `Your project uses ${language.label} (${provenanceText(language)}).` });
  const unrecognised = inspected && !language;
  const evidence = !unrecognised && (goalMatched || Boolean(language));
  if (evidence) for (const rule of FILL_RULES)
    candidates.push({ ruleId: rule.id, itemId: rule.item, helpsWith: rule.helpsWith, fill: true,
      why: 'A common starter that goes with most goals and projects; your goal or project was recognised, but only a few choices matched it directly.' });

  const choices = [], taken = new Set(), covered = new Set();
  for (const candidate of candidates) {
    if (choices.length >= MAX_CHOICES) break;
    if (candidate.fill && choices.length >= MIN_CHOICES) continue;
    const item = candidate.adapter ? byId.get(candidate.itemId) : preferredCopy(byId.get(candidate.itemId), catalogItems, catalogTool);
    if (!item || taken.has(item.id) || covered.has(item.id)) continue;
    const scopes = Array.isArray(item.scopes) && item.scopes.length ? item.scopes : ['project'];
    const scope = scopes.includes('project') && (inspected || scopes.length === 1) ? 'project' : scopes.find(value => value !== 'project') ?? scopes[0];
    const closure = requiredClosure(item.id, byId);
    taken.add(item.id); for (const id of closure) covered.add(id);
    choices.push({ itemId: item.id, label: item.label || item.id, scope, ruleId: candidate.ruleId, why: candidate.why,
      helpsWith: inline(candidate.helpsWith) || `Adds ${item.label || item.id}.`, catalogDescription: inline(item.description), needs: needsFor(item, byId), changes: changesFor(item, scope, byId),
      dependencies: closure.map(id => ({ itemId: id, label: labelOf(id, byId) })),
      ...(candidate.adapter ? { client: describeClientIdentity({ item: candidate.adapter, coreClients, observation: observations?.[candidate.ruleId.slice('client.'.length)] }) } : {}) });
  }
  // A choice added earlier may turn out to be required by a later one; that is fine, both are kept as roots.
  if (unrecognised) return { rulesVersion: GUIDED_RULES_VERSION, status: 'no-confident-suggestion', choices: [],
    message: 'Your project’s languages were not recognised, so nothing is preselected. Add what your project uses, or browse the catalog yourself.' };
  if (!evidence || choices.length < MIN_CHOICES) return { rulesVersion: GUIDED_RULES_VERSION, status: 'no-confident-suggestion', choices: [],
    message: 'We could not match your goal or project to a starter set with confidence. Nothing is preselected. Try describing what you want to do in other words, add what your project uses, or browse the catalog yourself.' };
  return { rulesVersion: GUIDED_RULES_VERSION, status: 'confident', choices,
    message: `We matched ${choices.length} starter choices to your goal and project. Review each one; nothing is installed by saving.` };
}

/** One readiness check's tool states as client id -> state, keeping only strings. Whatever the check did not report is absent. */
export function observationsFrom(tools) {
  return Object.fromEntries((Array.isArray(tools) ? tools : []).filter(tool => typeof tool?.id === 'string' && typeof tool.presence === 'string')
    .map(tool => [tool.id, tool.presence]));
}

/**
 * A client's page state after a check. Whether it is detected comes only from that check: a client the check
 * reports absent, or does not report, is no longer detected, and a tick the check itself made goes with it.
 * A tick the person made, or a saved setup choice, stays.
 */
export function reconcileClient(state, observation) {
  const found = programWasFound(observation);
  const next = { ...state, detected: found, broken: found && observation === 'broken' };
  if (found) return { ...next, autoTicked: state.autoTicked || !state.checked, checked: true, added: false };
  const checked = state.autoTicked ? false : state.checked;
  return { ...next, autoTicked: false, checked, added: checked && !state.setup };
}

const detectionLine = detection => `${detection.label} (${detection.kind}, ${provenanceText(detection)})`;

/** Text for the person to hand to their AI client. Labels and file names only; never file contents. */
export function clientPrompt({ goal, detections = [], clients = [], choices = [] } = {}) {
  const ids = clientIds(clients);
  const lines = [
    'I am choosing starter setup for my AI tools. Please help me understand and review these choices. Do not install, change or run anything until I confirm.',
    '',
    `My goal: ${inline(goal).slice(0, MAX_GOAL) || '(not given)'}`,
    `AI clients I use: ${ids.length ? ids.join(', ') : '(none chosen)'}`,
    'What was recognised in my project (names and the files they were found in; no file contents):',
    ...(detections.length ? detections.map(detection => `- ${detectionLine(detection)}`) : ['- nothing was recognised, or no project folder was shared']),
    'Starter choices suggested:',
    ...(choices.length ? choices.flatMap(choice => [`- ${choice.label}: ${choice.helpsWith}`, `  Why suggested: ${choice.why}`]) : ['- none yet']),
    '',
    'Please tell me, in plain language, what each choice would do, anything that does not fit my goal, and what I should ask next.',
  ];
  return lines.join('\n');
}

/** The saved reason for one chosen root: names the rules version and rule so a later reader can see why it was suggested. */
export function choiceReason({ goal, detections = [], choice, rulesVersion = GUIDED_RULES_VERSION } = {}) {
  const head = `guided-setup rules ${rulesVersion}: ${choice?.ruleId ?? 'unknown rule'}.`;
  const goalText = inline(goal).slice(0, MAX_GOAL) || 'no goal given';
  const labels = detections.map(detection => detection.label);
  const build = shown => {
    const rest = labels.length - shown;
    const stack = shown ? `${labels.slice(0, shown).join(', ')}${rest > 0 ? ` and ${rest} more` : ''}` : 'project not inspected';
    return `${head} Goal: ${goalText}. Project: ${stack}.`;
  };
  let shown = labels.length;
  while (shown > 0 && build(shown).length > MAX_REASON) shown -= 1;
  const reason = labels.length && shown === 0 ? `${head} Goal: ${goalText}. Project: ${labels.length} detections.` : build(shown);
  return reason.slice(0, MAX_REASON);
}

/**
 * roots: the open draft's roots ({ releaseSha256, itemId, status, reason, ... }); pins: the intent's pins; catalogItems: served items.
 * An item is described only when a served item matches both the exact release and the item id; otherwise the line names the item id
 * and says its exact source is not available here. One line per chosen item, per included dependency, and per unavailable root.
 */
export function describePolicy({ roots = [], pins = [], catalogItems = [] } = {}) {
  const key = (releaseSha256, itemId) => `${releaseSha256}
${itemId}`;
  const exact = new Map();
  for (const item of catalogItems ?? []) if (item && typeof item.id === 'string' && typeof item.root?.releaseSha256 === 'string') exact.set(key(item.root.releaseSha256, item.id), item);
  const within = releaseSha256 => ({ get: id => exact.get(key(releaseSha256, id)) });
  const lines = [];
  const matched = [];
  for (const root of roots) {
    const item = root.status === 'unresolved' ? undefined : exact.get(key(root.releaseSha256, root.itemId));
    const saved = inline(root.reason);
    const savedText = saved ? `Saved reason: ${sentence(saved)}` : 'No reason was saved.';
    if (item) {
      const helps = inline(item.description).replace(/[.!?]+$/, '') || 'no description is available here';
      lines.push({ kind: 'chosen', itemId: root.itemId, text: `You chose ${item.label || item.id} — ${helps}. ${savedText}` });
      matched.push(root);
      continue;
    }
    lines.push({ kind: 'chosen', itemId: root.itemId, text: `You chose ${root.itemId} (its exact source is not available here). ${savedText}` });
    lines.push({ kind: 'unknown', itemId: root.itemId,
      text: `Unknown: the exact source of ${root.itemId} is not available here; your choice is kept exactly as saved.` });
  }
  const isRoot = new Set(roots.map(root => key(root.releaseSha256, root.itemId)));
  const pinned = new Map();
  for (const pin of pins ?? []) {
    if (typeof pin?.itemId !== 'string') continue;
    const id = key(pin.releaseSha256, pin.itemId);
    if (!isRoot.has(id) && !pinned.has(id)) pinned.set(id, pin);
  }
  const ordered = [...pinned.values()].sort((a, b) => compare(a.itemId, b.itemId) || compare(String(a.releaseSha256), String(b.releaseSha256)));
  for (const pin of ordered) {
    const item = exact.get(key(pin.releaseSha256, pin.itemId));
    const label = item ? item.label || item.id : pin.itemId;
    const needing = item ? matched.filter(root => root.releaseSha256 === pin.releaseSha256 && requiredClosure(root.itemId, within(root.releaseSha256)).includes(pin.itemId)) : [];
    const names = [...new Set(needing.map(root => exact.get(key(root.releaseSha256, root.itemId)).label || root.itemId))];
    lines.push({ kind: 'included', itemId: pin.itemId, text: names.length
      ? `${label} is included because ${names.join(' and ')} ${names.length > 1 ? 'need' : 'needs'} it.`
      : `${label} is included as something your choices need.` });
  }
  return lines;
}

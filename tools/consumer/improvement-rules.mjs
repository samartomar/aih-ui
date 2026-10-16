// Improvement rules: a fixed, versioned table that explains why one Catalog item might help this policy. Pure and
// deterministic: it reads the open draft's saved intent, the Catalog items it is handed, the inventories the policy was saved
// from and newer candidate revisions of them, the person's declared AI clients with their published labels and an optional request goal. It calls no model, reads no network or file and keeps no clock; the same
// inputs always give the same suggestions. Rule text is not part of a suggestion's identity (see improvement-record.mjs).
import { suggestionId, suggestionRevision, sameContent } from './improvement-record.mjs';
import { adapterFor, describeClientIdentity } from './client-identity.mjs';
// 1.1.0: the client rule names a client by its published label when one is supplied (wording only; identity is unchanged).
// 1.2.0: a goal-relevant item new or revised in a newer revision of a saved source is suggested from that revision; recurring friction is named as unchecked.
// 1.3.0: the client rule matches adapters by Catalog clientId; an adapter without one is not suggested.
export const IMPROVEMENT_RULES_VERSION = '1.3.0';
export const MAX_GOAL = 300, MAX_ALTERNATIVES = 3, MAX_TRACKED_NEEDS = 256;
// Independent of the guided-setup rules on purpose: each rule set is versioned alone, so changing one never changes
// the saved reasons the other wrote.
export const GOAL_RULES = [
  { id: 'goal.fix', itemId: 'mattpocock.diagnosing-bugs', phrases: ['bug', 'bugs', 'fix', 'broken', 'crash', 'crashes', 'error', 'errors', 'failing', 'debug', 'debugging', 'slow'] },
  { id: 'goal.test', itemId: 'mattpocock.tdd', phrases: ['test', 'tests', 'testing', 'tdd'] },
  { id: 'goal.regressions', itemId: 'mattpocock.tdd', phrases: ['regression', 'regressions', 'reliable', 'reliability', 'flaky'] },
  { id: 'goal.review', itemId: 'mattpocock.code-review', phrases: ['review', 'reviews', 'reviewing', 'pull request', 'pull requests', 'quality'] },
  { id: 'goal.refactor', itemId: 'mattpocock.improve-codebase-architecture', phrases: ['refactor', 'refactoring', 'architecture', 'clean up', 'cleanup', 'restructure'] },
  { id: 'goal.plan', itemId: 'mattpocock.grill-me', phrases: ['plan', 'planning', 'design', 'spec'] },
  { id: 'goal.context', itemId: 'aihq.project-context', phrases: ['context', 'instructions', 'consistent', 'onboarding'] }
];
// The adapter for a client is the Catalog item whose clientId names it (see client-identity.mjs), never one matched by its id.
export const CLIENT_RULE = { id: 'client.instructions' };
// Readiness checks describe machine setup and name Readiness and Core repair as the remedy; nothing published ties recurring work friction to a Catalog item.
export const FRICTION_UNKNOWN = 'Recurring friction is not checked: no published evidence interface reports recurring friction in your work (readiness checks cover machine setup only).';
export const UNKNOWNS = ['Whether it improves your results is unknown until you try it.', 'Actual usage and cost are unknown; no usage data is read.', FRICTION_UNKNOWN];
// The reason format guided setup writes on each chosen root.
const SAVED_GOAL = /^guided-setup rules \d+\.\d+\.\d+: [a-z][a-z0-9.-]*\. Goal: (.+?)\. Project: /;
const inline = value => String(value ?? '').replaceAll(/\s+/g, ' ').trim().slice(0, MAX_GOAL);
// Whole word or phrase, first by position, like the guided-setup matcher.
function firstPhrase(source, phrases) {
  let best;
  for (const phrase of phrases) {
    const match = new RegExp(`(?<![a-z0-9])${phrase.replaceAll(/\s+/g, '\\s+')}(?![a-z0-9])`).exec(source);
    if (match && (!best || match.index < best.index)) best = match[0];
  }
  return best;
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Semantic-version precedence (build metadata ignored), or undefined when either side is absent or not a version.
const NUMBER = '0|[1-9]\\d*', PART = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(`^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${PART}(?:\\.${PART})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
function precedence(a, b) {
  const [x, y] = [SEMVER.exec(a ?? ''), SEMVER.exec(b ?? '')];
  if (!x || !y) return undefined;
  for (const i of [1, 2, 3]) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (!x[4] || !y[4]) return (x[4] ? -1 : 0) + (y[4] ? 1 : 0);
  const [p, q] = [x[4].split('.'), y[4].split('.')];
  for (let i = 0; i < Math.min(p.length, q.length); i += 1) {
    if (p[i] === q[i]) continue;
    const [m, n] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    return m && n ? Number(p[i]) - Number(q[i]) : m ? -1 : n ? 1 : compare(p[i], q[i]);
  }
  return p.length - q.length;
}
// Fact text is shown and recorded; long Catalog labels are cut so the record limit can never refuse a dismissal.
const clip = text => text.length <= 1000 ? text : `${text.slice(0, 999)}…`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const digestsOf = item => ({ recipeSha256: item.recipe.sha256, materials: [...new Set((item.materials ?? []).map(m => m.sha256))].sort() });
const bytesOf = item => (item.recipe?.byteLength ?? 0) + (item.materials ?? []).reduce((sum, m) => sum + m.byteLength, 0);
// The item's required items, transitively, that this policy does not already select.
function needs(item, offered, selected) {
  const found = new Map(), missing = new Set(), queue = [item];
  while (queue.length) {
    for (const dependency of queue.shift().dependencies?.requires ?? []) {
      const id = dependency.itemId;
      if (id === item.id || found.has(id) || missing.has(id) || selected.has(id)) continue;
      if (offered.has(id)) { found.set(id, offered.get(id)); queue.push(offered.get(id)); } else missing.add(id);
    }
  }
  return { found: [...found.values()].sort((a, b) => compare(a.id, b.id)), missing: [...missing].sort(compare) };
}
// Observed presence is not an input here: nothing this check reads observes a client, so installed is always "not checked".
const clientFacts = (item, coreClients) => { const client = describeClientIdentity({ item, coreClients }); return client ? { client } : {}; };
function facts(item, scope, offered, selected) {
  const { found, missing } = needs(item, offered, selected), all = [item, ...found];
  const labels = found.map(i => i.label ?? i.id), shown = labels.slice(0, 8).join(', ') + (labels.length > 8 ? ` and ${labels.length - 8} more` : '');
  const result = [{ kind: 'overhead', text: clip(`Adds ${plural(all.reduce((n, i) => n + 1 + (i.materials ?? []).length, 0), 'file')}, ${all.reduce((n, i) => n + bytesOf(i), 0)} bytes in total, and needs ${plural(found.length, 'other item')}${found.length ? `: ${shown}` : ''}.`) },
    { kind: 'scope', text: scope === 'project' ? 'Applies in this project only; other repositories and AI clients are unchanged.'
      : 'Applies to your user account on this computer; every project of that account is affected.' }];
  for (const id of missing.slice(0, 4)) result.push({ kind: 'dependency', text: `Needs ${id}, which the supplied Catalog does not offer.` });
  for (const conflict of (item.dependencies?.conflicts ?? []).map(c => c?.itemId ?? c).filter(id => selected.has(id)).slice(0, 4))
    result.push({ kind: 'dependency', text: `Conflicts with ${conflict}, which this policy already selects.` });
  return result;
}
// A candidate release revises a saved one when it is the same package from the same input with a strictly later version: an
// older, equal or unversioned release is never called newer, so its novelty stays unknown. The saved policy's own record of the
// input wins over the supplied one; no input on either side is the same source.
function revises(intent, saved, candidate) {
  const name = saved.release.package?.name;
  if (name === undefined || candidate.release.package?.name !== name || candidate.release.sha256 === saved.release.sha256) return false;
  if (!(precedence(candidate.release.package.version, saved.release.package.version) > 0)) return false;
  const input = intent.inputs.find(i => i.releaseSha256 === saved.release.sha256) ?? saved.input;
  return input ? candidate.input?.kind === input.kind && sameContent(candidate.input?.locator, input.locator) : !candidate.input;
}
// Labels, descriptions and item digests alone are not material: the recipe and the sorted material digests are, the item's own
// and those of every item it requires (resolved where each revision offers it), as a dismissal's content is.
const closureOf = (item, known) => needs(item, known, new Set()).found.map(needed => ({ itemId: needed.id, ...digestsOf(needed) }));
function difference(before, beforeKnown, item, known) {
  if (!sameContent(digestsOf(before), digestsOf(item))) return 'own';
  return sameContent(closureOf(before, beforeKnown), closureOf(item, known)) ? undefined : 'needed';
}
// Items that candidate releases add or change against the saved releases they revise, by item id, newest candidate first. An item is new
// when none of those saved releases has it and revised when each one that has it differs; a candidate that revises none says nothing.
// `known` is what the item's requirements resolve against: its own release first, then the supplied items.
function changedItems(intent, inventories, candidates, offered) {
  const saved = [...new Set([...intent.roots, ...intent.pins, ...intent.provenance].map(entry => entry.releaseSha256))].sort(compare)
    .flatMap(sha => inventories.filter(entry => entry.release.sha256 === sha).slice(0, 1));
  const changed = new Map();
  // Only versioned candidates can revise a saved source; dropping the rest first keeps the order total.
  const newest = candidates.filter(entry => SEMVER.test(entry.release.package?.version ?? ''))
    .sort((a, b) => precedence(b.release.package.version, a.release.package.version) || compare(a.release.sha256, b.release.sha256));
  for (const candidate of newest) {
    const { release } = candidate, sources = saved.filter(entry => revises(intent, entry, candidate));
    if (!sources.length) continue;
    const own = release.items.map(item => ({ ...item, root: { releaseSha256: release.sha256 } })), known = new Map([...offered, ...own.map(item => [item.id, item])]);
    for (const item of own) {
      if (changed.has(item.id)) continue;
      const prior = sources.flatMap(entry => entry.release.items.filter(i => i.id === item.id).slice(0, 1).map(before =>
        difference(before, new Map([...offered, ...entry.release.items.map(i => [i.id, i])]), item, known)));
      const kind = !prior.length ? 'new' : prior.every(Boolean) ? 'revised' : undefined;
      if (kind) changed.set(item.id, { kind, item, release, known, needed: prior.length > 0 && prior.every(part => part === 'needed') });
    }
  }
  return changed;
}
// Suggestions for an open draft, ranked: a request first, then more reasons, then a saved goal before a client-only
// reason, then item id. `items` are plain Catalog items in the order the inventories were supplied, each with
// root.releaseSha256; the first offering an id is the one suggested, unless a newer revision of a saved source (`candidates`,
// compared with the `inventories` the policy was saved from) adds or changes it in a way a saved goal makes relevant. Nothing absent
// from them is ever suggested except such an item. `labels` maps a client id to the label Harness publishes for it; a client
// without one is named by its id. `coreClients` (optional) is Core's nativeClientIds; it only fills the `client` facts of an adapter
// suggestion (target, Core support, installed) and never decides whether one is made.
export async function suggestImprovements({ intent, items = [], inventories = [], candidates: revisions = [], clients = [], labels = {}, goal, coreClients } = {}) {
  const selected = new Set([...intent.roots, ...intent.pins].map(entry => entry.itemId)), excluded = new Set(intent.exclusions.map(entry => entry.itemId));
  const offered = new Map();
  for (const item of items) if (!offered.has(item.id)) offered.set(item.id, item);
  const candidates = new Map();
  // `from` is a changed candidate item; the suggestion then describes that item, the content its reason talks about.
  const add = (itemId, key, ruleId, textOf, reference, goalText, from) => {
    const item = from?.item ?? offered.get(itemId);
    if (!item || selected.has(itemId) || excluded.has(itemId) || !item.scopes?.length) return;
    const candidate = candidates.get(itemId) ?? { item, known: offered, triggers: new Map(), references: [] };
    candidates.set(itemId, candidate);
    if (from) Object.assign(candidate, { item, known: from.known });
    // A later source (the request) supplies the text shown for a reason a saved goal already gave.
    candidate.triggers.set(key, { ruleId, key, text: textOf });
    if (!candidate.references.some(r => r.kind === reference.kind && r.ref === reference.ref)) candidate.references.push(reference);
    if (goalText !== undefined && (reference.kind === 'request' || candidate.goal === undefined)) candidate.goal = goalText;
  };
  const roots = [...intent.roots].sort((a, b) => compare(a.itemId, b.itemId)), goals = [];
  for (const root of roots) {
    const saved = SAVED_GOAL.exec(typeof root.reason === 'string' ? root.reason : '');
    const text = saved ? inline(saved[1]).toLowerCase() : '';
    const matches = (saved ? GOAL_RULES : []).flatMap(rule => { const phrase = firstPhrase(text, rule.phrases); return phrase === undefined ? [] : [{ rule, phrase }]; });
    for (const { rule, phrase } of matches) add(rule.itemId, `goal:${rule.id}`, rule.id, `Your saved goal “${inline(saved[1])}” mentions “${phrase}”.`, { kind: 'saved-reason', ref: root.itemId }, inline(saved[1]));
    if (matches.length) goals.push({ root, saved: inline(saved[1]), matches });
  }
  // Novelty alone never promotes: a saved goal's rule must name the changed item, or one of the rule's phrases must be in its label or description.
  for (const [itemId, change] of changedItems(intent, inventories, revisions, offered)) {
    const found = goals.flatMap(({ root, saved, matches }) => matches.flatMap(({ rule, phrase }) => {
      if (rule.itemId === itemId) return [{ root, saved, phrase }];
      const topic = ['label', 'description'].flatMap(field => { const hit = firstPhrase(String(change.item[field] ?? '').toLowerCase(), rule.phrases); return hit === undefined ? [] : [{ field, hit }]; })[0];
      return topic ? [{ root, saved, phrase, topic }] : [];
    }))[0];
    if (!found) continue;
    const { release } = change, where = `${release.package.name} ${release.package.version}`, name = `“${inline(change.item.label ?? itemId)}”`;
    const why = `; your saved goal “${found.saved}” mentions “${found.phrase}”${found.topic ? `, and its ${found.topic.field} mentions “${found.topic.hit}”` : ''}.`;
    // The key carries the candidate's version, so a dismissal remembers how new the content it saw was (see classifyImprovement).
    const version = release.package.version.replace(/\+.*$/, ''), key = `change:${change.kind}${version.length <= 160 ? `@${version}` : ''}`;
    add(itemId, key, `change.${change.kind}`, clip(change.kind === 'new' ? `${name} is new in ${where}, a newer revision of a source this policy was saved from${why}`
      : `${name} changed in ${where} (${change.needed ? 'an item it needs differs' : 'its recipe or files differ'} from the revision this policy was saved from)${why}`), { kind: 'saved-reason', ref: found.root.itemId }, found.saved, change);
  }
  const asked = inline(goal);
  for (const rule of asked ? GOAL_RULES : []) {
    const phrase = firstPhrase(asked.toLowerCase(), rule.phrases);
    if (phrase !== undefined) add(rule.itemId, `goal:${rule.id}`, rule.id, `You asked about “${asked}”, which mentions “${phrase}”.`, { kind: 'request', ref: 'goal' }, asked);
  }
  for (const client of [...new Set(clients)].sort(compare)) {
    const name = Object.hasOwn(labels, client) ? labels[client] : client;
    const adapter = adapterFor([...offered.values()], client);
    if (adapter) add(adapter.id, `client:${client}`, CLIENT_RULE.id, `You use ${name} (Workbench setup), but this policy does not give it the shared project instructions.`, { kind: 'setting', ref: 'clients' },
      `Give ${name} the same shared project instructions as your other AI clients.`);
  }
  const suggestions = [];
  for (const { item, known, triggers, references, goal: goalText } of candidates.values()) {
    const scope = item.scopes.includes('project') ? 'project' : item.scopes[0];
    const closure = needs(item, known, new Set()).found;
    const change = { kind: 'add-item', itemId: item.id, releaseSha256: item.root.releaseSha256, itemSha256: item.itemSha256,
      // Material content: the item and its whole required closure, whatever this policy already selects.
      content: { ...digestsOf(item), requires: closure.slice(0, MAX_TRACKED_NEEDS).map(needed => ({ itemId: needed.id, ...digestsOf(needed) })) } };
    // Bounded like the record; a larger closure is said so, never silently truncated.
    const untracked = closure.length > MAX_TRACKED_NEEDS ? [`It needs ${closure.length} items; changes to those after the first ${MAX_TRACKED_NEEDS} by id are not tracked, so they will not show a dismissed suggestion again.`] : [];
    const sorted = [...triggers.values()].sort((a, b) => compare(a.key, b.key)), id = await suggestionId({ change, scope });
    suggestions.push({ id, rulesVersion: IMPROVEMENT_RULES_VERSION, revision: await suggestionRevision({ id, change, triggers: sorted }), scope, change, triggers: sorted,
      ...(goalText !== undefined ? { goal: goalText } : {}), references: [...references.slice(0, 31), { kind: 'catalog-item', ref: item.id }],
      facts: facts(item, scope, known, selected), ...clientFacts(item, coreClients), unknowns: [...UNKNOWNS, ...untracked], label: item.label ?? item.id, description: item.description ?? '' });
  }
  const rank = s => [s.references.some(r => r.kind === 'request') ? 0 : 1, -s.triggers.length, s.references.some(r => r.kind === 'saved-reason') ? 0 : 1];
  return suggestions.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (const [i, value] of x.entries()) if (value !== y[i]) return value - y[i];
    return compare(a.change.itemId, b.change.itemId) || compare(a.scope, b.scope);
  });
}
// One leading suggestion and a few alternatives, from suggestions already in rank order.
export function lead(active) { return { leading: active[0] ?? null, alternatives: active.slice(1, 1 + MAX_ALTERNATIVES) }; }
// Whether a current suggestion stays dismissed against the suggestion record that was dismissed. A relevant material
// change (a new reason or changed content) shows it again, with the reason; fewer reasons or new wording never do.
// `versionOf` gives the package version of a supplied release digest, when the host knows it.
const reasonOf = key => key.replace(/^(change:[a-z]+)@.*$/, '$1');
export function classifyImprovement(current, saved, versionOf = () => undefined) {
  if (current.revision === saved.revision) return { dismissed: true, reasons: [] };
  // A later version of the same change is not a new reason; only its content can be.
  const known = new Set(saved.triggers.map(t => reasonOf(t.key))), reasons = current.triggers.filter(t => !known.has(reasonOf(t.key))).map(t => `Shown again: a new reason applies — ${t.text}`);
  // A dismissed change reason's content came from a newer candidate. Once no candidate gives that reason, content older than
  // what the person saw is not a change since the dismissal; content as new or newer, or of an unknown version, still is.
  const seen = saved.triggers.map(t => /^change:[a-z]+@(.+)$/.exec(t.key)?.[1]).find(Boolean);
  const older = seen !== undefined && !current.triggers.some(t => t.key.startsWith('change:')) && precedence(seen, versionOf(current.change.releaseSha256)) > 0;
  if (!older && !sameContent(current.change.content, saved.change.content)) reasons.push("Shown again: the suggested item, or an item it needs, changed since you dismissed it.");
  return { dismissed: reasons.length === 0, reasons };
}
// Copy-only text for the person's own AI client. Labels, item ids, reasons, facts and unknowns only: never file
// contents, paths, or envelope or policy bytes. Nothing here is sent anywhere.
export function improvementPrompt(suggestion) {
  const lines = [`Suggested by the AIH Workbench improvement rules ${suggestion.rulesVersion} (fixed rules; no AI model was used).`,
    'You are giving advice only. Do not install, change or run anything, and do not ask me to upload any files, policies or other data.', '',
    `Suggestion: add “${suggestion.label ?? suggestion.change.itemId}” (${suggestion.change.itemId}) to my AI-assistant policy at ${suggestion.scope} scope.`,
    '', 'Why the rules suggested it:', ...suggestion.triggers.map(t => `- ${t.text}`),
    '', 'What is known:', ...suggestion.facts.map(f => `- ${f.text}`), ...(suggestion.client ? [suggestion.client.target, suggestion.client.core, suggestion.client.installed].map(f => `- ${f.text}`) : []), '', 'What is unknown:', ...suggestion.unknowns.map(u => `- ${u}`), '',
    'Tell me in plain language whether this looks worthwhile for what I am trying to do, what to check first, and what could go wrong. Start your reply with “AI advice:”.'];
  return lines.join('\n');
}

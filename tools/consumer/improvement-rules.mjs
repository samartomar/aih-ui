// Improvement rules: a fixed, versioned table that explains why one Catalog item might help this policy. Pure and
// deterministic: it reads the open draft's saved intent, the Catalog items it is handed, the inventories the policy was saved
// from and newer candidate revisions of them, the person's declared AI clients with their published labels and an optional request goal. It calls no model, reads no network or file and keeps no clock; the same
// inputs always give the same suggestions. Rule text is not part of a suggestion's identity (see improvement-record.mjs).
import { suggestionId, suggestionRevision, sameContent, MAX_TRIGGERS } from './improvement-record.mjs';
import { orderRelation, RELEASE_ORDER_TEXT } from './release-order.mjs';
import { adapterFor, describeClientIdentity } from './client-identity.mjs';
// 1.1.0: the client rule names a client by its published label when one is supplied (wording only; identity is unchanged).
// 1.2.0: a goal-relevant item new or revised in a newer revision of a saved source is suggested from that revision; recurring friction is named as unchecked.
// 1.3.0: the client rule matches adapters by Catalog clientId; an adapter without one is not suggested.
// 1.4.0: content-change rules use the host-declared release order when known.
// 1.5.0: recurring friction from stored Core results via Core's recurrence method; a different release of a saved package whose order is unknown is reported as version-order-unknown.
// 1.6.0: recurring friction also reads the readiness journal (a check made with this host's trust and with the persisted configuration are two timelines) and the Core targets a selected item's executables run on; wording only otherwise.
export const IMPROVEMENT_RULES_VERSION = '1.6.0';
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
// A failure whose fix did not hold is what the diagnosis practice is for. Core's recurrence method over the host's stored Core results says whether it
// did (friction.mjs); this rule only names it, for something this policy selects.
export const FRICTION_RULE = { id: 'friction.recurrence', itemId: 'mattpocock.diagnosing-bugs' };
export const FIXTURE_LABEL = 'fixture evidence, not observed on this computer';
export const FRICTION_COVERAGE = { checked: 'Recurring friction was checked against the stored Core results this host supplied.',
  'no-recurrence-evidence': 'Recurring friction was not established: no stored Core result shows a failure recovering for something this policy selects, and missing history is never counted as none.',
  'history-unavailable': 'Recurring friction was not checked: this host supplied no stored Core results.' };
// Still `history-unavailable`, but a host whose configured store could not be read must not be described as holding none.
export const FRICTION_UNREADABLE = "Recurring friction was not checked: this host's stored Core results could not be read.";
export const UNKNOWNS = ['Whether it improves your results is unknown until you try it.', 'Actual usage and cost are unknown; no usage data is read.'];
// The reason format guided setup writes on each chosen root.
const SAVED_GOAL = /^guided-setup rules \d+\.\d+\.\d+: [a-z][a-z0-9.-]*\. Goal: (.+?)\. Project: /;
const inline = value => String(value ?? '').replaceAll(/\s+/g, ' ').trim().slice(0, MAX_GOAL);
export const savedGoalOf = reason => { const saved = SAVED_GOAL.exec(typeof reason === 'string' ? reason : ''); return saved ? inline(saved[1]) : undefined; };
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
// A condition in words, for a person: the two conditions Core results map to, else a readiness check by its id. A reading made with the trust Core's repairs persist
// (`persisted`: friction.mjs gives a result a method only then) is a different timeline of the same check, so it says so.
const CONDITION_WORDS = { 'condition:file-state': 'managed file state', 'condition:native-use': 'native client use' };
function conditionWords(condition, persisted) {
  const words = CONDITION_WORDS[condition] ?? `${condition.replace(/^condition:/, '')} readiness`;
  return persisted ? `persisted-configuration ${words}` : words;
}
// The reason key names the condition, its trust and the subject. A key must be word characters, `.`, `@` and `-`, so any other character (a published check id's `/`)
// is replaced and a longer name is cut; either keeps a short digest of the whole name so two different ones never share a key.
const slug = text => text.replaceAll(/[^\w.@-]/g, '-');
function frictionKey(condition, subject, persisted) {
  const check = `${persisted ? 'persisted-configuration/' : ''}${condition.replace(/^condition:/, '')}`, raw = `${check}@${subject}`, named = `${slug(check)}@${slug(subject)}`;
  if (named === raw && named.length <= 180) return `friction:${named}`;
  let hash = 5381;
  for (const char of raw) hash = (hash * 33 ^ char.codePointAt(0)) >>> 0;
  return `friction:${named.slice(0, 171)}-${hash.toString(16).padStart(8, '0')}`;
}
const scopeFor = (item, hint) => [hint, 'project'].find(name => item.scopes.includes(name)) ?? item.scopes[0];
const digestsOf = item => ({ recipeSha256: item.recipe.sha256, materials: [...new Set((item.materials ?? []).map(m => m.sha256))].sort() });
const bytesOf = item => (item.recipe?.byteLength ?? 0) + (item.materials ?? []).reduce((sum, m) => sum + m.byteLength, 0);
const byItemId = (a, b) => compare(a.id, b.id);
// The item's required items, transitively, that this policy does not already select. `required` is Catalog's resolved closure of the
// item (see `closures` on suggestImprovements), given when every release it needs is supplied; then nothing is missing. Without it the
// item's declared requirements are walked by item id over the supplied items: Catalog does not yet name the unavailable reference it
// refuses, so only the walk can say which item the supplied Catalog does not offer.
function needs(item, offered, selected, required) {
  if (required) return { found: required.filter(needed => !selected.has(needed.id)).sort(byItemId), missing: [] };
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
function facts(item, scope, offered, selected, required) {
  const { found, missing } = needs(item, offered, selected, required), all = [item, ...found];
  const labels = found.map(i => i.label ?? i.id), shown = labels.slice(0, 8).join(', ') + (labels.length > 8 ? ` and ${labels.length - 8} more` : '');
  const result = [{ kind: 'overhead', text: clip(`Adds ${plural(all.reduce((n, i) => n + 1 + (i.materials ?? []).length, 0), 'file')}, ${all.reduce((n, i) => n + bytesOf(i), 0)} bytes in total, and needs ${plural(found.length, 'other item')}${found.length ? `: ${shown}` : ''}.`) },
    { kind: 'scope', text: scope === 'project' ? 'Applies in this project only; other repositories and AI clients are unchanged.'
      : 'Applies to your user account on this computer; every project of that account is affected.' }];
  for (const id of missing.slice(0, 4)) result.push({ kind: 'dependency', text: `Needs ${id}, which the supplied Catalog does not offer.` });
  for (const conflict of (item.dependencies?.conflicts ?? []).map(c => c?.itemId ?? c).filter(id => selected.has(id)).slice(0, 4))
    result.push({ kind: 'dependency', text: `Conflicts with ${conflict}, which this policy already selects.` });
  return result;
}
// How a candidate release stands against a saved one of the same package: 'newer' or 'older', or undefined when neither is known. The order the host's
// update source declares is used first (orderRelation; it can order releases that share a version, or have none); else semantic-version precedence.
// Where this reports 'newer' by the declared order the suggestion says so (see changedItems).
export function releaseRelation(saved, candidate, releaseOrder) {
  const declared = orderRelation(releaseOrder, candidate.release.sha256, saved.release.sha256)?.relation;
  if (declared === 'newer' || declared === 'older') return declared;
  const order = precedence(candidate.release.package?.version, saved.release.package?.version);
  return order > 0 ? 'newer' : order < 0 ? 'older' : undefined;
}
// A candidate is a different release of a saved one's package from the same input. The saved policy's own record of the input wins over the supplied
// one; no input on either side is the same source.
function sameSource(intent, saved, candidate) {
  const name = saved.release.package?.name;
  if (name === undefined || candidate.release.package?.name !== name || candidate.release.sha256 === saved.release.sha256) return false;
  const input = intent.inputs.find(i => i.releaseSha256 === saved.release.sha256) ?? saved.input;
  return input ? candidate.input?.kind === input.kind && sameContent(candidate.input?.locator, input.locator) : !candidate.input;
}
// It revises the saved release when the host declares it newer or, if the host's order does not say, its version is strictly later: an older, equal or
// unversioned release is never called newer, so its novelty stays unknown.
const revises = (intent, saved, candidate, releaseOrder) => sameSource(intent, saved, candidate) && releaseRelation(saved, candidate, releaseOrder) === 'newer';
// Packages for which a candidate is a different release of a saved one that neither the host's order nor semver orders, so the check cannot say whether it is newer.
export function unorderedSources(intent, inventories, candidates, releaseOrder) {
  const names = new Set();
  for (const saved of savedBaselines(intent, inventories, candidates).resolved) for (const candidate of candidates)
    if (sameSource(intent, saved, candidate) && releaseRelation(saved, candidate, releaseOrder) === undefined) names.add(saved.release.package.name);
  return [...names].sort(compare);
}
// Labels, descriptions and item digests alone are not material: the recipe and the sorted material digests are, the item's own
// and those of every item it requires (resolved where each revision offers it), as a dismissal's content is.
// `releaseSha256` is the release the item comes from, which Catalog resolves its requirements in.
const requiredOf = (closures, item, releaseSha256, scope) => closures?.(item, releaseSha256, item.scopes?.includes(scope) ? scope : item.scopes?.[0]);
const closureOf = (item, known, required) => needs(item, known, new Set(), required).found.map(needed => ({ itemId: needed.id, ...digestsOf(needed) }));
function difference(before, beforeKnown, beforeRelease, item, known, closures) {
  if (!sameContent(digestsOf(before), digestsOf(item))) return 'own';
  return sameContent(closureOf(before, beforeKnown, requiredOf(closures, before, beforeRelease)), closureOf(item, known, requiredOf(closures, item, item.root.releaseSha256))) ? undefined : 'needed';
}
// The releases this policy was saved from, found by exact digest among the supplied inventories and then the update source's
// checked candidates (which may be the only place an older pack is offered). `saved` counts the digests the policy names; a digest found
// in neither is not compared.
export function savedBaselines(intent, inventories, candidates = []) {
  const shas = [...new Set([...intent.roots, ...intent.pins, ...intent.provenance].map(entry => entry.releaseSha256))].sort(compare);
  return { saved: shas.length, resolved: shas.flatMap(sha => [...inventories, ...candidates].filter(entry => entry.release.sha256 === sha).slice(0, 1)) };
}
// Items that candidate releases add or change against the saved releases they revise, by item id, newest candidate first. An item is new
// when none of those saved releases has it and revised when each one that has it differs; a candidate that revises none says nothing.
// `known` is what the item's requirements resolve against: its own release first, then the supplied items.
function changedItems(intent, inventories, candidates, offered, releaseOrder, closures) {
  const { resolved: saved } = savedBaselines(intent, inventories, candidates);
  const changed = new Map();
  const rank = entry => releaseOrder?.ranks[entry.release.sha256]?.[1] ?? 0;
  const versioned = entry => SEMVER.test(entry.release.package?.version ?? '');
  // Known positions sort first; semver and digest break ties, including unversioned releases with a declared position.
  const newest = candidates.filter(entry => rank(entry) || versioned(entry))
    .sort((a, b) => rank(b) - rank(a) || Number(versioned(b)) - Number(versioned(a))
      || precedence(b.release.package?.version, a.release.package?.version) || compare(a.release.sha256, b.release.sha256));
  for (const candidate of newest) {
    const { release } = candidate, sources = saved.filter(entry => revises(intent, entry, candidate, releaseOrder));
    if (!sources.length) continue;
    const own = release.items.map(item => ({ ...item, root: { releaseSha256: release.sha256 } })), known = new Map([...offered, ...own.map(item => [item.id, item])]);
    for (const item of own) {
      if (changed.has(item.id)) continue;
      const prior = sources.flatMap(entry => entry.release.items.filter(i => i.id === item.id).slice(0, 1).map(before =>
        difference(before, new Map([...offered, ...entry.release.items.map(i => [i.id, i])]), entry.release.sha256, item, known, closures)));
      const kind = !prior.length ? 'new' : prior.every(Boolean) ? 'revised' : undefined;
      if (kind) changed.set(item.id, { kind, item, release, known, hostOrdered: sources.some(entry => orderRelation(releaseOrder, release.sha256, entry.release.sha256)?.relation === 'newer'), needed: prior.length > 0 && prior.every(part => part === 'needed') });
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
// suggestion (target, Core support, installed) and never decides whether one is made. `friction` (optional) is the recurrence results
// frictionRecurrence returns for the subjects the draft ties; only an available result with a recurrence suggests anything. `releaseOrder` (optional) is the
// order the host's update source declares for its releases (release-order.mjs). `closures` (optional) gives Catalog's required closure of an
// item from a release at a scope as plain items, or undefined when Catalog cannot resolve it from what was supplied; the walk then decides.
export async function suggestImprovements({ intent, items = [], inventories = [], candidates: revisions = [], clients = [], labels = {}, goal, coreClients, friction = [], releaseOrder, closures } = {}) {
  const selected = new Set([...intent.roots, ...intent.pins].map(entry => entry.itemId)), excluded = new Set(intent.exclusions.map(entry => entry.itemId));
  const offered = new Map();
  for (const item of items) if (!offered.has(item.id)) offered.set(item.id, item);
  const candidates = new Map();
  // `from` is a changed candidate item; the suggestion then describes that item, the content its reason talks about. `hint` is the narrowest
  // scope the reason itself points at; the suggestion takes it when the item offers it, else project, else the item's first scope. A suggestion is
  // one item at one scope, so reasons that resolve to different scopes are different suggestions.
  const add = (itemId, key, ruleId, textOf, reference, goalText, from, hint) => {
    const item = from?.item ?? offered.get(itemId);
    if (!item || selected.has(itemId) || excluded.has(itemId) || !item.scopes?.length) return;
    const scope = scopeFor(item, hint), slot = `${itemId}\u0000${scope}`;
    const candidate = candidates.get(slot) ?? { item, scope, known: offered, triggers: new Map(), references: [] };
    candidates.set(slot, candidate);
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
  for (const [itemId, change] of changedItems(intent, inventories, revisions, offered, releaseOrder, closures)) {
    const found = goals.flatMap(({ root, saved, matches }) => matches.flatMap(({ rule, phrase }) => {
      if (rule.itemId === itemId) return [{ root, saved, phrase }];
      const topic = ['label', 'description'].flatMap(field => { const hit = firstPhrase(String(change.item[field] ?? '').toLowerCase(), rule.phrases); return hit === undefined ? [] : [{ field, hit }]; })[0];
      return topic ? [{ root, saved, phrase, topic }] : [];
    }))[0];
    if (!found) continue;
    const { release } = change, where = `${release.package.name}${release.package.version ? ` ${release.package.version}` : ''}${change.hostOrdered ? ` (release ${release.sha256.slice(0, 12)}…), newer by the ${RELEASE_ORDER_TEXT}` : ''}`, name = `“${inline(change.item.label ?? itemId)}”`;
    const why = `; your saved goal “${found.saved}” mentions “${found.phrase}”${found.topic ? `, and its ${found.topic.field} mentions “${found.topic.hit}”` : ''}.`;
    // The key carries the candidate's version, so a dismissal remembers how new the content it saw was (see classifyImprovement).
    const version = (release.package.version ?? '').replace(/\+.*$/, ''), key = `change:${change.kind}${version && version.length <= 160 ? `@${version}` : ''}`;
    add(itemId, key, `change.${change.kind}`, clip(change.kind === 'new' ? `${name} is new in ${where}, a newer revision of a source this policy was saved from${why}`
      : `${name} changed in ${where} (${change.needed ? 'an item it needs differs' : 'its recipe or files differ'} from the revision this policy was saved from)${why}`), { kind: 'saved-reason', ref: found.root.itemId }, found.saved, change);
  }
  for (const found of friction) {
    const { tie, condition, result } = found, persisted = found.method !== undefined;
    if (result.status !== 'available' || !(result.count >= 1)) continue;
    const words = conditionWords(condition, persisted), label = inline(tie.label), at = ref => result.timeline.find(entry => entry.claim.id === ref.id && entry.claim.revision === ref.revision)?.capturedAt;
    const [first] = result.recurrences;
    const text = clip(`Recurring failure: the ${words} check for “${label}” failed (${at(first.failure)}), recovered (${at(first.recovery)}) and failed again (${at(first.recurrence)}); ${plural(result.count, 'recurrence')} in ${plural(found.stored, 'stored Core result')}.${found.fixture ? ` This is ${FIXTURE_LABEL}.` : ''}`);
    add(FRICTION_RULE.itemId, frictionKey(condition, found.subject.id, persisted), FRICTION_RULE.id, text, tie.goal !== undefined ? { kind: 'saved-reason', ref: tie.rootItemId } : { kind: 'catalog-item', ref: tie.itemId },
      tie.goal ?? `Stop the same ${words} failure coming back for “${label}”.`.slice(0, MAX_GOAL), undefined, tie.scope);
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
  for (const { item, scope, known, triggers, references, goal: goalText } of candidates.values()) {
    const required = requiredOf(closures, item, item.root.releaseSha256, scope), closure = needs(item, known, new Set(), required).found;
    const change = { kind: 'add-item', itemId: item.id, releaseSha256: item.root.releaseSha256, itemSha256: item.itemSha256,
      // Material content: the item and its whole required closure, whatever this policy already selects.
      content: { ...digestsOf(item), requires: closure.slice(0, MAX_TRACKED_NEEDS).map(needed => ({ itemId: needed.id, ...digestsOf(needed) })) } };
    // Bounded like the record; a larger closure is said so, never silently truncated.
    const untracked = closure.length > MAX_TRACKED_NEEDS ? [`It needs ${closure.length} items; changes to those after the first ${MAX_TRACKED_NEEDS} by id are not tracked, so they will not show a dismissed suggestion again.`] : [];
    // Every other reason is listed; the recurring conditions that still fit under the record's limit are too, in key order, and the rest are said to be missing.
    const all = [...triggers.values()].sort((a, b) => compare(a.key, b.key)), others = all.filter(t => t.ruleId !== FRICTION_RULE.id), recurring = all.filter(t => t.ruleId === FRICTION_RULE.id);
    const room = Math.max(0, MAX_TRIGGERS - others.length), hidden = Math.max(0, recurring.length - room);
    const sorted = [...others, ...recurring.slice(0, room)].sort((a, b) => compare(a.key, b.key)), id = await suggestionId({ change, scope });
    const omitted = hidden ? [`${hidden} more recurring ${hidden === 1 ? 'condition is' : 'conditions are'} not listed.`] : [];
    suggestions.push({ id, rulesVersion: IMPROVEMENT_RULES_VERSION, revision: await suggestionRevision({ id, change, triggers: sorted }), scope, change, triggers: sorted,
      ...(goalText !== undefined ? { goal: goalText } : {}), references: [...references.slice(0, 31), { kind: 'catalog-item', ref: item.id }],
      facts: facts(item, scope, known, selected, required), ...clientFacts(item, coreClients), unknowns: [...UNKNOWNS, ...untracked, ...omitted], label: item.label ?? item.id, description: item.description ?? '' });
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

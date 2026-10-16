// Improvement rules: a fixed, versioned table that explains why one Catalog item might help this policy. Pure and
// deterministic: it reads the open draft's saved intent, the Catalog items it is handed, the person's declared AI
// clients and an optional request goal. It calls no model, reads no network or file and keeps no clock; the same
// inputs always give the same suggestions. Rule text is not part of a suggestion's identity (see improvement-record.mjs).
import { suggestionId, suggestionRevision, sameContent } from './improvement-record.mjs';
export const IMPROVEMENT_RULES_VERSION = '1.0.0';
export const MAX_GOAL = 300, MAX_ALTERNATIVES = 3;
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
export const CLIENT_RULE = { id: 'client.instructions', itemPrefix: 'aihq.client.' };
export const UNKNOWNS = ['Whether it improves your results is unknown until you try it.', 'Actual usage and cost are unknown; no usage data is read.',
  'Recurring friction is not checked: this Workbench has no evidence source for it yet.'];
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
// Suggestions for an open draft, ranked: a request first, then more reasons, then a saved goal before a client-only
// reason, then item id. `items` are plain Catalog items in the order the inventories were supplied, each with
// root.releaseSha256; the first offering an id is the one suggested. Nothing absent from them is ever suggested.
export async function suggestImprovements({ intent, items = [], clients = [], goal } = {}) {
  const selected = new Set([...intent.roots, ...intent.pins].map(entry => entry.itemId)), excluded = new Set(intent.exclusions.map(entry => entry.itemId));
  const offered = new Map();
  for (const item of items) if (!offered.has(item.id)) offered.set(item.id, item);
  const candidates = new Map();
  const add = (itemId, key, ruleId, textOf, reference, goalText) => {
    const item = offered.get(itemId);
    if (!item || selected.has(itemId) || excluded.has(itemId) || !item.scopes?.length) return;
    const candidate = candidates.get(itemId) ?? { item, triggers: new Map(), references: [] };
    candidates.set(itemId, candidate);
    // A later source (the request) supplies the text shown for a reason a saved goal already gave.
    candidate.triggers.set(key, { ruleId, key, text: textOf });
    if (!candidate.references.some(r => r.kind === reference.kind && r.ref === reference.ref)) candidate.references.push(reference);
    if (goalText !== undefined && (reference.kind === 'request' || candidate.goal === undefined)) candidate.goal = goalText;
  };
  const roots = [...intent.roots].sort((a, b) => compare(a.itemId, b.itemId));
  for (const root of roots) {
    const saved = SAVED_GOAL.exec(typeof root.reason === 'string' ? root.reason : '');
    const text = saved ? inline(saved[1]).toLowerCase() : '';
    for (const rule of saved ? GOAL_RULES : []) {
      const phrase = firstPhrase(text, rule.phrases);
      if (phrase !== undefined) add(rule.itemId, `goal:${rule.id}`, rule.id, `Your saved goal “${inline(saved[1])}” mentions “${phrase}”.`, { kind: 'saved-reason', ref: root.itemId }, inline(saved[1]));
    }
  }
  const asked = inline(goal);
  for (const rule of asked ? GOAL_RULES : []) {
    const phrase = firstPhrase(asked.toLowerCase(), rule.phrases);
    if (phrase !== undefined) add(rule.itemId, `goal:${rule.id}`, rule.id, `You asked about “${asked}”, which mentions “${phrase}”.`, { kind: 'request', ref: 'goal' }, asked);
  }
  for (const client of [...new Set(clients)].sort(compare))
    add(`${CLIENT_RULE.itemPrefix}${client}`, `client:${client}`, CLIENT_RULE.id, `You use ${client} (Workbench setup), but this policy does not give it the shared project instructions.`, { kind: 'setting', ref: 'clients' },
      `Give ${client} the same shared project instructions as your other AI clients.`);
  const suggestions = [];
  for (const { item, triggers, references, goal: goalText } of candidates.values()) {
    const scope = item.scopes.includes('project') ? 'project' : item.scopes[0];
    const change = { kind: 'add-item', itemId: item.id, releaseSha256: item.root.releaseSha256, itemSha256: item.itemSha256,
      // Material content: the item and its whole required closure, whatever this policy already selects.
      content: { ...digestsOf(item), requires: needs(item, offered, new Set()).found.slice(0, 64).map(needed => ({ itemId: needed.id, ...digestsOf(needed) })) } };
    const sorted = [...triggers.values()].sort((a, b) => compare(a.key, b.key)), id = await suggestionId({ change, scope });
    suggestions.push({ id, rulesVersion: IMPROVEMENT_RULES_VERSION, revision: await suggestionRevision({ id, change, triggers: sorted }), scope, change, triggers: sorted,
      ...(goalText !== undefined ? { goal: goalText } : {}), references: [...references.slice(0, 31), { kind: 'catalog-item', ref: item.id }],
      facts: facts(item, scope, offered, selected), unknowns: [...UNKNOWNS], label: item.label ?? item.id, description: item.description ?? '' });
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
export function classifyImprovement(current, saved) {
  if (current.revision === saved.revision) return { dismissed: true, reasons: [] };
  const known = new Set(saved.triggers.map(t => t.key)), reasons = current.triggers.filter(t => !known.has(t.key)).map(t => `Shown again: a new reason applies — ${t.text}`);
  if (!sameContent(current.change.content, saved.change.content)) reasons.push("Shown again: the suggested item, or an item it needs, changed since you dismissed it.");
  return { dismissed: reasons.length === 0, reasons };
}
// Copy-only text for the person's own AI client. Labels, item ids, reasons, facts and unknowns only: never file
// contents, paths, or envelope or policy bytes. Nothing here is sent anywhere.
export function improvementPrompt(suggestion) {
  const lines = [`Suggested by the AIH Workbench improvement rules ${suggestion.rulesVersion} (fixed rules; no AI model was used).`,
    'You are giving advice only. Do not install, change or run anything, and do not ask me to upload any files, policies or other data.', '',
    `Suggestion: add “${suggestion.label ?? suggestion.change.itemId}” (${suggestion.change.itemId}) to my AI-assistant policy at ${suggestion.scope} scope.`,
    '', 'Why the rules suggested it:', ...suggestion.triggers.map(t => `- ${t.text}`),
    '', 'What is known:', ...suggestion.facts.map(f => `- ${f.text}`), '', 'What is unknown:', ...suggestion.unknowns.map(u => `- ${u}`), '',
    'Tell me in plain language whether this looks worthwhile for what I am trying to do, what to check first, and what could go wrong. Start your reply with “AI advice:”.'];
  return lines.join('\n');
}

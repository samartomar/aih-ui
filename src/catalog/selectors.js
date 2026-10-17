/*
 * Presentation selectors: search, filters, sorting and inventory counts.
 *
 * Pure functions over the published entries and a view description. They decide
 * what is *shown*, never what is *true*: no entry, count or label is ever
 * hardcoded, and every number a component renders is counted from the installed
 * index here at run time.
 */

import { text } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { identity, searchText, sourceIdentity, sourceLabelOf } from "./entry.js";

/* Nested source row that filters by source identity without naming one, used when a source
   type publishes its entries under a single identity (the npm package, for example). */
export const DISTINCT_SOURCES = "__distinct__";
/* Separates the parts of a nested source filter: type, source identity, revision. */
export const FILTER_SEPARATOR = "\u0000";
/* The prototype sorts by name; the other keys are published identities. */
export const SORT_KEYS = ["name", "name-desc", "entryId", "entryId-desc", "kind", "sourceType", "sourceLabel", "release"];

/* How an entry is grouped: by its published source identity. */
function scopeLabelOf(entry) {
  return sourceLabelOf(sourceIdentity(entry)) ?? NOT_PUBLISHED;
}

export function sourceFilterValue(type, label, revision) {
  return `${type}${FILTER_SEPARATOR}${label}${FILTER_SEPARATOR}${revision}`;
}

/* Kept for callers that read a single revision string off an entry. */
function revisionOf(entry) {
  return sourceIdentity(entry).revision;
}

export function matchesSourceFilter(entry, value) {
  const [type, label, revision] = value.split(FILTER_SEPARATOR);
  const source = sourceIdentity(entry);
  if (source.type !== type) return false;
  const sourceLabel = sourceLabelOf(source);
  if (label === DISTINCT_SOURCES) return true;
  const matchesLabel = label === (sourceLabel ?? NOT_PUBLISHED);
  if (revision) return matchesLabel && revision === (source.revision ?? NOT_PUBLISHED);
  return matchesLabel || revisionOf(entry) === label || source.repository === label || source.packageName === label;
}

/** The entries this view shows, in this view's order. */
export function visibleEntries(entries, view) {
  const query = view.query.trim().toLocaleLowerCase();
  const rows = entries.filter((entry) => {
    const source = sourceIdentity(entry);
    if (view.kind && text(entry?.subject?.kind) !== view.kind) return false;
    if (view.sourceType && source.type !== view.sourceType) return false;
    if (view.source && !matchesSourceFilter(entry, view.source)) return false;
    if (query && !searchText(entry).toLocaleLowerCase().includes(query)) return false;
    return true;
  });
  const direction = view.sort.endsWith("-desc") ? -1 : 1;
  const key = view.sort.replace("-desc", "");
  return rows.sort((a, b) => {
    const left = identity(a)[key] ?? "";
    const right = identity(b)[key] ?? "";
    return left.localeCompare(right) * direction || identity(a).entryId.localeCompare(identity(b).entryId);
  });
}

function countBy(entries, selector) {
  const counts = new Map();
  for (const entry of entries) {
    const key = selector(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function sortedCounts(counts) {
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/**
 * Every inventory count the page shows, taken from the installed index.
 *
 * `sourceIdentities` is a map of source type -> published identity -> { total,
 * revisions }: the repository for github, the package for npm, the release for
 * aih. A github repository carries many revisions, so each identity also counts
 * its revisions, and those counts are what make revisions distinguishable.
 */
export function inventoryCounts(entries) {
  const sourceIdentities = new Map();
  for (const entry of entries) {
    const source = sourceIdentity(entry);
    if (!sourceIdentities.has(source.type)) sourceIdentities.set(source.type, new Map());
    const identities = sourceIdentities.get(source.type);
    const label = scopeLabelOf(entry);
    // The first entry's source identity is kept with the group, so a row can
    // show its repository, package, version or release from published fields
    // rather than by taking the label apart again.
    if (!identities.has(label)) {
      identities.set(label, { total: 0, revisions: new Map(), source });
    }
    const group = identities.get(label);
    group.total += 1;
    const revision = source.revision ?? NOT_PUBLISHED;
    group.revisions.set(revision, (group.revisions.get(revision) ?? 0) + 1);
  }
  return {
    kindCounts: countBy(entries, (entry) => text(entry?.subject?.kind) ?? "unknown"),
    sourceTypeCounts: countBy(entries, (entry) => sourceIdentity(entry).type),
    sourceIdentities,
  };
}

/**
 * One row per published source identity, largest first.
 *
 * A row is a repository for github, a package for npm and a release for aih,
 * exactly as the index publishes them. Its revision is shown only when the
 * whole group shares one: an aih release carries a content revision per item,
 * which is not one framework commit, and an npm integrity is not a commit, so
 * neither is ever presented as one.
 */
export function sourceScopes(counts) {
  const rows = [];
  for (const [type, identities] of counts.sourceIdentities) {
    for (const [identityKey, group] of identities) {
      const revisions = [...group.revisions.keys()].filter((revision) => revision !== NOT_PUBLISHED);
      const sharedRevision = revisions.length === 1 ? revisions[0] : "";
      rows.push({
        type,
        identityKey,
        total: group.total,
        source: group.source,
        revisionCount: group.revisions.size,
        sharedRevision,
        filterValue: sourceFilterValue(type, identityKey, sharedRevision),
      });
    }
  }
  return rows.sort((a, b) => b.total - a.total || a.identityKey.localeCompare(b.identityKey));
}

/** How many current entries share this entry's scope row. */
export function scopeCountOf(entry, counts) {
  const type = sourceIdentity(entry).type;
  return counts.sourceIdentities.get(type)?.get(scopeLabelOf(entry))?.total ?? 0;
}

/** The scope row the view is filtered to, or null for all sources. */
export function selectedScope(counts, view) {
  if (!view.source) return null;
  return sourceScopes(counts).find((row) => row.filterValue === view.source) ?? null;
}

/**
 * The entries the current source scope holds, before any narrowing by search,
 * kind, category or review state.
 */
export function scopeEntries(entries, view) {
  return entries.filter((entry) => {
    if (view.sourceType && sourceIdentity(entry).type !== view.sourceType) return false;
    if (view.source && !matchesSourceFilter(entry, view.source)) return false;
    return true;
  });
}

/** The source inventory denominator, before search, kind and category filters. */
export function scopeTotal(entries, view) {
  return scopeEntries(entries, view).length;
}

/* Validated before any value from the index becomes part of a link. */
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_COMMIT = /^[0-9a-f]{7,40}$/;

/** Display name and revision badge for one scope, from published fields only. */
export function describeScope(row) {
  const source = row.source ?? {};
  if (row.type === "github") {
    const commit = row.sharedRevision || null;
    return {
      name: source.repository ?? row.identityKey,
      badge: commit === null ? `${row.revisionCount} revisions` : commit.slice(0, 7),
      badgeTitle: commit === null
        ? `${row.revisionCount} published commits in this repository`
        : `Published commit ${commit}`,
      revision: commit,
      href:
        commit !== null && GITHUB_REPOSITORY.test(source.repository ?? "") && GITHUB_COMMIT.test(commit)
          ? `https://github.com/${source.repository}/commit/${commit}`
          : null,
    };
  }
  if (row.type === "npm") {
    return {
      name: source.packageName ?? row.identityKey,
      badge: source.version ?? NOT_PUBLISHED,
      badgeTitle: `npm version ${source.version ?? "not published"}. The integrity value is not a commit.`,
      revision: source.version ?? null,
      href: null,
    };
  }
  if (row.type === "aih") {
    return {
      name: "aih",
      badge: source.release ?? row.identityKey,
      badgeTitle:
        `aih release ${source.release ?? row.identityKey}. Each item carries its own content ` +
        "revision; there is no single framework commit.",
      revision: source.release ?? null,
      href: null,
    };
  }
  return {
    name: row.identityKey,
    badge: null,
    badgeTitle: null,
    revision: null,
    href: null,
  };
}

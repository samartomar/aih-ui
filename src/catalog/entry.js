import { sourcePresentation } from "./source-facts.js";
/*
 * Reading one published catalog entry.
 *
 * Every function here is a pure reader over what the index carries. Source
 * identity is read from the `source.type` discriminator, never from whichever
 * field happens to be present: a github source is a repository + commit + path,
 * an npm source is a registry + package + version + integrity, and an aih
 * source is its published release + revision. A commit is never rendered as a
 * version, and no value is invented for a field the index does not carry.
 *
 * Nothing here decides, filters or renders. Selection lives in selectors.js and
 * presentation in the components.
 */

import { text } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";

/* A published revision, shortened for display. Raw revision digests keep their "sha256:"
   prefix in the index; the inspector shows one of the two consistently, and says the digest
   is abbreviated instead of passing a short hash off as the whole value. */
export function shortDigest(value) {
  const digest = text(value);
  if (digest === null) return null;
  const hex = digest.replace(/^sha256:/, "");
  return hex.slice(0, 12);
}

/* Identity fields per source.type. `revision` is the only value the page calls a revision:
   a git commit for github, the published revision for aih, the SRI integrity for npm (an npm
   tarball has no commit, so the commit row stays Not published). */
export function sourceIdentity(entry) {
  const source = entry?.subject?.source;
  if (source === null || typeof source !== "object") {
    return { type: "unknown", repository: null, commit: null, path: null, packageName: null, registry: null, version: null, integrity: null, release: null, revision: null };
  }
  const type = text(source.type) ?? "unknown";
  const repository = text(source.repository);
  const commit = text(source.commit);
  const sourcePath = text(source.path);
  const packageName = text(source.package);
  const registry = text(source.registry);
  const version = text(source.version);
  const integrity = text(source.integrity);
  const release = text(source.release);
  const revision = type === "github" ? commit : type === "npm" ? integrity : text(source.revision) ?? commit;
  return { type, repository, commit, path: sourcePath, packageName, registry, version, integrity, release, revision };
}

/* The one line that names the source identity this entry came from. */
export function sourceLabelOf(source) {
  if (source.type === "github") return source.repository ?? source.commit;
  if (source.type === "npm") return source.packageName === null ? null : source.version === null ? source.packageName : `${source.packageName}@${source.version}`;
  if (source.type === "aih") return source.release ?? null;
  return source.release ?? source.repository ?? source.packageName ?? source.commit;
}

export function sourceLabelTitle(source, label) {
  if (source.type === "github") return `GitHub source: revision ${source.commit ?? "not published"}`;
  if (source.type === "npm") return `npm source: ${source.packageName ?? "package not published"} ${source.version ?? "version not published"}`.trim();
  if (source.type === "aih") return `AIH source: release ${source.release ?? "not published"}`;
  return `Source identity: ${label}`;
}

/* The rows the inspector shows for a source, in the order that source type publishes them. */
export function sourceDetailRows(source) {
  if (source.type === "github") {
    return [
      ["Repository", source.repository],
      ["Commit", source.commit],
      ["Path", source.path],
    ];
  }
  if (source.type === "npm") {
    return [
      ["Registry", source.registry],
      ["Package", source.packageName],
      ["Version", source.version],
      ["Integrity", source.integrity],
    ];
  }
  if (source.type === "aih") {
    return [
      ["Release", source.release],
      ["Revision", source.revision],
    ];
  }
  return [
    ["Revision", source.revision],
    ["Repository", source.repository],
    ["Package", source.packageName],
  ];
}

export function identity(entry) {
  const source = sourceIdentity(entry);
  const sourceLabel = sourceLabelOf(source);
  const entryId = text(entry?.entryId) ?? "(entryId not published)";
  return {
    entryId,
    // The item's own published name, which is what the prototype titles a
    // card with. The entry id stays available as the exact identifier.
    name: text(entry?.subject?.id) ?? entryId,
    subjectId: text(entry?.subject?.id) ?? NOT_PUBLISHED,
    kind: text(entry?.subject?.kind) ?? "unknown",
    sourceType: source.type,
    sourceLabel,
    release: sourceLabel,
    revision: source.revision,
  };
}

/*
 * The entry's evidence statements, in the shape Catalog's public reader returns
 * them (`CatalogEvidenceV1`: path, sha256, subjectDigest, format, kind, id,
 * attestor and - from a reader that carries it - summary). The page is served
 * that reader's output, so a summary an installed reader does not return is
 * null here, and the slot says so.
 */
function statement(kind, item) {
  return {
    kind,
    id: text(item?.id),
    attestor: text(item?.attestor),
    format: text(item?.format),
    summary: text(item?.summary),
    path: text(item?.path),
    sha256: text(item?.sha256),
  };
}

export function statementsOf(entry) {
  const qualification = entry?.qualification ?? {};
  const groups = [["finding", qualification.findings], ["gap", qualification.gaps], ["right", qualification.rights]];
  const statements = [];
  for (const [kind, list] of groups) {
    for (const item of Array.isArray(list) ? list : []) statements.push(statement(kind, item));
  }
  const report = qualification.report;
  if (report && typeof report === "object") statements.push(statement("report", report));
  return statements;
}

export function firstSummary(entry, kinds) {
  const found = statementsOf(entry).find((statement) => kinds.includes(statement.kind) && statement.summary);
  return found ? found.summary : null;
}

/* Everything the search box matches: the published ids and every published identity field of
   the source, so a repository, package, path or commit is findable without a lookup table. */
export function searchText(entry) {
  const id = identity(entry);
  const source = sourceIdentity(entry);
  return [
    sourcePresentation(entry.authoringItem).name,
    sourcePresentation(entry.authoringItem).description,
    id.entryId,
    id.subjectId,
    id.kind,
    id.sourceType,
    id.sourceLabel,
    id.revision,
    source.repository,
    source.commit,
    source.path,
    source.packageName,
    source.registry,
    source.version,
    source.integrity,
    source.release,
  ].filter((part) => part !== null).join(" ");
}

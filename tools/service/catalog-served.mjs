/**
 * The catalog document the page is served: Catalog's public reader output,
 * projected field by field, and nothing else.
 *
 * The page used to be served the raw `defaults/catalog-index-v1.json` bytes,
 * which let it render a field the public reader validates and then drops. It is
 * served this projection instead, built ONLY from what `readCatalogContentV1`
 * returned. Each level copies exactly the members of the reader's result type
 * (`CatalogContentV1`, `CatalogEntryV1`, `CatalogEvidenceV1`, ...), so a member
 * the reader does not carry cannot reach the page, whatever the index file
 * holds and even if a reader were to hand one back. An optional member of a
 * newer reader - the evidence `summary` - is copied only when the installed
 * reader actually returned it as text, so against an older Catalog it is
 * absent and the page states that absence.
 *
 * Deliberately left out:
 *   - `status`: `structure` and `artifacts` describe one read with or without
 *     byte checks; the page reads Catalog's integrity answer per entry from
 *     /api/catalog-integrity instead.
 *   - an artifact's `bytes`, `byteLength` and `reason`: this document is built
 *     from a read that does not verify artifacts, so every artifact is
 *     `not-evaluated` and carries its declared path and sha256 only.
 *
 * No package is imported here. The service reads the installed Catalog and
 * hands the reader's result in, which keeps this projection checkable offline
 * (tools/tests/catalog-served.test.mjs).
 */

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const textOr = (value) => (typeof value === "string" ? value : undefined);

function refuse(where) {
  throw new Error(`the catalog reader result is malformed at ${where}; nothing is served`);
}

function descriptor(value, where) {
  if (!isObject(value) || typeof value.path !== "string" || typeof value.sha256 !== "string") refuse(where);
  return { path: value.path, sha256: value.sha256 };
}

/** `CatalogArtifactV1`, as a read without byte checks returns it. */
function artifact(value, where) {
  if (value === undefined) return undefined;
  if (!isObject(value) || typeof value.state !== "string") refuse(where);
  return { state: value.state, ...descriptor(value, where) };
}

/** `CatalogEvidenceV1`. `summary` exists only on a reader that returns it. */
function evidence(value, where) {
  if (!isObject(value)) refuse(where);
  const record = {
    ...descriptor(value, where),
    subjectDigest: textOr(value.subjectDigest) ?? refuse(`${where}.subjectDigest`),
    format: textOr(value.format) ?? refuse(`${where}.format`),
    kind: textOr(value.kind) ?? refuse(`${where}.kind`),
    id: textOr(value.id) ?? refuse(`${where}.id`),
    attestor: textOr(value.attestor) ?? refuse(`${where}.attestor`),
  };
  if (typeof value.summary === "string") record.summary = value.summary;
  return record;
}

function evidenceList(value, where) {
  if (!Array.isArray(value)) refuse(where);
  return value.map((item, index) => evidence(item, `${where}[${index}]`));
}

function strings(value, where) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) refuse(where);
  return [...value];
}

/** `CatalogEntryV1["subject"]`: `source` is a record of strings by source type. */
function subject(value, where) {
  if (!isObject(value) || !isObject(value.source)) refuse(where);
  const source = {};
  for (const [key, item] of Object.entries(value.source)) {
    if (typeof item !== "string") refuse(`${where}.source.${key}`);
    source[key] = item;
  }
  return {
    id: textOr(value.id) ?? refuse(`${where}.id`),
    kind: textOr(value.kind) ?? refuse(`${where}.kind`),
    source,
    sourceDigest: textOr(value.sourceDigest) ?? refuse(`${where}.sourceDigest`),
    subjectDigest: textOr(value.subjectDigest) ?? refuse(`${where}.subjectDigest`),
  };
}

const CAPABILITIES = ["commands", "egress", "hooks", "mcpTools", "permissions"];
const ARTIFACTS = ["closure", "profile", "prose", "recipe"];

function entry(value, where) {
  if (!isObject(value) || !isObject(value.capabilities) || !isObject(value.artifacts)) refuse(where);
  if (!isObject(value.qualification) || !Array.isArray(value.platforms)) refuse(where);
  const artifacts = {};
  for (const name of ARTIFACTS) {
    const projected = artifact(value.artifacts[name], `${where}.artifacts.${name}`);
    if (projected !== undefined) artifacts[name] = projected;
  }
  const qualification = value.qualification;
  return {
    entryId: textOr(value.entryId) ?? refuse(`${where}.entryId`),
    subject: subject(value.subject, `${where}.subject`),
    seed: descriptor(value.seed, `${where}.seed`),
    capabilities: Object.fromEntries(
      CAPABILITIES.map((name) => [name, strings(value.capabilities[name], `${where}.capabilities.${name}`)]),
    ),
    platforms: value.platforms.map((platform, index) => {
      if (!isObject(platform)) refuse(`${where}.platforms[${index}]`);
      return {
        os: textOr(platform.os) ?? refuse(`${where}.platforms[${index}].os`),
        architecture: textOr(platform.architecture) ?? refuse(`${where}.platforms[${index}].architecture`),
      };
    }),
    artifacts,
    qualification: {
      report: evidence(qualification.report, `${where}.qualification.report`),
      findings: evidenceList(qualification.findings, `${where}.qualification.findings`),
      gaps: evidenceList(qualification.gaps, `${where}.qualification.gaps`),
      rights: evidenceList(qualification.rights, `${where}.qualification.rights`),
    },
  };
}

/**
 * @param content what `readCatalogContentV1` returned for the installed index
 * @returns the served document: `{ format, version, digest, package,
 *          organizationAdmission, entries }`, every entry exactly the reader's
 */
export function servedCatalogDocument(content) {
  if (!isObject(content) || !Array.isArray(content.entries) || !isObject(content.package)) refuse("the document");
  return {
    format: textOr(content.format) ?? refuse("format"),
    version: Number.isInteger(content.version) ? content.version : refuse("version"),
    digest: textOr(content.digest) ?? refuse("digest"),
    package: {
      name: textOr(content.package.name) ?? refuse("package.name"),
      version: textOr(content.package.version) ?? refuse("package.version"),
    },
    organizationAdmission: textOr(content.organizationAdmission) ?? refuse("organizationAdmission"),
    entries: content.entries.map((item, index) => entry(item, `entries[${index}]`)),
  };
}

/*
 * The served catalog document carries the public reader's fields and nothing else.
 *
 * The page used to be served the raw index file, and it rendered a field that
 * Catalog's public reader drops. The served document is now built from the
 * reader's result, member by member. These cases feed the builder a reader
 * result that carries extra members at every level - as a raw index does, and
 * as a careless reader might - and assert that none of them is served, that
 * every served member is a member of the reader's result type, and that the
 * evidence `summary` is served exactly when the reader returned it.
 *
 *   node --test "tools/tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { servedCatalogDocument } from "../service/catalog-served.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const HEX = "b".repeat(64);

/** One evidence record in `CatalogEvidenceV1` shape, plus whatever `extra` adds. */
const record = (kind, extra = {}) => ({
  path: `defaults/evidence/${kind}.json`,
  sha256: HEX,
  subjectDigest: DIGEST,
  format: "aih-supported-evidence/v2",
  kind,
  id: `${kind}-1`,
  attestor: "operator:test",
  ...extra,
});

/**
 * A reader result, with `leak` members added at every level. `summary` is the
 * newer reader's optional evidence member; `withSummary` decides whether this
 * reader returned it.
 */
function readerResult({ withSummary, leak }) {
  const extra = leak ? { unpublishedField: "must not be served" } : {};
  const summary = (text) => (withSummary ? { summary: text } : {});
  return {
    format: "aih-catalog-index",
    version: 1,
    digest: DIGEST,
    package: { name: "@aihq/catalog", version: "0.2.0", ...extra },
    organizationAdmission: "not-authoritative",
    status: { structure: "valid", artifacts: "not-evaluated" },
    ...extra,
    entries: [
      {
        entryId: "skill.test.one",
        subject: {
          id: "one",
          kind: "skill",
          source: { type: "github", repository: "owner/repo", commit: "c".repeat(40), path: "skills/one" },
          sourceDigest: DIGEST,
          subjectDigest: DIGEST,
          ...extra,
        },
        seed: { path: "defaults/seed.json", sha256: HEX, ...extra },
        capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [], ...extra },
        platforms: [{ os: "linux", architecture: "x64", ...extra }],
        artifacts: {
          closure: { state: "not-evaluated", path: "defaults/a/closure.json", sha256: HEX, ...extra },
          profile: { state: "not-evaluated", path: "defaults/a/profile.json", sha256: HEX },
          prose: { state: "not-evaluated", path: "defaults/a/prose.md", sha256: HEX },
          recipe: { state: "not-evaluated", path: "defaults/a/recipe.json", sha256: HEX },
          ...(leak ? { unpublishedArtifact: { state: "not-evaluated", path: "x", sha256: HEX } } : {}),
        },
        qualification: {
          report: record("report", { ...summary("Report summary.\nSecond line."), ...extra }),
          findings: [record("finding", { ...summary("One finding."), ...extra })],
          gaps: [record("gap", summary("One gap."))],
          rights: [record("right", summary("One right."))],
          ...extra,
        },
        ...extra,
      },
    ],
  };
}

/*
 * The members of the reader's result type, per level, as Catalog's
 * `catalog-content-v1.ts` declares them. `status` is a member the served
 * document deliberately does not carry.
 */
const EVIDENCE = ["path", "sha256", "subjectDigest", "format", "kind", "id", "attestor", "summary"];
const TYPE = {
  document: ["format", "version", "digest", "package", "organizationAdmission", "status", "entries"],
  package: ["name", "version"],
  entry: ["entryId", "subject", "seed", "capabilities", "platforms", "artifacts", "qualification"],
  subject: ["id", "kind", "source", "sourceDigest", "subjectDigest"],
  seed: ["path", "sha256"],
  capabilities: ["commands", "egress", "hooks", "mcpTools", "permissions"],
  platform: ["os", "architecture"],
  artifacts: ["closure", "profile", "prose", "recipe"],
  artifact: ["state", "path", "sha256", "bytes", "byteLength", "reason"],
  qualification: ["report", "findings", "gaps", "rights"],
};

/** Every member path of `served` that the reader's result type does not declare. */
function undeclared(served) {
  const out = [];
  const only = (value, allowed, where) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) out.push(`${where}.${key}`);
  };
  only(served, TYPE.document, "document");
  only(served.package, TYPE.package, "package");
  served.entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    only(entry, TYPE.entry, at);
    only(entry.subject, TYPE.subject, `${at}.subject`);
    only(entry.seed, TYPE.seed, `${at}.seed`);
    only(entry.capabilities, TYPE.capabilities, `${at}.capabilities`);
    entry.platforms.forEach((platform, n) => only(platform, TYPE.platform, `${at}.platforms[${n}]`));
    only(entry.artifacts, TYPE.artifacts, `${at}.artifacts`);
    for (const [name, artifact] of Object.entries(entry.artifacts)) only(artifact, TYPE.artifact, `${at}.artifacts.${name}`);
    only(entry.qualification, TYPE.qualification, `${at}.qualification`);
    const q = entry.qualification;
    for (const [name, item] of [["report", q.report], ...["findings", "gaps", "rights"].flatMap((group) => q[group].map((r, n) => [`${group}[${n}]`, r]))]) {
      only(item, EVIDENCE, `${at}.qualification.${name}`);
    }
  });
  return out;
}

test("a member the reader's result type does not declare is never served, at any level", () => {
  const served = servedCatalogDocument(readerResult({ withSummary: true, leak: true }));
  const text = JSON.stringify(served);
  assert.equal(text.includes("unpublishedField"), false, text);
  assert.equal(text.includes("unpublishedArtifact"), false, text);
  assert.equal(text.includes("must not be served"), false, text);
  assert.deepEqual(undeclared(served), []);
});

test("the served document is exactly the reader's entries, with the document identity beside them", () => {
  const input = readerResult({ withSummary: true, leak: false });
  const served = servedCatalogDocument(input);
  assert.deepEqual(Object.keys(served), ["format", "version", "digest", "package", "organizationAdmission", "entries"]);
  assert.deepEqual(served.entries, input.entries);
  assert.equal(served.digest, input.digest);
  assert.equal(served.organizationAdmission, "not-authoritative");
});

test("the evidence summary is served verbatim when the reader returns it, and absent when it does not", () => {
  const newer = servedCatalogDocument(readerResult({ withSummary: true, leak: true })).entries[0].qualification;
  assert.equal(newer.report.summary, "Report summary.\nSecond line.");
  assert.equal(newer.findings[0].summary, "One finding.");
  const older = servedCatalogDocument(readerResult({ withSummary: false, leak: true })).entries[0].qualification;
  for (const item of [older.report, ...older.findings, ...older.gaps, ...older.rights]) {
    assert.equal(Object.hasOwn(item, "summary"), false, JSON.stringify(item));
  }
});

test("a malformed reader result is refused, never partly served", () => {
  const input = readerResult({ withSummary: true, leak: false });
  delete input.entries[0].qualification.report.attestor;
  assert.throws(() => servedCatalogDocument(input), /malformed at entries\[0\]\.qualification\.report\.attestor/);
  assert.throws(() => servedCatalogDocument(undefined), /malformed/);
  const numeric = readerResult({ withSummary: true, leak: false });
  numeric.entries[0].qualification.findings[0].summary = 42;
  // A non-text summary is not the reader's member: it is left out, not coerced.
  assert.equal(Object.hasOwn(servedCatalogDocument(numeric).entries[0].qualification.findings[0], "summary"), false);
});

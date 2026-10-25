// The Workbench's package-support declaration and the fixtures it exports. package-support-1.1.json follows the
// shape of Core's published `@aihq/core/schemas/package-support/1.1.0.json` (checked here by hand because this
// offline suite installs no Core; the installed-Core check validates it with Core's own validator when Core has one).
// Each of its own formats' fixtures is read through the Workbench's own public reader, and must come out as declared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = path => JSON.parse(readFileSync(join(repo, path), "utf8"));
const pkg = json("package.json");
const support = json("package-support-1.1.json");
const URN = /^urn:aihq:[a-z0-9-]+(:[a-z0-9-]+)*:\d+\.\d+\.\d+$/;
// The package entries README documents as portable (tools/tests/pure-imports.test.mjs keeps them so).
const PORTABLE = ["./journey", "./workspace", "./batch"];
const keys = value => Object.keys(value).sort();
const OWN = `${pkg.name}/`;
// Resolves one of this package's export specifiers through its export map, as Node does for an installed package.
function exported(specifier) {
  const subpath = `.${specifier.slice(pkg.name.length)}`;
  if (Object.hasOwn(pkg.exports, subpath)) return pkg.exports[subpath];
  for (const [key, target] of Object.entries(pkg.exports)) {
    const star = key.indexOf("*");
    if (star >= 0 && subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1))) return target.replace("*", subpath.slice(star, subpath.length - (key.length - star - 1)));
  }
  return null;
}

test("the declaration has exactly the package-support 1.1.0 shape and is exported where packages publish it", () => {
  assert.deepEqual(keys(support), ["contracts", "entries", "package", "schema"]);
  assert.equal(support.schema, "urn:aihq:package-support:1.1.0");
  assert.deepEqual(support.package, { name: pkg.name, version: pkg.version });
  assert.equal(pkg.exports["./package-support-1.1.json"], "./package-support-1.1.json");
  for (const contract of support.contracts) {
    assert.deepEqual(keys(contract), ["fixtures", "id", "role", "schemaExport", "versions"], JSON.stringify(contract));
    assert.match(contract.id, URN);
    assert.ok(["accepts", "produces", "both"].includes(contract.role), contract.id);
    assert.deepEqual(contract.versions, [contract.id.split(":").at(-1)], contract.id);
    for (const fixture of contract.fixtures) {
      assert.deepEqual(keys(fixture).filter(key => key !== "code"), ["expect", "export"], JSON.stringify(fixture));
      assert.ok(["accept", "refuse"].includes(fixture.expect));
    }
  }
  assert.equal(new Set(support.contracts.map(contract => contract.id)).size, support.contracts.length, "each contract once");
  for (const entry of support.entries) {
    if (entry.runtime === "portable") assert.deepEqual(keys(entry), ["export", "runtime"], JSON.stringify(entry));
    else assert.deepEqual([keys(entry), entry.runtime, entry.nodeRange.length > 0], [["export", "nodeRange", "runtime"], "node", true], JSON.stringify(entry));
  }
});

test("every schema the package exports is declared once by its own $id as a format it writes and reopens", () => {
  const schemaExports = Object.entries(pkg.exports).filter(([key]) => key.startsWith("./schemas/"));
  const own = support.contracts.filter(contract => contract.schemaExport.startsWith(OWN));
  assert.equal(own.length, schemaExports.length);
  for (const [key, target] of schemaExports) {
    const declared = own.filter(contract => contract.schemaExport === `${pkg.name}${key.slice(1)}`);
    assert.equal(declared.length, 1, key);
    assert.equal(declared[0].id, json(target).$id, key);
    assert.equal(declared[0].role, "both", `${key}: the Workbench writes and reopens its own formats`);
  }
});

test("every non-schema, non-data entry is declared once with its runtime; only the documented portable ones are portable", () => {
  const entryExports = Object.keys(pkg.exports).filter(key => !key.startsWith("./schemas/") && !key.startsWith("./fixtures/") && !key.endsWith(".json"));
  assert.deepEqual(support.entries.map(entry => entry.export).sort(), entryExports.map(key => `${pkg.name}${key.slice(1)}`).sort());
  assert.deepEqual(support.entries.filter(entry => entry.runtime === "portable").map(entry => entry.export).sort(), PORTABLE.map(key => `${pkg.name}${key.slice(1)}`).sort());
});

test("every fixture is this package's own export, resolves to a file and names its contract's schema", () => {
  for (const contract of support.contracts) for (const fixture of contract.fixtures) {
    assert.ok(fixture.export.startsWith(OWN), fixture.export);
    const target = exported(fixture.export);
    assert.ok(target && existsSync(join(repo, target)), `${fixture.export} resolves through the export map`);
    const value = json(target);
    if (fixture.expect === "accept") assert.equal(value.schema, contract.id, fixture.export);
  }
});

test("formats of other packages are declared by that package's own schema export, read or written as the Workbench does", () => {
  const foreign = support.contracts.filter(contract => !contract.schemaExport.startsWith(OWN));
  for (const contract of foreign) {
    const [, owner, name, version] = /^urn:aihq:([a-z]+):([a-z0-9-]+):(\d+\.\d+\.\d+)$/.exec(contract.id) ?? [];
    assert.equal(contract.schemaExport, `@aihq/${owner}/schemas/${name}/${version}.json`, contract.id);
    // A produced format carries the Workbench's own written example for its reader; an accepted one needs none.
    assert.equal(contract.fixtures.length > 0, contract.role === "produces", contract.id);
  }
  assert.deepEqual(foreign.map(contract => `${contract.role} ${contract.id}`).sort(), [
    "accepts urn:aihq:core:file-state-result:1.1.0",
    "accepts urn:aihq:core:native-verification-result:1.0.0",
    "produces urn:aihq:catalog:producer-declaration:3.1.0",
    "produces urn:aihq:core:execution-policy:1.3.0",
    "produces urn:aihq:core:organization-policy:1.1.0",
  ]);
});

// The Workbench's own reader for each of its formats. A record is read where the Workbench reads it: written into a
// journey envelope (with the suggestion a dismissal or trial names) and read back; a saved intent and its reviews
// through an unresolved draft; a workspace declaration and a local binding through the workspace validators.
async function readOwn(contract, value) {
  const { readJourneyEnvelope, writeJourneyEnvelope } = await import(pathToFileURL(join(repo, "tools/consumer/journey.mjs")).href);
  const { validateDeclaration, validateBinding } = await import(pathToFileURL(join(repo, "tools/consumer/workspace.mjs")).href);
  const encode = text => new TextEncoder().encode(text);
  if (contract.id === "urn:aihq:workbench:journey-envelope:1.0.0") return readJourneyEnvelope(encode(JSON.stringify(value)));
  const validator = { "urn:aihq:workbench:journey-record:workspace-declaration:1.0.0": validateDeclaration, "urn:aihq:workbench:journey-record:local-binding:1.0.0": validateBinding }[contract.id];
  if (validator) { const checked = await validator(value); return checked.valid ? { status: "ok" } : { status: "refused", diagnostics: [] }; }
  const savedIntentBytes = encode(JSON.stringify({ schema: "urn:aihq:core:execution-policy:1.3.0", mode: "personal", selections: [] }));
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", savedIntentBytes)).toString("hex");
  const draft = intent => ({ id: "draft", schema: "urn:aihq:workbench:journey-record:unresolved-draft:1.0.0", required: true, savedIntentSha256: sha256, intent });
  const savedIntent = json("fixtures/contracts/saved-intent/3.0.0/accept.json");
  const suggestion = json("fixtures/contracts/journey-record-improvement-suggestion/1.0.0/accept.json");
  const records = contract.id.endsWith(":saved-intent:3.0.0") ? [draft(value)]
    : contract.id.endsWith(":review-decisions:1.0.0") ? [draft({ ...savedIntent, reviews: value })]
    : /improvement-(dismissal|trial)/.test(contract.id) ? [suggestion, value] : [value];
  const written = await writeJourneyEnvelope({ savedIntentBytes, records });
  if (written.status !== "ok") return written;
  return readJourneyEnvelope(written.value.envelopeBytes);
}

test("each own-format fixture is read by the Workbench's own reader exactly as it declares", async () => {
  for (const contract of support.contracts.filter(item => item.schemaExport.startsWith(OWN))) {
    assert.ok(contract.fixtures.some(fixture => fixture.expect === "accept") && contract.fixtures.some(fixture => fixture.expect === "refuse"), contract.id);
    for (const fixture of contract.fixtures) {
      const result = await readOwn(contract, json(exported(fixture.export)));
      const accepted = result.status === "ok" && result.value?.supported !== false;
      assert.equal(accepted, fixture.expect === "accept", `${fixture.export}: ${JSON.stringify(result.diagnostics?.[0] ?? "")}`);
      if (fixture.code) assert.equal(result.diagnostics?.[0]?.code, fixture.code, fixture.export);
    }
  }
});

test("no fixture carries a machine-local path", () => {
  for (const contract of support.contracts) for (const fixture of contract.fixtures) {
    assert.doesNotMatch(readFileSync(join(repo, exported(fixture.export)), "utf8"), /\/(tmp|home|Users)\/|[A-Z]:\\\\/, fixture.export);
  }
});

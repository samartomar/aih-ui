// The Workbench's package-support fixtures: what it publishes and reads today, and what it will read.
// aih-ui.json follows the shape of Core's published `@aihq/core/schemas/package-support/1.0.0.json`
// (id, role and a resolvable schemaExport per contract; entries with their runtime), checked here by hand
// because this offline suite installs no Core. reads.json lists the contracts the screens read by the short
// names of the Workbench reads contract; planned reads have no schema to export yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = path => JSON.parse(readFileSync(join(repo, path), "utf8"));
const pkg = json("package.json");
const support = json("fixtures/package-support/aih-ui.json");
const reads = json("fixtures/package-support/reads.json");
const URN = /^urn:aihq:[a-z0-9-]+(:[a-z0-9-]+)*:\d+\.\d+\.\d+$/;
const ROLES = ["accepts", "produces", "both"];
// The packages entries README documents as portable (tools/tests/pure-imports.test.mjs keeps them so).
const PORTABLE = ["./journey", "./workspace", "./batch"];
const SHORT_NAMES = ["Idx", "Cat", "Reg", "Rdy", "Bind", "Comp", "Prev", "Run", "Inv", "Rem", "Sum", "Rec", "Pkg"];
const keys = value => Object.keys(value).sort();

test("aih-ui.json has exactly the package-support 1.0.0 shape", () => {
  assert.deepEqual(keys(support), ["contracts", "entries", "package", "schema"]);
  assert.equal(support.schema, "urn:aihq:package-support:1.0.0");
  assert.deepEqual(support.package, { name: pkg.name, version: pkg.version });
  for (const contract of support.contracts) {
    assert.deepEqual(keys(contract), ["id", "role", "schemaExport"], JSON.stringify(contract));
    assert.match(contract.id, URN);
    assert.ok(ROLES.includes(contract.role), contract.id);
    assert.ok(typeof contract.schemaExport === "string" && contract.schemaExport.length > 0, contract.id);
  }
  assert.equal(new Set(support.contracts.map(contract => contract.id)).size, support.contracts.length, "each contract once");
  for (const entry of support.entries) {
    if (entry.runtime === "portable") assert.deepEqual(keys(entry), ["export", "runtime"], JSON.stringify(entry));
    else {
      assert.deepEqual(keys(entry), ["export", "nodeRange", "runtime"], JSON.stringify(entry));
      assert.equal(entry.runtime, "node");
      assert.ok(entry.nodeRange.length > 0);
    }
  }
});

test("every schema the package exports is declared once, by its own $id, and resolves through the export map", () => {
  const schemaExports = Object.entries(pkg.exports).filter(([key]) => key.startsWith("./schemas/"));
  const own = support.contracts.filter(contract => contract.schemaExport.startsWith(`${pkg.name}/`));
  assert.equal(own.length, schemaExports.length);
  for (const [key, target] of schemaExports) {
    const declared = own.filter(contract => contract.schemaExport === `${pkg.name}${key.slice(1)}`);
    assert.equal(declared.length, 1, key);
    assert.equal(declared[0].id, json(target).$id, key);
    assert.equal(declared[0].role, "both", `${key}: the Workbench writes and reopens its own formats`);
  }
});

test("every non-schema entry is declared once with its runtime; only the documented portable ones are portable", () => {
  const entryExports = Object.keys(pkg.exports).filter(key => !key.startsWith("./schemas/"));
  assert.deepEqual(support.entries.map(entry => entry.export).sort(), entryExports.map(key => `${pkg.name}${key.slice(1)}`).sort());
  assert.deepEqual(support.entries.filter(entry => entry.runtime === "portable").map(entry => entry.export).sort(), PORTABLE.map(key => `${pkg.name}${key.slice(1)}`).sort());
});

test("contracts the Workbench accepts from another package name that package's own schema export", () => {
  for (const contract of support.contracts.filter(value => !value.schemaExport.startsWith(`${pkg.name}/`))) {
    assert.equal(contract.role, "accepts", contract.id);
    const [, owner, name, version] = /^urn:aihq:([a-z]+):([a-z0-9-]+):(\d+\.\d+\.\d+)$/.exec(contract.id) ?? [];
    assert.ok(owner, contract.id);
    assert.equal(contract.schemaExport, `@aihq/${owner}/schemas/${name}/${version}.json`);
  }
});

test("reads.json names every short name of the reads contract, and today's reads are the declared accepts", () => {
  assert.deepEqual(keys(reads), ["package", "reads", "schema"]);
  assert.equal(reads.package, pkg.name);
  for (const read of reads.reads) {
    assert.ok(["today", "planned"].includes(read.status), JSON.stringify(read));
    assert.ok(ROLES.includes(read.role), JSON.stringify(read));
    if (read.id === null) assert.ok(typeof read.unversioned === "string" && read.unversioned.length > 0, `${read.short} says why it has no id`);
    else assert.match(read.id, URN);
  }
  const ids = reads.reads.filter(read => read.id !== null).map(read => read.id);
  assert.equal(new Set(ids).size, ids.length, "each contract version once");
  assert.deepEqual([...new Set(reads.reads.filter(read => read.short !== null).map(read => read.short))].sort(), [...SHORT_NAMES].sort());
  assert.ok(reads.reads.filter(read => read.short !== null).every(read => read.status === "planned"), "no contract read of the new screens exists yet");
  const accepted = support.contracts.filter(contract => contract.role === "accepts").map(contract => contract.id).sort();
  assert.deepEqual(reads.reads.filter(read => read.status === "today").map(read => read.id).sort(), accepted);
});

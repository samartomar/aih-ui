import { test } from "node:test";
import assert from "node:assert/strict";
import { contractCheckSummary } from "../../tools/server/contract-check-summary.mjs";
import { CONTRACT_CHECK_ABSENT, contractCheckView } from "../../src/app/contract-check.js";

test("the summary keeps absent, ran, invalid and unknown apart and never turns a failure into absent", () => {
  assert.deepEqual(contractCheckSummary({ ok: true, state: "absent" }), { state: "absent" });
  assert.deepEqual(contractCheckSummary({ ok: true, state: "unknown", reason: "could not load" }), { state: "unknown", reason: "could not load" });
  assert.deepEqual(contractCheckSummary({ ok: false, error: "unknown op: contractCheck" }), { state: "unknown", reason: "unknown op: contractCheck" });
  assert.equal(contractCheckSummary(undefined).state, "unknown");
  assert.deepEqual(contractCheckSummary({ ok: true, state: "invalid", diagnostics: [{ code: "INPUT_INVALID", path: "/contracts/0", message: "x" }] }),
    { state: "invalid", diagnostics: [{ code: "INPUT_INVALID", path: "/contracts/0" }] });
  const ran = contractCheckSummary({ ok: true, state: "ran", versions: { "@aihq/core": "1" }, packages: [{ name: "@aihq/core", status: "found", version: "1", schema: "s", from: "f", extra: "/tmp/x" }],
    checks: [{ contractId: "c", readerPackage: "r", fixturePackage: "f", status: "passed", local: "/tmp/x" }] });
  assert.deepEqual(ran.checks, [{ contractId: "c", readerPackage: "r", fixturePackage: "f", status: "passed" }], "only the fields Core reports reach the page");
  assert.equal(JSON.stringify(ran).includes("/tmp/x"), false);
});

test("the message words each state, and only a package that refuses a fixture says to update it", () => {
  assert.equal(contractCheckView(undefined).state, "loading");
  assert.deepEqual([contractCheckView({ ok: true, state: "absent" }).state, contractCheckView({ ok: true, state: "absent" }).words], ["unavailable", CONTRACT_CHECK_ABSENT]);
  assert.equal(CONTRACT_CHECK_ABSENT, "This Core can't check contracts yet.");
  assert.equal(contractCheckView({ ok: false, error: "boom" }).state, "failed");
  assert.equal(contractCheckView({ ok: true, state: "ran", checks: [] }).state, "empty");
  const versions = { "@aihq/core": "1.0.0", "@aihq/catalog": "0.1.0" };
  const refused = contractCheckView({ ok: true, state: "ran", versions, checks: [
    { contractId: "urn:aihq:core:execution-policy:1.3.0", readerPackage: "@aihq/core", fixturePackage: "example", updatePackage: "@aihq/core", status: "failed" },
    { contractId: "urn:aihq:core:recipe:1.0.0", readerPackage: "@aihq/catalog", fixturePackage: "@aihq/core", status: "unavailable", reason: "reader-missing" },
  ] });
  assert.equal(refused.state, "cant-read");
  assert.equal(refused.words, "@aihq/core 1.0.0 can't read urn:aihq:core:execution-policy:1.3.0; update @aihq/core.");
  assert.ok(refused.detail.some(line => line.startsWith("Can't check that @aihq/catalog 0.1.0 reads urn:aihq:core:recipe:1.0.0")));
  const unavailable = contractCheckView({ ok: true, state: "ran", versions, checks: [{ contractId: "x", readerPackage: "@aihq/catalog", fixturePackage: "@aihq/core", status: "unavailable", reason: "reader-missing" }, { status: "passed" }] });
  assert.deepEqual([unavailable.state, unavailable.words], ["unavailable", "1 contract check can't run."]);
  assert.equal(contractCheckView({ ok: true, state: "ran", checks: [{ status: "passed" }] }).state, "passed");
  for (const view of [refused, unavailable]) assert.ok(view.detail.includes("Nothing is blocked; everything keeps working as before."));
});

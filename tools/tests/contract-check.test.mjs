import { test } from "node:test";
import assert from "node:assert/strict";
import { contractCheckSummary } from "../../tools/server/contract-check-summary.mjs";
import { CONTRACT_CHECK_ABSENT, contractCheckNote } from "../../src/catalog/provenance.js";

function element(tag) {
  return { tagName: tag, children: [], dataset: {}, attributes: {}, className: "", textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attributes[name] = value; } };
}
function withDocument(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
}

test("the summary keeps absent, available and unknown apart and never turns a failure into absent", () => {
  assert.deepEqual(contractCheckSummary({ ok: true, state: "absent", entries: ["@aihq/core/contracts"] }), { state: "absent" });
  assert.deepEqual(contractCheckSummary({ ok: true, state: "available", entry: "@aihq/core/contracts" }), { state: "available", entry: "@aihq/core/contracts" });
  assert.deepEqual(contractCheckSummary({ ok: true, state: "unknown", reason: "could not load" }), { state: "unknown", reason: "could not load" });
  assert.deepEqual(contractCheckSummary({ ok: false, error: "unknown op: contractCheck" }), { state: "unknown", reason: "unknown op: contractCheck" });
  assert.equal(contractCheckSummary(undefined).state, "unknown");
});

test("a Core without checkContracts gets the contract's wording once, as information that blocks nothing", (t) => {
  withDocument(t);
  assert.equal(CONTRACT_CHECK_ABSENT, "This Core can't check contracts yet.");
  const note = contractCheckNote({ state: "absent" });
  assert.equal(note.children[1].textContent, CONTRACT_CHECK_ABSENT);
  assert.equal(note.children[0].attributes["aria-hidden"], "true");
  assert.equal(note.children[0].dataset.icon, "state:info");
  assert.match(note.className, /bg-info-bg text-info/);
  assert.equal(note.attributes.role, "note");
  assert.match(note.title, /Nothing is blocked/);
  for (const state of [undefined, { state: "available", entry: "@aihq/core/contracts" }, { state: "unknown", reason: "x" }]) assert.equal(contractCheckNote(state), null);
});

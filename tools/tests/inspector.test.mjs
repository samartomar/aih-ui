import { test } from "node:test";
import assert from "node:assert/strict";
import { row, codeRow } from "../../src/governance/rows.js";
import { bytesToBase64, downloadBase64 } from "../../src/governance/bytes.js";

function element(tag) {
  return {
    tagName: tag, children: [], className: "", textContent: "",
    appendChild(child) { this.children.push(child); return child; },
  };
}

function useDocument(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
}

test("published code values remain exact text, including markup and line breaks", (t) => {
  useDocument(t);
  const value = 'source/<script>alert(1)</script>\nsha256:0123456789';
  const parent = element("div");
  const rendered = codeRow(parent, "Path", value);
  assert.equal(parent.children[0], rendered);
  assert.match(rendered.className, /inspector-row-code/);
  assert.equal(rendered.children[1].tagName, "code");
  assert.equal(rendered.children[1].textContent, value);
  assert.equal(rendered.children[1].children.length, 0);
});

test("missing code values retain their absence label and status rows retain their tone", (t) => {
  useDocument(t);
  for (const value of [null, undefined, ""]) {
    const rendered = codeRow(element("div"), "Digest", value, "Not published");
    assert.doesNotMatch(rendered.className, /inspector-row-code/);
    assert.equal(rendered.children[1].tagName, "span");
    assert.equal(rendered.children[1].textContent, "Not published");
  }
  const status = row(element("div"), "Binding", "refused", "Not supplied", "text-error");
  assert.equal(status.children[1].className, "text-error");
  assert.equal(status.children[1].textContent, "refused");
});

test("Governance download hands the original bytes to the browser", async (t) => {
  useDocument(t);
  const bytes = new TextEncoder().encode('{"name":"café","path":"a/b"}\n');
  let downloadedBlob;
  let clicked = false;
  let revoked;
  const anchor = { click() { clicked = true; } };
  document.createElement = (tag) => { assert.equal(tag, "a"); return anchor; };
  t.mock.method(URL, "createObjectURL", (blob) => { downloadedBlob = blob; return "blob:inspector-test"; });
  t.mock.method(URL, "revokeObjectURL", (url) => { revoked = url; });
  downloadBase64("governance-input.json", bytesToBase64(bytes));
  assert.equal(clicked, true);
  assert.equal(anchor.download, "governance-input.json");
  assert.equal(anchor.href, "blob:inspector-test");
  assert.equal(revoked, anchor.href);
  assert.equal(downloadedBlob.type, "application/json");
  assert.deepEqual(new Uint8Array(await downloadedBlob.arrayBuffer()), bytes);
});

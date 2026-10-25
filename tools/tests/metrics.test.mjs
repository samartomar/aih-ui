import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetrics } from "../../src/catalog/metrics.js";

function element(tag) {
  return {
    tagName: tag, children: [], dataset: {}, attributes: {}, listeners: {}, style: {},
    className: "", textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

test("command and hook tiles count the listed scope; tokens are unknown, not published", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  const container = element("div"), toggled = [];
  createMetrics({ container, onToggleKind: kind => toggled.push(kind) })
    .render({ kindCounts: new Map([["skill", 5], ["command", 100], ["hook", 7]]), total: 112, activeKind: null });
  const tiles = Object.fromEntries(container.children.map(tile => [tile.dataset.metric, tile]));
  const texts = tile => descendants(tile).map(e => e.textContent);
  assert.ok(texts(tiles.command).includes("100"));
  assert.ok(texts(tiles.hook).includes("7"));
  assert.ok(texts(tiles.hook).includes("Hook Items") && texts(tiles.hook).includes("items, not events"));
  assert.equal(tiles.command.disabled, undefined);
  tiles.hook.listeners.click(); tiles.command.listeners.click();
  assert.deepEqual(toggled, ["hook", "command"]);
  assert.equal(tiles.tokens.disabled, undefined, "greyed, not disabled, so its tooltip stays reachable by keyboard");
  assert.ok(texts(tiles.tokens).includes("Unknown"));
  for (const tile of container.children) assert.equal(texts(tile).includes("Not published"), false);
});

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
    querySelectorAll(selector) {
      assert.equal(selector, '.material-symbols-outlined');
      return this.children.flatMap(descendants).filter(node => node.className.split(' ').includes('material-symbols-outlined'));
    },
  };
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

test("metrics count actual inventory kinds and omit unmeasured token tiles", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  const container = element("div"), toggled = [];
  createMetrics({ container, onToggleKind: kind => toggled.push(kind) })
    .render({ kindCounts: new Map([["skill", 5], ["command", 100], ["hook", 7], ["package", 2], ["profile", 3]]), total: 117, activeKind: null });
  const tiles = Object.fromEntries(container.children.map(tile => [tile.dataset.metric, tile]));
  const texts = tile => descendants(tile).map(e => e.textContent);
  assert.equal(texts(tiles.command).filter(value => value === "100").length, 1);
  assert.match(tiles.command.attributes["aria-label"], /Commands: 100.*Filter/);
  assert.ok(texts(tiles.hook).includes("7"));
  assert.ok(texts(tiles.hook).includes("Hook Items") && texts(tiles.hook).includes("items, not events"));
  assert.match(tiles.hook.attributes['aria-label'], /Hook Items: 7\. items, not events\./);
  assert.match(tiles.hook.children[1].className, /flex-wrap/);
  assert.equal(descendants(tiles.hook).find(node => node.textContent === 'items, not events').className.includes('whitespace-nowrap'), false);
  assert.equal(tiles.command.disabled, undefined);
  tiles.hook.listeners.click(); tiles.command.listeners.click();
  assert.deepEqual(toggled, ["hook", "command"]);
  assert.deepEqual(Object.keys(tiles), ['skill', 'command', 'hook', 'package', 'profile']);
  assert.equal(tiles.tokens, undefined);
  assert.ok(texts(tiles.package).includes('Packages') && texts(tiles.package).includes('2'));
  assert.ok(texts(tiles.profile).includes('Profiles') && texts(tiles.profile).includes('3'));
  for (const tile of container.children) {
    const glyph = descendants(tile).find(node => node.className.includes('material-symbols-outlined'));
    assert.equal(glyph.attributes['aria-hidden'], 'true');
  }
  for (const tile of container.children) assert.equal(texts(tile).includes("Not published"), false);
});

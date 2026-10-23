import { test } from "node:test";
import assert from "node:assert/strict";
import { attachTooltip } from "../../src/app/tooltip.js";

// A small DOM: enough for ids, attributes, children, listeners and a focus-visible match.
function fakeDocument() {
  const all = [];
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, listeners: {}, style: {}, className: "", textContent: "",
      hidden: false, title: "", parent: null, focusVisible: true,
      get id() { return this.attributes.id ?? ""; }, set id(value) { this.attributes.id = value; },
      get isConnected() { let node = this; while (node.parent) node = node.parent; return node === doc.body; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
      appendChild(child) { child.parent = this; this.children.push(child); return child; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
      addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); },
      dispatch(name, event = {}) { for (const callback of this.listeners[name] ?? []) callback({ type: name, ...event }); },
      matches(selector) { return selector === ":focus-visible" ? this.focusVisible : false; },
      getBoundingClientRect() { return { left: 10, top: 10, bottom: 30, right: 60 }; },
    };
    all.push(node);
    return node;
  };
  const doc = {
    createElement: make,
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    getElementById(id) { return all.find(node => node.id === id && node.isConnected) ?? null; },
    querySelector(selector) {
      const id = /aria-describedby~="([^"]+)"/.exec(selector)?.[1];
      return all.find(node => node.isConnected && (node.getAttribute("aria-describedby") ?? "").split(" ").includes(id)) ?? null;
    },
  };
  doc.body = make("body");
  return doc;
}
function withDocument(t, doc) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = doc;
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
}
const bubble = doc => doc.getElementById("wb-tooltip");

test("a tooltip sets title and an aria-describedby description held in one hidden container", (t) => {
  const doc = fakeDocument(); withDocument(t, doc);
  const a = doc.body.appendChild(doc.createElement("button"));
  const b = doc.body.appendChild(doc.createElement("button"));
  attachTooltip(a, "Skill: 5 items");
  attachTooltip(b, "Skill: 5 items");
  assert.equal(a.title, "Skill: 5 items");
  const id = a.getAttribute("aria-describedby");
  const description = doc.getElementById(id);
  assert.equal(description.textContent, "Skill: 5 items");
  assert.equal(description.parent.hidden, true, "visually hidden, still referenced");
  assert.equal(b.getAttribute("aria-describedby"), id, "the same text shares one description node");
  attachTooltip(a, "Skill: 6 items");
  assert.notEqual(a.getAttribute("aria-describedby"), id, "new text replaces the old link instead of adding to it");
  assert.equal(a.getAttribute("aria-describedby").split(" ").length, 1);
});

test("an icon-only control gets its label, and another description it already had is kept", (t) => {
  const doc = fakeDocument(); withDocument(t, doc);
  const button = doc.body.appendChild(doc.createElement("button"));
  button.setAttribute("aria-describedby", "own-help");
  attachTooltip(button, "Close the inspector", { label: "Close inspector" });
  assert.equal(button.getAttribute("aria-label"), "Close inspector");
  assert.match(button.getAttribute("aria-describedby"), /^own-help wb-tip-\d+$/);
});

test("keyboard focus and touch show the same words in one bubble; blur, Escape and pointer exit hide it", (t) => {
  const doc = fakeDocument(); withDocument(t, doc);
  const button = doc.body.appendChild(doc.createElement("button"));
  attachTooltip(button, "Hook: 7 items");
  button.dispatch("focus");
  assert.equal(bubble(doc).hidden, false);
  assert.equal(bubble(doc).textContent, "Hook: 7 items");
  assert.equal(bubble(doc).getAttribute("aria-hidden"), "true", "the description already carries the words");
  assert.equal(bubble(doc).style.top, "36px");
  button.dispatch("keydown", { key: "Escape" });
  assert.equal(bubble(doc).hidden, true);
  button.focusVisible = false;
  button.dispatch("focus");
  assert.equal(bubble(doc).hidden, true, "a mouse click's focus relies on the hover title");
  button.dispatch("pointerdown", { pointerType: "mouse" });
  assert.equal(bubble(doc).hidden, true);
  button.dispatch("pointerdown", { pointerType: "touch" });
  assert.equal(bubble(doc).hidden, false);
  button.dispatch("mouseleave");
  assert.equal(bubble(doc).hidden, true);
  button.dispatch("focus"); button.dispatch("blur");
  assert.equal(bubble(doc).hidden, true);
  assert.equal(button.listeners.focus.length, 1, "attaching again does not stack listeners");
});

test("without a page only the title and label are set", (t) => {
  withDocument(t, { createElement: () => ({}) });
  const node = { dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  attachTooltip(node, "  Tokens: unknown.  ", { label: "Tokens" });
  assert.equal(node.title, "Tokens: unknown.");
  assert.equal(node.attributes["aria-label"], "Tokens");
  assert.equal(node.attributes["aria-describedby"], undefined);
  const empty = { dataset: {}, setAttribute() {} };
  attachTooltip(empty, "");
  assert.equal(empty.title, undefined, "no empty tooltip");
});

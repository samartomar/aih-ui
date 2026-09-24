import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "../server/settings.mjs";
import { CAPABILITIES, emptySettings, newSetupSettings, settingsErrors } from "../../src/app/setup-model.js";
import { createApi } from "../server/api.mjs";
import { createStaticServer, listen } from "../server/static.mjs";

const testRoot = fileURLToPath(new URL("../../.tmp/", import.meta.url));
const coreTargets = { state: "published", targets: ["fixture-client-a", "fixture-client-b"] };
const vibe = () => ({ ...emptySettings(), experience: "vibe" });
const enterprise = (role = "admin") => ({ ...emptySettings(), experience: "enterprise", role, organization: { name: "Setup fixture", shortId: "setup-fixture", policyRepo: "github.com/example/policy", emails: ["admin@example.com"] }, capabilities: ["headroom"], clients: ["fixture-client-a"] });
function fixture(t, targets = coreTargets) {
  mkdirSync(testRoot, { recursive: true });
  const directory = mkdtempSync(join(testRoot, "settings-test-"));
  const settingsPath = join(directory, "settings.v1.json");
  t.after(() => {
    // Only direct files created by this test; no recursive removal.
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isDirectory()) rmdirSync(join(directory, item.name));
      else unlinkSync(join(directory, item.name));
    }
    rmdirSync(directory);
  });
  return { store: createSettingsStore({ coreTargets: targets, settingsPath }), settingsPath, directory };
}

test("first run is missing; Vibe settings survive reopening the store", (t) => {
  const { store, settingsPath } = fixture(t);
  assert.equal(store.read().state, "missing");
  assert.equal(store.create(vibe()).ok, true);
  assert.deepEqual(createSettingsStore({ coreTargets, settingsPath }).read().settings, vibe());
});

test("Admin and Developer records preserve explicit capabilities and clients", (t) => {
  const { store } = fixture(t);
  const settings = enterprise();
  assert.deepEqual(store.create(settings).settings, settings);
  assert.deepEqual(fixture(t).store.create(enterprise("developer")).settings, enterprise("developer"));
});

test("deleting the fixed file returns the store to first-run state", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(enterprise());
  unlinkSync(settingsPath);
  assert.equal(store.read().state, "missing");
});

test("invalid setup never creates a file", (t) => {
  const { store, settingsPath } = fixture(t);
  for (const settings of [null, [], {}, { ...vibe(), version: 999 }, { ...enterprise(), role: "owner" }, { ...vibe(), capabilities: ["unpublished" ] }, { ...vibe(), path: "../elsewhere.json" }]) {
    assert.equal(store.create(settings).ok, false);
    assert.equal(existsSync(settingsPath), false);
  }
});

test("organization validation rejects missing details, malformed and duplicate emails", () => {
  for (const patch of [{ name: "" }, { shortId: "../name" }, { policyRepo: "file:///other/settings" }, { emails: ["bad"] }, { emails: ["a@example.com", "A@example.com"] }, { emails: [] }]) {
    const settings = enterprise();
    Object.assign(settings.organization, patch);
    assert.ok(Object.keys(settingsErrors(settings)).length);
  }
  const developer = enterprise("developer");
  developer.organization.emails = [];
  assert.deepEqual(settingsErrors(developer), {});
});

test("saved experience cannot be replaced through setup; client updates preserve it", (t) => {
  const { store, settingsPath, directory } = fixture(t);
  store.create(enterprise());
  const original = readFileSync(settingsPath, "utf8");
  assert.equal(store.create(vibe()).status, 409);
  assert.equal(store.updateClients({ clients: ["unknown"] }).ok, false);
  assert.equal(store.updateClients({ clients: [], role: "developer" }).ok, false);
  assert.equal(readFileSync(settingsPath, "utf8"), original);
  const updated = store.updateClients({ clients: ["fixture-client-b"] });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.settings, { ...enterprise(), clients: ["fixture-client-b"] });
  assert.deepEqual(readdirSync(directory), ["settings.v1.json"]);
});

test("an unavailable Core client list permits skipping but does not invent targets", (t) => {
  const { store } = fixture(t, { state: "unavailable" });
  assert.equal(store.create(enterprise()).ok, false);
  assert.equal(store.create(vibe()).ok, true);
});

test("existing client choices survive when a later Core list omits them", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(enterprise());
  const later = createSettingsStore({ settingsPath, coreTargets: { state: "published", targets: ["fixture-client-b"] } });
  assert.equal(later.read().state, "saved");
  assert.deepEqual(later.updateClients({ clients: ["fixture-client-a", "fixture-client-b"] }).settings.clients, ["fixture-client-a", "fixture-client-b"]);
  assert.equal(later.updateClients({ clients: ["invented"] }).ok, false);
});

test("malformed and unsupported saved files require setup, without changing their bytes", (t) => {
  const { store, settingsPath } = fixture(t);
  for (const contents of ["{bad", JSON.stringify({ ...vibe(), version: 99 })]) {
    writeFileSync(settingsPath, contents);
    assert.equal(store.read().state, "invalid");
    assert.equal(readFileSync(settingsPath, "utf8"), contents);
  }
  assert.equal(store.create(vibe()).ok, true);
});

test("oversized or unexpected values are rejected", () => {
  assert.ok(settingsErrors({ ...vibe(), clients: ["a".repeat(255)] }).clients);
  assert.ok(settingsErrors({ ...vibe(), clients: ["same", "same"] }).clients);
  assert.ok(settingsErrors({ ...enterprise(), organization: { ...enterprise().organization, secret: "not a settings field" } }).organization);
});

test("all current assistance choices default on only in new drafts", () => {
  const first = newSetupSettings();
  assert.equal(first.capabilities.length, 6);
  assert.deepEqual(first.capabilities, CAPABILITIES.map(({ id }) => id));
  first.capabilities.pop();
  assert.equal(newSetupSettings().capabilities.length, 6);
  assert.deepEqual(emptySettings().capabilities, []);
});

test("every store response supplies the actual absolute settings path", (t) => {
  const { store, settingsPath } = fixture(t);
  assert.equal(isAbsolute(store.read().location), true);
  assert.equal(store.read().location, settingsPath);
  assert.equal(store.create(vibe()).location, settingsPath);
  assert.equal(store.update(vibe()).location, settingsPath);
  assert.equal(store.updateClients({ clients: [] }).location, settingsPath);
  writeFileSync(settingsPath, "malformed");
  assert.equal(store.read().location, settingsPath);
});

test("editing organization, contacts, assistance and clients persists atomically", (t) => {
  for (const role of ["admin", "developer"]) {
    const { store, settingsPath, directory } = fixture(t);
    store.create(enterprise(role));
    const next = enterprise(role);
    Object.assign(next.organization, { name: "Edited organization", shortId: "edited-org", policyRepo: "github.com/example/updated-policy", emails: ["new@example.com"] });
    next.capabilities = [];
    next.clients = ["fixture-client-b"];
    assert.deepEqual(store.update(next).settings, next);
    assert.deepEqual(createSettingsStore({ settingsPath, coreTargets }).read().settings, next);
    assert.deepEqual(readdirSync(directory), ["settings.v1.json"]);
  }
});

test("update refuses persona and enterprise role changes without touching saved bytes", (t) => {
  for (const initial of [vibe(), enterprise("admin"), enterprise("developer")]) {
    const { store, settingsPath } = fixture(t);
    store.create(initial);
    const before = readFileSync(settingsPath, "utf8");
    const alternatives = [vibe(), enterprise("admin"), enterprise("developer")].filter((next) => next.experience !== initial.experience || next.role !== initial.role);
    for (const next of alternatives) assert.equal(store.update(next).status, 409);
    assert.equal(readFileSync(settingsPath, "utf8"), before);
  }
});

test("editing preserves deliberately empty choices and previously saved unlisted clients", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(vibe());
  assert.deepEqual(store.read().settings.capabilities, []);
  assert.deepEqual(store.update(vibe()).settings.capabilities, []);
  const selected = { ...vibe(), clients: ["fixture-client-a"] };
  store.update(selected);
  const later = createSettingsStore({ settingsPath, coreTargets: { state: "unavailable" } });
  assert.deepEqual(later.update({ ...selected, capabilities: ["headroom"] }).settings.clients, selected.clients);
  assert.equal(later.update({ ...selected, clients: ["invented"] }).ok, false);
});

test("missing, invalid or deleted setup cannot be recreated by edit", (t) => {
  const { store, settingsPath } = fixture(t);
  assert.equal(store.update(vibe()).status, 409);
  assert.equal(existsSync(settingsPath), false);
  store.create(enterprise());
  const before = readFileSync(settingsPath, "utf8");
  for (const next of [null, {}, { ...enterprise(), capabilities: ["invented"] }, { ...enterprise(), clients: ["invented"] }, { ...enterprise(), organization: { ...enterprise().organization, emails: ["bad"] } }]) {
    assert.equal(store.update(next).ok, false);
    assert.equal(readFileSync(settingsPath, "utf8"), before);
  }
  unlinkSync(settingsPath);
  assert.equal(store.update(enterprise()).status, 409);
  assert.equal(existsSync(settingsPath), false);
});

test("settings update HTTP route enforces JSON, same origin and fixed persona", async (t) => {
  const { store, settingsPath, directory } = fixture(t);
  store.create(enterprise());
  const api = createApi({ consumerDir: directory, runDir: directory, summary: { coreTargets }, settingsPath });
  const server = createStaticServer(directory, api);
  const address = await listen(server, 0);
  t.after(() => new Promise((resolveClose) => { server.closeAllConnections(); server.close(resolveClose); }));
  const base = `http://127.0.0.1:${address.port}`;
  const request = (settings, headers = {}) => fetch(`${base}/api/workbench-settings/update`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(settings),
  });
  assert.equal((await request(enterprise(), { origin: "https://example.com" })).status, 403);
  assert.equal((await request(enterprise(), { "content-type": "text/plain" })).status, 415);
  assert.equal((await request(vibe())).status, 409);
  const next = { ...enterprise(), capabilities: [] };
  const response = await request(next, { origin: base });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).settings, next);
  const reopened = await fetch(`${base}/api/workbench-settings`).then((result) => result.json());
  assert.equal(reopened.location, settingsPath);
  assert.deepEqual(reopened.settings.capabilities, []);
});

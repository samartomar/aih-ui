import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "../server/settings.mjs";
import * as setupModel from "../../src/app/setup-model.js";
import { emptySettings, newSetupSettings, reviewerErrors, settingsErrors, setupSteps } from "../../src/app/setup-model.js";
import { createApi } from "../server/api.mjs";
import { createStaticServer, listen } from "../server/static.mjs";

const testRoot = fileURLToPath(new URL("../../.tmp/", import.meta.url));
// Core's tool list as GET /api/tools answers it: setup's tools are checked against it.
const tools = { state: "published", tools: [{ id: "fixture-client-a", label: "Fixture A" }, { id: "fixture-client-b", label: "Fixture B" }] };
const vibe = () => ({ ...emptySettings(), experience: "vibe" });
const enterprise = (role = "admin") => ({ ...emptySettings(), experience: "enterprise", role, organization: { name: "Setup fixture", shortId: "setup-fixture", policyRepo: "github.com/example/policy", emails: ["admin@example.com"] }, capabilities: ["headroom"], clients: ["fixture-client-a"] });
function fixture(t, targets = tools) {
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
  return { store: createSettingsStore({ tools: targets, settingsPath }), settingsPath, directory };
}

test("first run is missing; Vibe settings survive reopening the store", (t) => {
  const { store, settingsPath } = fixture(t);
  assert.equal(store.read().state, "missing");
  assert.equal(store.create(vibe()).ok, true);
  assert.deepEqual(createSettingsStore({ tools, settingsPath }).read().settings, vibe());
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
  const later = createSettingsStore({ settingsPath, tools: { state: "published", tools: [{ id: "fixture-client-b" }] } });
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

test("new setup does not request unconnected assistance without a choice", () => {
  const first = newSetupSettings();
  assert.deepEqual(first.capabilities, []);
  first.capabilities.push("code-review");
  assert.deepEqual(newSetupSettings().capabilities, []);
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
    assert.deepEqual(createSettingsStore({ settingsPath, tools }).read().settings, next);
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
  const later = createSettingsStore({ settingsPath, tools: { state: "unavailable" } });
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
  const api = createApi({ consumerDir: directory, runDir: directory, summary: {}, tools: async () => tools, settingsPath });
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

const withReviewer = (settings, reviewer = { kind: "individual", id: "alice" }) => ({ ...settings, reviewer });

test("mode switching saves all three modes and preserves the latest unrelated preferences", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(withReviewer({ ...vibe(), capabilities: ["headroom"], clients: ["fixture-client-a"] }));
  // A client change made while a mode popup is open must survive its save.
  store.updateClients({ clients: ["fixture-client-b"] });
  const modes = [
    { experience: "enterprise", role: "admin", organization: enterprise().organization },
    { experience: "enterprise", role: "developer", organization: null },
    { experience: "vibe", role: null, organization: null },
  ];
  for (const mode of modes) {
    const result = store.switchMode(mode);
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings, withReviewer({ ...vibe(), ...mode, capabilities: ["headroom"], clients: ["fixture-client-b"] }));
    assert.deepEqual(createSettingsStore({ tools, settingsPath }).read().settings, result.settings);
  }
  assert.deepEqual(readdirSync(join(settingsPath, "..")), ["settings.v1.json"]);
});

test("invalid mode changes leave saved setup bytes unchanged", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(vibe());
  const before = readFileSync(settingsPath, "utf8");
  for (const body of [null, [], {},
    { experience: "enterprise", role: "admin", organization: null },
    { experience: "enterprise", role: "admin", organization: { ...enterprise().organization, emails: [] } },
    { experience: "enterprise", role: "owner", organization: null },
    { experience: "vibe", role: "admin", organization: null },
    { experience: "enterprise", role: "developer", organization: enterprise().organization },
    { experience: "vibe", role: null, organization: null, clients: [] },
  ]) {
    assert.equal(store.switchMode(body).ok, false);
    assert.equal(readFileSync(settingsPath, "utf8"), before);
  }
});

test("mode changes require saved setup and preserve clients no longer published by Core", (t) => {
  const { store, settingsPath } = fixture(t);
  const mode = { experience: "enterprise", role: "developer", organization: null };
  assert.equal(store.switchMode(mode).status, 409);
  store.create({ ...vibe(), clients: ["fixture-client-a"] });
  const offline = createSettingsStore({ tools: null, settingsPath });
  assert.deepEqual(offline.switchMode(mode).settings.clients, ["fixture-client-a"]);
});

test("mode HTTP route enforces origin and JSON and validates required Admin details", async (t) => {
  const { store, settingsPath, directory } = fixture(t);
  store.create(vibe());
  const server = createStaticServer(directory, createApi({ summary: {}, tools: async () => tools, settingsPath }));
  const address = await listen(server, 0);
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${address.port}`;
  const mode = { experience: "enterprise", role: "admin", organization: enterprise().organization };
  const post = (body, headers = {}) => fetch(`${base}/api/workbench-settings/mode`, {
    method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post(mode, { origin: "https://example.com" })).status, 403);
  assert.equal((await post(mode, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post({ ...mode, organization: null })).status, 422);
  assert.deepEqual(store.read().settings, vibe());
  assert.equal((await post(mode)).status, 200);
  assert.deepEqual((await fetch(`${base}/api/workbench-settings`).then(r => r.json())).settings, { ...vibe(), ...mode });
});

test("an optional reviewing identity saves, reopens in a new store and clears on update", (t) => {
  const { store, settingsPath } = fixture(t);
  const saved = withReviewer(vibe());
  assert.deepEqual(store.create(saved).settings, saved);
  assert.deepEqual(createSettingsStore({ tools, settingsPath }).read().settings, saved);
  const organization = withReviewer(vibe(), { kind: "organization", id: "Platform Team" });
  assert.deepEqual(store.update(organization).settings.reviewer, { kind: "organization", id: "Platform Team" });
  assert.deepEqual(createSettingsStore({ tools, settingsPath }).read().settings, organization);
  const cleared = store.update(vibe());
  assert.equal(cleared.ok, true);
  assert.equal(Object.hasOwn(cleared.settings, "reviewer"), false);
  const reopened = createSettingsStore({ tools, settingsPath }).read();
  assert.equal(reopened.state, "saved");
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(settingsPath, "utf8")), "reviewer"), false);
  assert.deepEqual(reopened.settings, vibe());
});

test("a reviewing identity needs a known kind and a bounded trimmed identity, and refusals never write", (t) => {
  const bad = [
    { kind: "robot", id: "alice" }, { kind: "individual" }, { id: "alice" }, { kind: "individual", id: "" }, { kind: "individual", id: " " },
    { kind: "individual", id: " alice" }, { kind: "individual", id: "alice " }, { kind: "individual", id: "a".repeat(255) },
    { kind: "individual", id: "al\nice" }, { kind: "individual", id: "al\u0000ice" }, { kind: "individual", id: 7 },
    { kind: "individual", id: "alice", extra: true }, null, "alice", [], undefined,
  ];
  const { store, settingsPath } = fixture(t);
  for (const reviewer of bad) {
    assert.ok(Object.keys(settingsErrors({ ...vibe(), reviewer })).length, JSON.stringify(reviewer));
    assert.equal(store.create({ ...vibe(), reviewer }).ok, false);
    assert.equal(existsSync(settingsPath), false);
  }
  assert.deepEqual(settingsErrors(withReviewer(vibe(), { kind: "individual", id: "a".repeat(254) })), {});
  assert.deepEqual(settingsErrors(withReviewer(vibe(), { kind: "organization", id: "team one" })), {});
  assert.ok(reviewerErrors({ kind: "individual", id: "" }).reviewer);
  assert.deepEqual(reviewerErrors(undefined), {});
  store.create(withReviewer(vibe()));
  const before = readFileSync(settingsPath, "utf8");
  for (const reviewer of bad) {
    assert.equal(store.update({ ...vibe(), reviewer }).ok, false);
    assert.equal(readFileSync(settingsPath, "utf8"), before);
  }
});

test("a legacy settings file without a reviewer still reads as saved and gains none", (t) => {
  const { store, settingsPath } = fixture(t);
  const legacy = JSON.stringify(enterprise(), null, 2);
  assert.equal(Object.keys(JSON.parse(legacy)).length, 7);
  writeFileSync(settingsPath, `${legacy}\n`);
  const read = store.read();
  assert.equal(read.state, "saved");
  assert.equal(Object.hasOwn(read.settings, "reviewer"), false);
  assert.equal(store.updateClients({ clients: ["fixture-client-b"] }).ok, true);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(settingsPath, "utf8")), "reviewer"), false);
});

test("a client change keeps the saved reviewing identity", (t) => {
  const { store, settingsPath } = fixture(t);
  store.create(withReviewer(enterprise()));
  const updated = store.updateClients({ clients: ["fixture-client-b"] });
  assert.deepEqual(updated.settings.reviewer, { kind: "individual", id: "alice" });
  assert.deepEqual(createSettingsStore({ tools, settingsPath }).read().settings, { ...withReviewer(enterprise()), clients: ["fixture-client-b"] });
});

test("the settings HTTP route saves and clears the reviewing identity", async (t) => {
  const { store, directory } = fixture(t);
  store.create(enterprise());
  const api = createApi({ consumerDir: directory, runDir: directory, summary: {}, tools: async () => tools, settingsPath: join(directory, "settings.v1.json") });
  const server = createStaticServer(directory, api);
  const address = await listen(server, 0);
  t.after(() => new Promise((resolveClose) => { server.closeAllConnections(); server.close(resolveClose); }));
  const base = `http://127.0.0.1:${address.port}`;
  const update = (settings) => fetch(`${base}/api/workbench-settings/update`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(settings) });
  assert.equal((await update(withReviewer(enterprise(), { kind: "bad", id: "x" }))).status, 422);
  assert.equal((await update(withReviewer(enterprise()))).status, 200);
  assert.deepEqual((await fetch(`${base}/api/workbench-settings`).then((result) => result.json())).settings.reviewer, { kind: "individual", id: "alice" });
  assert.equal((await update(enterprise())).status, 200);
  assert.equal(Object.hasOwn((await fetch(`${base}/api/workbench-settings`).then((result) => result.json())).settings, "reviewer"), false);
});

test("setup has no assistance step while Catalog publishes no installable assistance content", () => {
  // Catalog main e8fe3662 publishes no item for any assistance tool the step offered (Code Review Graph and
  // codebase-memory-mcp are recorded there as unsupported-installation), so a choice could never reach Your setup.
  const draft = (experience, role = null) => ({ ...newSetupSettings(), experience, role });
  assert.deepEqual(setupSteps({ draft: newSetupSettings() }), ["experience", "clients", "review"]);
  assert.deepEqual(setupSteps({ draft: draft("vibe") }), ["experience", "clients", "review"]);
  assert.deepEqual(setupSteps({ draft: draft("enterprise", "developer") }), ["experience", "role", "clients", "review"]);
  assert.deepEqual(setupSteps({ draft: draft("enterprise", "admin") }), ["experience", "role", "organization", "clients", "review"]);
  assert.deepEqual(setupSteps({ draft: draft("vibe"), editing: true }), ["clients", "review"]);
  assert.deepEqual(setupSteps({ draft: draft("vibe"), editing: true, editSection: "clients" }), ["clients", "review"]);
  assert.equal(Object.hasOwn(setupModel, "CAPABILITIES"), false, "no assistance tool is offered");
});

test("setup screens never name the dropped or renamed assistance tools", () => {
  const screens = ["onboarding.js", "setup-model.js", "setup-summary.js", "organization.js"].map((name) => readFileSync(new URL(`../../src/app/${name}`, import.meta.url), "utf8")).join("\n")
    + readFileSync(new URL("../../src/index.html", import.meta.url), "utf8");
  for (const dropped of [/Headroom/, /token optimization/i, /Workspace help/, /"Code review"/, /Optional assistance/, /Skip (all )?assistance/]) assert.doesNotMatch(screens, dropped);
});

test("setups saved with retired assistance choices stay readable; nothing new can be chosen", (t) => {
  const retired = ["code-review", "codebase-memory", "workspace-help", "headroom", "serena", "context-optimization"];
  assert.deepEqual(settingsErrors({ ...vibe(), capabilities: retired }), {});
  assert.ok(settingsErrors({ ...vibe(), capabilities: ["code-review-graph"] }).capabilities);
  const { store, settingsPath } = fixture(t);
  writeFileSync(settingsPath, JSON.stringify({ ...vibe(), capabilities: ["headroom", "serena"] }));
  assert.equal(store.read().state, "saved");
  assert.deepEqual(store.read().settings.capabilities, ["headroom", "serena"]);
});

test("setup's tools are checked against Core's tool list, the one the header shows, not a separate client list", async (t) => {
  const { settingsPath, directory } = fixture(t);
  // listTools({ includeUnobserved: true }) also holds tools no policy client list names, such as an IDE build.
  const list = { state: "published", tools: [{ id: "claude", label: "Claude Code" }, { id: "kiro-ide", label: "Kiro IDE" }] };
  const api = createApi({ summary: { coreTargets: { state: "published", targets: ["claude", "codex"] } }, tools: async () => list, settingsPath });
  const server = createStaticServer(directory, api);
  const address = await listen(server, 0);
  t.after(() => new Promise((resolveClose) => { server.closeAllConnections(); server.close(resolveClose); }));
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  const refused = await post("/api/workbench-settings", { ...vibe(), clients: ["codex"] });
  assert.equal(refused.status, 422, "a client outside Core's tool list is refused");
  assert.match((await refused.json()).error, /list Core offers/);
  const saved = await post("/api/workbench-settings", { ...vibe(), clients: ["claude", "kiro-ide"] });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).settings.clients, ["claude", "kiro-ide"]);
});

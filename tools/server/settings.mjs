/* The preview's own UI settings, separate from policy artifacts and sessions. */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SETTINGS_LOCATION, settingsErrors } from "../../src/app/setup-model.js";

const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));
export const SETTINGS_PATH = resolve(WORKSPACE, SETTINGS_LOCATION);

/** The optional path is for isolated local tests; HTTP callers never choose it. */
export function createSettingsStore({ coreTargets, settingsPath = SETTINGS_PATH }) {
  settingsPath = resolve(settingsPath);
  const location = settingsPath;
  function guardPath() {
    for (const path of [dirname(settingsPath), settingsPath]) {
      try {
        if (lstatSync(path).isSymbolicLink()) throw new Error("The setup location must not be a symbolic link.");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  function read() {
    try {
      guardPath();
      if (lstatSync(settingsPath).size > 16384) throw new Error("The setup file is too large.");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const errors = settingsErrors(settings);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" "));
      return { ok: true, state: "saved", location, settings };
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, state: "missing", location, settings: null };
      return { ok: true, state: "invalid", location, settings: null, problem: error.message };
    }
  }
  function clientError(clients) {
    if (!clients.length) return null;
    if (coreTargets?.state !== "published" || !Array.isArray(coreTargets.targets)) return "Core's supported AI clients are unavailable. Continue without a client selection.";
    return clients.some((client) => !coreTargets.targets.includes(client)) ? "Select AI clients from the installed Core's published list." : null;
  }
  function write(settings) {
    guardPath();
    mkdirSync(dirname(settingsPath), { recursive: true });
    const temporary = join(dirname(settingsPath), `.settings-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, settingsPath);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return { ok: true, state: "saved", location, settings };
  }
  return {
    read,
    create(settings) {
      const errors = settingsErrors(settings);
      if (Object.keys(errors).length) return { ok: false, error: Object.values(errors).join(" "), errors };
      const error = clientError(settings.clients);
      if (error) return { ok: false, error };
      if (read().state === "saved") return { ok: false, status: 409, error: "Setup already exists. Reload to enter the saved experience. To start over, delete the local setup file and restart." };
      return write(settings);
    },
    update(settings) {
      const current = read();
      if (current.state !== "saved") return { ok: false, status: 409, error: "Saved setup is unavailable. Reload the Workbench to start setup." };
      const errors = settingsErrors(settings);
      if (Object.keys(errors).length) return { ok: false, error: Object.values(errors).join(" "), errors };
      if (settings.experience !== current.settings.experience || settings.role !== current.settings.role) {
        return { ok: false, status: 409, error: "Experience and enterprise role stay fixed. To change them, delete the local setup file and restart the Workbench." };
      }
      // Preserve saved clients omitted by a newer Core list; validate additions.
      const error = clientError(settings.clients.filter((client) => !current.settings.clients.includes(client)));
      return error ? { ok: false, error } : write(settings);
    },
    updateClients(body) {
      if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "clients")) return { ok: false, error: "Supply only the AI client selection." };
      const current = read();
      if (current.state !== "saved") return { ok: false, status: 409, error: "Complete local setup before changing AI clients." };
      const next = { ...current.settings, clients: body.clients };
      const errors = settingsErrors(next);
      if (Object.keys(errors).length) return { ok: false, error: Object.values(errors).join(" ") };
      // Existing choices survive a Core upgrade that stops listing a client.
      // Only newly added choices must be in the current public list.
      const error = clientError(next.clients.filter((client) => !current.settings.clients.includes(client)));
      return error ? { ok: false, error } : write(next);
    },
  };
}

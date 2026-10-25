/**
 * The start-up contract check: Core's `checkContracts` over the package-support
 * declarations the installed packages ship, the Workbench's own included.
 *
 * Declarations are found only where packages publish them: a `./package-support*.json`
 * export or a declaration exported by the package's `./contracts` module, at
 * its highest support version. Fixtures load through the producing package's
 * own exports. A reader is the accepting package's own public reader; the
 * Workbench supplies only the ones Core's README names for its own contracts.
 * A contract without one stays `unavailable` (`reader-missing`): a schema check
 * never stands in for a reader, and nothing the Workbench cannot run is
 * reported as passed. Each accepting package gets its own engine call, because
 * Core uses one reader per contract id for every declaration that accepts it.
 *
 * A Core without `checkContracts` (every Core before package-support 1.1) is
 * reported as `absent`; nothing is run then.
 *
 * Loaded on demand by core-service.mjs, inside the consumer. The Workbench's own
 * declaration and fixtures are copied to `workbench/` there (tools/server/assets.mjs).
 * AIH_CONTRACT_CHECK_EXTRA (a test-only host input, never an HTTP input) names a
 * JSON file with one more declaration and its fixture files, so the browser
 * journey can show a contract a package refuses through Core's real engine.
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const consumer = resolve(here, "..");
const PACKAGES = ["@aihq/core", "@aihq/catalog", "@aihq/scan"];
const WORKBENCH = join(consumer, "workbench");
const SUPPORT = /^urn:aihq:package-support:(\d+)\.(\d+)\.(\d+)$/;
const SUPPORT_JSON = /^\.\/package-support(?:-[0-9.]+)?\.json$/;
// Core's own public readers, as its README names them, by the contract each reads.
const CORE_READERS = [
  { contract: /^urn:aihq:core:recipe:/, reader: "validateRecipe", form: "json" },
  { contract: /^urn:aihq:core:execution-policy:/, reader: "parsePolicy", form: "text" },
  { contract: /^urn:aihq:core:organization-policy:/, reader: "parseOrganizationPolicy", form: "text" },
  { contract: /^urn:aihq:core:organization-target:/, reader: "validateOrganizationTarget", form: "json" },
  { contract: /^urn:aihq:package-support:/, reader: "validatePackageSupport", form: "json" },
];

const isDeclaration = value => value !== null && typeof value === "object" && typeof value.schema === "string" && SUPPORT.test(value.schema);
const supportVersion = value => SUPPORT.exec(value.schema).slice(1).map(Number);
const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const json = path => JSON.parse(readFileSync(path, "utf8"));

/* One package's export target for a specifier, by exact key or one `*` pattern; null when not exported.
   Used for the Workbench's own copy, which is not an installed package; installed packages resolve through Node. */
export function exportTarget(manifest, subpath) {
  const exports = manifest.exports && typeof manifest.exports === "object" ? manifest.exports : {};
  const plain = value => typeof value === "string" ? value : typeof value?.default === "string" ? value.default : typeof value?.import === "string" ? value.import : null;
  if (Object.hasOwn(exports, subpath)) return plain(exports[subpath]);
  for (const [key, value] of Object.entries(exports)) {
    const star = key.indexOf("*");
    if (star < 0 || !subpath.startsWith(key.slice(0, star)) || !subpath.endsWith(key.slice(star + 1))) continue;
    const target = plain(value);
    if (target) return target.replace("*", subpath.slice(star, subpath.length - (key.length - star - 1)));
  }
  return null;
}

function installed(name) {
  const root = name === "aih-ui" ? WORKBENCH : join(consumer, "node_modules", ...name.split("/"));
  return { root, manifest: json(join(root, "package.json")) };
}

async function declarationOf(name) {
  let found;
  try {
    const { root, manifest } = installed(name);
    found = [];
    for (const key of Object.keys(manifest.exports ?? {}).filter(key => SUPPORT_JSON.test(key))) {
      const path = name === "aih-ui" ? join(root, exportTarget(manifest, key)) : fileURLToPath(import.meta.resolve(`${name}${key.slice(1)}`));
      found.push({ from: `${name}${key.slice(1)}`, value: json(path) });
    }
    if (name !== "aih-ui" && Object.hasOwn(manifest.exports ?? {}, "./contracts")) {
      const module = await import(`${name}/contracts`);
      for (const key of Object.keys(module)) if (isDeclaration(module[key])) found.push({ from: `${name}/contracts#${key}`, value: module[key] });
    }
    found = found.filter(item => isDeclaration(item.value));
    const foreign = found.find(item => item.value.package?.name !== name || item.value.package?.version !== manifest.version);
    if (foreign) return { name, status: "mismatched", from: foreign.from, reason: `it names ${foreign.value.package?.name} ${foreign.value.package?.version}, not the installed ${name} ${manifest.version}` };
  } catch (error) {
    return { name, status: "unreadable", reason: error?.message ?? String(error) };
  }
  if (!found.length) return { name, status: "missing" };
  const [best] = found.sort((a, b) => newer(supportVersion(b.value), supportVersion(a.value)));
  return { name, status: "found", from: best.from, declaration: JSON.parse(JSON.stringify(best.value)) };
}

function extraInput() {
  const path = process.env.AIH_CONTRACT_CHECK_EXTRA;
  if (!path) return null;
  const extra = json(path);
  return { declaration: extra.declaration, files: Object.fromEntries(Object.entries(extra.fixtures ?? {}).map(([specifier, file]) => [specifier, resolve(dirname(path), file)])) };
}

function loader(extra) {
  return (packageName, specifier) => {
    if (typeof specifier !== "string" || !specifier.startsWith(`${packageName}/`)) return "unavailable";
    try {
      if (extra && packageName === extra.declaration.package.name) return Object.hasOwn(extra.files, specifier) ? new Uint8Array(readFileSync(extra.files[specifier])) : "unavailable";
      const { root, manifest } = installed(packageName);
      let path;
      if (packageName === "aih-ui") {
        const target = exportTarget(manifest, `.${specifier.slice(packageName.length)}`);
        if (!target) return "unavailable";
        path = realpathSync(join(root, target));
      } else path = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
      if (!path.startsWith(realpathSync(root) + sep)) return "unavailable";
      return new Uint8Array(readFileSync(path));
    } catch {
      return "unavailable";
    }
  };
}

const decode = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
function outcome(result) {
  if (!result || typeof result.valid !== "boolean") throw new TypeError("reader returned no validity");
  const code = result.diagnostics?.[0]?.code;
  return result.valid ? { accepted: true } : typeof code === "string" ? { accepted: false, code } : { accepted: false };
}

function readersFor(name, ids, contracts) {
  const readers = {};
  if (name !== "@aihq/core") return readers;
  for (const id of ids) {
    const binding = CORE_READERS.find(item => item.contract.test(id));
    const reader = binding && contracts[binding.reader];
    if (typeof reader !== "function") continue;
    readers[id] = binding.form === "text" ? bytes => outcome(reader(decode(bytes))) : bytes => outcome(reader(JSON.parse(decode(bytes))));
  }
  return readers;
}

export async function contractCheck() {
  let contracts;
  try {
    contracts = await import("@aihq/core/contracts");
  } catch (error) {
    return { state: "unknown", reason: `@aihq/core/contracts: ${error?.message ?? String(error)}` };
  }
  if (typeof contracts.checkContracts !== "function") return { state: "absent" };
  const found = await Promise.all([...PACKAGES, "aih-ui"].map(declarationOf));
  const extra = extraInput();
  const packages = found.map(({ declaration, ...rest }) => ({ ...rest, ...(declaration ? { version: declaration.package.version, schema: declaration.schema } : {}) }));
  const declarations = found.filter(item => item.declaration).map(item => item.declaration);
  if (extra) { declarations.push(extra.declaration); packages.push({ name: extra.declaration.package.name, status: "found", from: "AIH_CONTRACT_CHECK_EXTRA", version: extra.declaration.package.version, schema: extra.declaration.schema }); }
  const loadFixture = loader(extra);
  const checks = [];
  for (const accepting of declarations) {
    const ids = accepting.contracts.filter(item => item.role !== "produces").map(item => item.id);
    const result = await contracts.checkContracts({ declarations, readers: readersFor(accepting.package.name, ids, contracts), loadFixture });
    if (result.diagnostics?.length) return { state: "invalid", packages, diagnostics: result.diagnostics };
    for (const row of result.checks) if (row.readerPackage === accepting.package.name) checks.push(row);
  }
  const versions = Object.fromEntries(declarations.map(item => [item.package.name, item.package.version]));
  return { state: "ran", packages, versions, checks };
}

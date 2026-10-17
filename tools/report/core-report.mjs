// The Node side of the V9 report presentation: finds the installed @aihq/core, loads its public
// `./report` data interface and binds the Workbench renderer (src/report/render.js) to it.
// Only the package's own export map is followed; no private dist path is named here.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReportRenderer } from '../../src/report/render.js';

/** The installed @aihq/core package root, searched like Node does: node_modules upward from `fromDir`. */
export function findCorePackage(fromDir) {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', '@aihq', 'core', 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === '@aihq/core') return { root: dirname(manifest), version: pkg.version, exports: pkg.exports ?? {} };
    }
    if (dirname(dir) === dir) return null;
  }
}

// The ESM entry an export-map subpath names, or null when the package does not export it.
function exportedModule(core, subpath) {
  const entry = core.exports[subpath];
  const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  return typeof target === 'string' ? pathToFileURL(join(core.root, target)).href : null;
}

/** `@aihq/core/report` from the installation that `fromDir` resolves to, with its version. */
export async function loadCoreReport(fromDir) {
  const core = findCorePackage(fromDir);
  if (!core) throw new Error(`@aihq/core is not installed for ${resolve(fromDir)}; run from a consumer that installs it, or pass --consumer <dir>.`);
  const url = exportedModule(core, './report');
  if (!url) throw new Error(`@aihq/core ${core.version} does not export ./report.`);
  const data = await import(url);
  for (const name of ['importSnapshot', 'exportSnapshot', 'validateSnapshot']) {
    if (typeof data[name] !== 'function') throw new Error(`@aihq/core/report ${core.version} does not publish ${name}.`);
  }
  return { data, version: core.version, root: core.root };
}

/**
 * Core's own `./report/render`, only while the installed Core still exports it. It is read solely to show
 * that the relocated renderer draws the same bytes; nothing renders through it.
 */
export async function loadCoreRendererForComparison(fromDir) {
  const core = findCorePackage(fromDir);
  const url = core && exportedModule(core, './report/render');
  return url ? (await import(url)).renderReport : null;
}

/** The Workbench renderer bound to the installed Core's data interface. */
export async function loadReportRenderer(fromDir) {
  const report = await loadCoreReport(fromDir);
  return { ...report, renderReport: createReportRenderer(report.data) };
}

/** Core's limit on one snapshot document, in UTF-8 bytes (`importSnapshot` refuses anything larger). */
export const SNAPSHOT_MAX_BYTES = 2_097_152;

/**
 * Validate one snapshot document, then render it. Validation comes first and is Core's: `importSnapshot` parses,
 * bounds and validates the document (INPUT_INVALID or SCHEMA_UNSUPPORTED) and re-applies the privacy projection.
 * Answers { status: 'ok', html, snapshot } or { status: 'invalid', code, errors } and never throws for bad input.
 */
export function renderSnapshotText({ data, renderReport }, text, { mode = 'report', title } = {}) {
  let snapshot;
  try { snapshot = data.importSnapshot(text); } catch (error) {
    if (typeof error?.code === 'string') return { status: 'invalid', code: error.code, errors: [error.message] };
    throw error;
  }
  try {
    return { status: 'ok', snapshot, html: renderReport(snapshot, { mode, ...(title === undefined ? {} : { title }) }) };
  } catch (error) {
    if (error instanceof TypeError) return { status: 'invalid', code: 'OPTIONS_INVALID', errors: [error.message] };
    throw error;
  }
}

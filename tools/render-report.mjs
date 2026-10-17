// Render a saved @aihq/core report snapshot as the offline V9 HTML page, without a server.
// Usage: node tools/render-report.mjs <snapshot.json> <out.html> [--demo] [--title <text>] [--consumer <dir>]
//   --demo        the labelled V9 design sample; the snapshot is validated but none of its values is shown
//   --title       page and heading title, 1 to 200 characters (default "AIH report")
//   --consumer    where @aihq/core is installed (default: the current folder, then this repository)
// The snapshot is validated by the installed @aihq/core/report before anything is written. An existing
// output file is never replaced. Rendering never collects data.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCorePackage, loadReportRenderer, renderSnapshotText, SNAPSHOT_MAX_BYTES } from './report/core-report.mjs';

const USAGE = 'Usage: node tools/render-report.mjs <snapshot.json> <out.html> [--demo] [--title <text>] [--consumer <dir>]';

export function parseArguments(argv) {
  const positional = [], options = { mode: 'report' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--demo') options.mode = 'demo';
    else if (arg === '--title' || arg === '--consumer') {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value. ${USAGE}`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(USAGE);
  return { snapshotPath: resolve(positional[0]), outputPath: resolve(positional[1]), ...options };
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Validate and render one snapshot file. Answers the same shape as renderSnapshotText, plus the Core version used. */
export async function renderReportFile({ snapshotPath, outputPath, mode = 'report', title, consumer }) {
  const from = consumer ?? (findCorePackage(process.cwd()) ? process.cwd() : repo);
  const renderer = await loadReportRenderer(from);
  const bytes = await readFile(snapshotPath);
  if (bytes.length > SNAPSHOT_MAX_BYTES) return { status: 'invalid', code: 'INPUT_INVALID', errors: ['input: JSON exceeds byte limit'], coreVersion: renderer.version };
  const result = renderSnapshotText(renderer, bytes.toString('utf8'), { mode, title });
  if (result.status !== 'ok') return { ...result, coreVersion: renderer.version };
  await writeFile(outputPath, result.html, { flag: 'wx' });
  return { status: 'ok', mode, outputPath, bytes: Buffer.byteLength(result.html), coreVersion: renderer.version };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await renderReportFile(parseArguments(process.argv.slice(2)));
    if (result.status !== 'ok') {
      console.error(`The snapshot was not rendered (${result.code}): ${result.errors.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(`Wrote ${result.outputPath} (${result.mode === 'demo' ? 'design sample, no snapshot values' : 'saved snapshot display'}, ${result.bytes} bytes, validated by @aihq/core ${result.coreVersion}).`);
    }
  } catch (error) {
    console.error(error.code === 'EEXIST' ? `${error.path} already exists; choose a new output file.` : error.message);
    process.exitCode = 1;
  }
}

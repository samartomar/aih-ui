// Run from an installed UI; the active candidate's consumer resolves the public packages.
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath || !outputPath) throw new Error('usage: node tools/check-complete-candidate.mjs <plan.json> <new-output-directory>');
const plan = JSON.parse(await readFile(resolve(planPath), 'utf8')), output = resolve(outputPath);
const record = JSON.parse(await readFile(join(plan.data, 'state/server.json'), 'utf8'));
if (record.state !== 'ready' || record.url.replace(/\/$/, '') !== plan.origin) throw new Error('Plan must name the running candidate origin/data.');
const consumer = join(plan.data, 'run/consumer');
const source = join(dirname(fileURLToPath(import.meta.url)), 'consumer/complete-evidence-browser.mjs');
await copyFile(source, join(consumer, 'consumer/complete-evidence-browser.mjs'));
const { runCompleteEvidenceBrowser } = await import(pathToFileURL(join(consumer, 'consumer/complete-evidence-browser.mjs')));
await mkdir(output, { recursive: true });
const receipt = await runCompleteEvidenceBrowser({ plan, output, playwrightModule: import.meta.resolve('playwright'), authoringModule: import.meta.resolve('aih-ui/authoring') });
console.log(JSON.stringify({ status: receipt.status, elapsedMs: receipt.elapsedMs, output, policySha256: receipt.policySha256, baselineScanId: receipt.baselineScanId, laterScanId: receipt.laterScanId }, null, 2));

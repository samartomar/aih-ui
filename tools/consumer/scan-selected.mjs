// Explicit headless assessment of the exact materials selected in a saved policy.
// Built-in detectors only; this script does not sign, publish or execute recipes.
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parsePolicy } from '@aihq/core/contracts';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { readArtifact } from '@aihq/scan/read';
const [policyPath, outputPath] = process.argv.slice(2);
if (!policyPath || !outputPath) throw new Error('Usage: node scan-selected.mjs <policy.json> <new-output-directory>');
const output = resolve(outputPath);
await mkdir(output); // Refuse reuse rather than merge an unrelated source tree.
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const parsed = parsePolicy(await readFile(policyPath, 'utf8'));
if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));
const files = new Map();
for (const selection of parsed.document.selections) {
  const reference = selection.recipe.reference;
  if (!reference || reference.source.kind !== 'local' || reference.source.input !== 'catalog') throw new Error('Only installed Catalog references are supported.');
  for (const member of [reference, ...reference.materials]) {
    if (files.has(member.path) && files.get(member.path).sha256 !== member.sha256) throw new Error('Conflicting material identities.');
    files.set(member.path, member);
  }
}
const source = join(output, 'selected-content');
await mkdir(source);
for (const [path, member] of files) {
  const location = resolve(catalogRoot, path);
  const destination = resolve(source, path);
  if (!location.startsWith(`${catalogRoot}\\`) && !location.startsWith(`${catalogRoot}/`)) throw new Error('Catalog path escapes root.');
  if (!destination.startsWith(`${source}\\`) && !destination.startsWith(`${source}/`)) throw new Error('Destination path escapes root.');
  const bytes = await readFile(location);
  if (bytes.length !== member.byteLength || createHash('sha256').update(bytes).digest('hex') !== member.sha256) throw new Error(`Material changed: ${path}`);
  await mkdir(dirname(destination), { recursive: true }); await copyFile(location, destination);
}
const request = { schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: source },
  selection: { paths: 'all', excludedPaths: [] }, detectors: [
    { detectorId: 'detector.aih-native', configuration: {} },
    { detectorId: 'detector.aih-binding-gate', configuration: {} },
    { detectorId: 'detector.aih-trust-lint', configuration: { internalScopes: [], mcpConfigPaths: [] } }
  ] };
const result = await runScan(request);
await writeFile(join(output, 'run-result.json'), JSON.stringify(result, null, 2));
if (result.status !== 'assessment') throw new Error(JSON.stringify(result));
const artifact = await prepareArtifact({ report: result.report,
  annexes: result.annexes.map(({ id, bytesBase64 }) => ({ id, bytes: Buffer.from(bytesBase64, 'base64') })) });
await writeFile(join(output, 'scan-artifact.json'), artifact.bytes);
await writeFile(join(output, 'material-manifest.json'), JSON.stringify([...files.values()], null, 2));
const evidencePolicy = { ...parsed.document, evidence: [...(parsed.document.evidence ?? []), {
  schema: 'urn:aihq:scan:evidence-association:1.0.0', scanId: artifact.scanId,
  location: { kind: 'file', path: join(output, 'scan-artifact.json') }
}] };
const checked = parsePolicy(JSON.stringify(evidencePolicy));
if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
await writeFile(join(output, 'policy-with-evidence.json'), JSON.stringify(evidencePolicy, null, 2));
const inspected = await readArtifact(artifact.bytes);
const summary = { status: result.status, scanId: artifact.scanId, readStatus: inspected.status,
  authenticity: inspected.authenticity, files: files.size, signed: false,
  output, detectorResults: result.report.detectorResults ?? result.report.detectors };
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

// Explicit local acceptance, limited to project file writes in a supplied target.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { createHost } from './host.mjs';
import { reopenSetup } from './setup.mjs';
const [policyPath, projectPath, outputPath] = process.argv.slice(2);
if (!policyPath || !projectPath || !outputPath) throw new Error('Usage: node prove-policy.mjs policy.json project-root new-evidence-directory');
const projectRoot = resolve(projectPath), output = resolve(outputPath);
await mkdir(output); await mkdir(projectRoot, { recursive: true });
const policyText = await readFile(policyPath, 'utf8');
const installed = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog' });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const reopened = reopenSetup({ release: installed.release, materialSource: installed.source, policyText });
assert.equal(reopened.valid, true, JSON.stringify(reopened.diagnostics));
const host = createHost({ projectRoot, materialRoots: installed.materialRoots, controls: { logging: 'off' } });
const prepared = await host.prepareSession({ policyText });
await writeFile(join(output, 'preparation.json'), JSON.stringify(prepared, null, 2));
assert.equal(prepared.status, 'ready', JSON.stringify(prepared.diagnostics));
assert.ok(prepared.review.operations.every(operation => operation.scope === 'project' && operation.kind === 'file.write'));
const refused = await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: 'not-the-reviewed-digest', origin: 'automation' });
assert.equal(refused.status, 'rejected');
const result = await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest, origin: 'automation' });
await writeFile(join(output, 'run-result.json'), JSON.stringify(result, null, 2));
assert.equal(result.completion, 'complete', JSON.stringify(result.diagnostics));
const repeated = await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
assert.equal(repeated.status, 'lost');
const enterprise = JSON.parse(policyText); enterprise.mode = 'enterprise';
const enterpriseRefusal = await host.prepareSession({ policyText: JSON.stringify(enterprise) });
assert.notEqual(enterpriseRefusal.status, 'ready');
await writeFile(join(output, 'enterprise-refusal.json'), JSON.stringify(enterpriseRefusal, null, 2));
await writeFile(join(output, 'policy.json'), policyText);
const summary = { projectRoot, output, completion: result.completion, operations: result.operations.length,
  reviewDigest: prepared.review.reviewDigest, wrongDigest: refused.status, reusedHandle: repeated.status,
  enterpriseWithoutAuthority: enterpriseRefusal.status, savedIntent: reopened.editable,
  nativeClientExecuted: false, evidence: result.evidence ?? [] };
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

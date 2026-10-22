import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readRelease } from '@aihq/catalog/reader';
import { selectContentEvidence } from './scan-evidence.mjs';
import { inspectorSummary } from './scan-evidence.mjs';
const fixture = name => readFile(new URL(`./fixtures/scan-evidence/${name}`, import.meta.url));

test('inspector reuse preserves exact evidence inputs, refreshes files and projects only summary facts', async () => {
  const { createScanEvidenceHost } = await import('./scan-evidence-host.mjs');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'ui-inspector-'));
  try {
    const path = join(root, 'source.json'), input = await scanFixture();
    const host = createScanEvidenceHost({ sources: [{ id: 'configured', path, format: 'artifact' }], packageRoot: root });
    await writeFile(path, await fixture('s1.json'));
    const first = await host.check(input), repeated = await host.check(input);
    assert.equal(first.acquisitionCost.reused, false);
    assert.equal(repeated.acquisitionCost.reused, true);
    const unchecked = await host.check({ ...input, inventory: { release: { sha256: input.inventory.release.sha256 } } });
    assert.equal(unchecked.status, 'invalid', 'cache cannot bypass checked-release validation');
    assert.deepEqual(first.assessments, repeated.assessments);
    const compact = inspectorSummary(first);
    const selected = first.assessments.find(entry => entry.summary.scanId === first.selectedScanId);
    assert.deepEqual(compact.assessment.summary.findings, selected.summary.findings);
    assert.equal(compact.assessment.coverage.status, selected.coverage.status);
    assert.equal(compact.assessment.coverage.unmatchedPathCount, selected.coverage.unmatchedPaths.length);
    assert.equal(compact.baseline.scanId, first.baseline.scanId);
    assert.equal(compact.baseline.evidence?.eligibility, first.baseline.evidence?.eligibility);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(first).length);
    assert.ok(!JSON.stringify(compact).includes('targetPaths'));
    const otherItem = await host.check({ ...input, itemId: 'beta' });
    assert.equal(otherItem.acquisitionCost.reused, false); assert.equal(otherItem.item.itemId, 'beta');
    const later = await host.check({ ...input, evaluationTime: '2026-10-20T02:00:00.000Z' });
    assert.equal(later.acquisitionCost.reused, false);
    const otherScope = await host.check({ ...input, selection: { paths: ['release/recipes/alpha.json'], excludedPaths: [] } });
    assert.equal(otherScope.acquisitionCost.reused, false);
    await writeFile(path, await fixture('s2.json'));
    const changed = await host.check(input);
    assert.equal(changed.acquisitionCost.reused, false); assert.notEqual(changed.selectedScanId, first.selectedScanId);
    await rm(path);
    const offline = await host.check(input);
    assert.equal(offline.acquisitionCost.reused, false);
    assert.equal(offline.freshness, 'last-known');
    assert.equal(inspectorSummary(offline).checks.find(check => check.sourceId === 'configured').status, 'failed');
  } finally { await rm(root, { recursive: true }); }
});
export async function scanFixture() {
  const bytes = await fixture('release.json');
  const checked = readRelease(bytes, { expectedSha256: createHash('sha256').update(bytes).digest('hex') });
  assert.equal(checked.valid, true);
  const assessments = await Promise.all(['s1', 's2'].map(async (name, i) => ({sourceId:`producer-${i}`, location:name, format:'artifact', bytes:new Uint8Array(await fixture(`${name}.json`))})));
  return { inventory: {release:checked.release}, itemId:'alpha', assessments, sourceIds:['producer-0','producer-1'], checks:['producer-0','producer-1'].map(sourceId=>({sourceId,status:'succeeded',attemptedAt:'2026-10-20T01:00:00.000Z',lastSuccessfulAt:'2026-10-20T01:00:00.000Z',diagnostics:[]})), evaluationTime:'2026-10-20T01:00:00.000Z' };
}
test('latest release evidence advances while absent item material coverage remains explicit', async () => {
  const input=await scanFixture();
  const result=await selectContentEvidence(input);
  assert.equal(result.status,'selected');
  assert.equal(result.selectedScanId,'scan:sha256:e4dee8fb3f2c550a7a65db4c92d651f29dc0377f9f6d64f48baa5cee9f660364');
  assert.equal(result.baseline.scanId,'scan:sha256:d87230a1371ba7a6dd0b15816e707fb3ddcb90b586662e25ee77bad4166ac0c6');
  assert.equal(result.assessments[0].comparisonCoverage.status,'matched');
  assert.equal(result.assessments[0].coverage.status,'mismatched');
  assert.equal(result.assessments[0].acquisitions[0].authentication.status,'skipped');
});



test('same-source refresh retains history and malformed acquisition keeps last-known evidence', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { createScanEvidenceHost } = await import('./scan-evidence-host.mjs');
  const root=await mkdtemp(join(tmpdir(),'ui88-source-'));
  try {
    const path=join(root,'source.json'), input=await scanFixture();
    const host=createScanEvidenceHost({ sources:[{id:'configured',path,format:'artifact'}], packageRoot:root });
    await writeFile(path,await fixture('s1.json'));
    const first=await host.check(input); assert.equal(first.status,'selected',JSON.stringify(first)); assert.equal(first.assessments.length,1);
    await writeFile(path,await fixture('s2.json'));
    const second=await host.check(input); assert.equal(second.assessments.length,2); assert.notEqual(first.selectedScanId,second.selectedScanId);
    await writeFile(path,'malformed');
    const failed=await host.check(input); assert.equal(failed.selectedScanId,second.selectedScanId); assert.equal(failed.freshness,'last-known'); assert.equal(failed.assessments.length,2);
    assert.equal(failed.checks.find(value=>value.sourceId==='configured').status,'failed');
    assert.ok(failed.checks.find(value=>value.sourceId==='configured').diagnostics.some(value=>value.code==='invalid-artifact'));
  } finally { await rm(root,{recursive:true}); }
});


test('malformed supplied evidence and expected identity refusal retain actual checked history', async () => {
  const { createScanEvidenceHost } = await import('./scan-evidence-host.mjs');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');const { tmpdir } = await import('node:os');const { join } = await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'ui88-expected-'));
  try {
    const input=await scanFixture(), path=join(root,'source.json');
    const source={id:'fixed',path,format:'artifact',expectedScanId:'scan:sha256:d87230a1371ba7a6dd0b15816e707fb3ddcb90b586662e25ee77bad4166ac0c6'};
    const host=createScanEvidenceHost({sources:[source],packageRoot:root});
    await writeFile(path,await fixture('s1.json'));
    const initial=await host.check({...input,supplied:[new Uint8Array(await fixture('s2.json'))]});assert.equal(initial.assessments.length,2);
    await writeFile(path,await fixture('s2.json'));
    const failed=await host.check({...input,supplied:[new TextEncoder().encode('malformed')]});
    assert.equal(failed.selectedScanId,initial.selectedScanId);assert.equal(failed.assessments.length,2);assert.equal(failed.freshness,'last-known');
    assert.equal(failed.checks.find(value=>value.sourceId==='fixed').status,'failed');assert.equal(failed.checks.find(value=>value.sourceId==='supplied-1').status,'failed');
    assert.equal(failed.checks.find(value=>value.sourceId==='fixed').diagnostics[0].code,'expected-scan-id-mismatch');
  } finally {await rm(root,{recursive:true});}
});

test('same report in larger canonical envelopes is accounted and acquisition-bound refusal retains earlier bytes', async () => {
  const { createScanEvidenceHost } = await import('./scan-evidence-host.mjs');
  const { readArtifact, maxAssessments } = await import('@aihq/scan/read');
  const { prepareArtifact, signArtifact } = await import('@aihq/scan/host');
  const { generateKeyPairSync } = await import('node:crypto');
  const input=await scanFixture(), signed=new Uint8Array(await fixture('s1.json'));
  const read=await readArtifact(signed), unsigned=await prepareArtifact({report:read.report,annexes:[]});
  assert.ok(signed.length>unsigned.bytes.length);
  const host=createScanEvidenceHost();
  await host.check({...input,supplied:[unsigned.bytes]});
  const both=await host.check({...input,supplied:[signed]});
  assert.equal(both.acquisitionCost.retainedAcquisitions,2);
  assert.equal(both.acquisitionCost.retainedBytes,signed.length+unsigned.bytes.length);
  for(let index=2;index<maxAssessments;index++) {
    const pair=generateKeyPairSync('ed25519'), spki=pair.publicKey.export({format:'der',type:'spki'});
    const artifact=await signArtifact({report:read.report,annexes:[],signer:{keyId:`ed25519:${createHash('sha256').update(spki).digest('hex')}`,privateKey:pair.privateKey}});
    await host.check({...input,supplied:[artifact.bytes]});
  }
  const pair=generateKeyPairSync('ed25519'),spki=pair.publicKey.export({format:'der',type:'spki'});
  const beyond=await signArtifact({report:read.report,annexes:[],signer:{keyId:`ed25519:${createHash('sha256').update(spki).digest('hex')}`,privateKey:pair.privateKey}});
  const refused=await host.check({...input,supplied:[beyond.bytes]});
  assert.equal(refused.status,'selected');assert.equal(refused.acquisitionCost.retainedAcquisitions,maxAssessments);
  assert.equal(refused.checks.find(value=>value.sourceId==='supplied-1').status,'failed');assert.equal(refused.freshness,'last-known');
  assert.equal(refused.checks.find(value=>value.sourceId==='supplied-1').diagnostics[0].code,'acquisition-limit');
  assert.equal(refused.assessments[0].acquisitions.length,maxAssessments);
});

test('configured evidence sources cannot claim the generated supplied acquisition namespace', async () => {
  const { createScanEvidenceHost } = await import('./scan-evidence-host.mjs');
  const { resolve } = await import('node:path');
  for (const id of ['supplied','supplied-1','supplied-later','release-baseline']) assert.throws(()=>createScanEvidenceHost({sources:[{id,path:resolve('synthetic.json'),format:'artifact'}]}),/unique local evidence sources/);
});

test('a page explicitly reuses acquired original evidence for review without uploading its bytes', async () => {
  const { startConsumer } = await import('./server.mjs');
  const input = await scanFixture();
  const { fileURLToPath } = await import('node:url');
  const started = await startConsumer({ suppliedInventories: [input.inventory], evidenceSources: [{ id: 'retained', path: fileURLToPath(new URL('./fixtures/scan-evidence/s1.json', import.meta.url)), format: 'artifact' }] });
  const headers = { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'configured-review-proof' };
  const call = async (operation, body) => (await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers, body: JSON.stringify(body) })).json();
  try {
    const target = `${input.inventory.release.sha256}/alpha`;
    await call('scan-evidence', { target, evaluationTime: input.evaluationTime });
    const selected = await call('evidence-states', { reviewEvidenceIds: [input.inventory.release.baseline.scanId], subjects: [{ releaseSha256: input.inventory.release.sha256, itemId: 'alpha' }] });
    assert.equal(selected.status, 'ok');
    assert.equal(selected.value[0].state, 'mismatched'); // Fixture captures its inventory, not alpha's material.
    assert.equal(selected.value[0].scanId, input.inventory.release.baseline.scanId);
    const otherPage = await (await fetch(`${started.origin}/api/authoring-evidence-states`, { method: 'POST', headers: { ...headers, 'x-aih-client': 'another-page' }, body: JSON.stringify({ reviewEvidenceIds: [input.inventory.release.baseline.scanId], subjects: [] }) })).json();
    assert.equal(otherPage.status, 'refused', 'Acquired evidence references belong to their page session');
    const unknown = await call('evidence-states', { reviewEvidenceIds: ['scan:sha256:' + '0'.repeat(64)], subjects: [] });
    assert.equal(unknown.status, 'refused');
    assert.equal(unknown.diagnostics[0].code, 'EVIDENCE_UNAVAILABLE');
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

test('an authentic inventory-only all-provider-failed baseline qualifies without demonstrating item coverage', async () => {
  const { buildScanEvidenceFixture }=await import('./scan-evidence-fixture.mjs');
  const { mkdtemp, rm }=await import('node:fs/promises');const { tmpdir }=await import('node:os');const { join }=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'ui88-inventory-only-'));
  try {
    const fixture=await buildScanEvidenceFixture(root);
    const evaluated=await selectContentEvidence({inventory:{release:fixture.inventoryOnly.release},itemId:'alpha',assessments:[{sourceId:'baseline',location:'Synthetic inventory-only baseline',format:'artifact',bytes:fixture.inventoryOnly.artifactBytes,authentication:fixture.inventoryOnly.authentication}],sourceIds:['baseline'],checks:[{sourceId:'baseline',status:'succeeded',attemptedAt:'2026-10-20T01:00:00.000Z',lastSuccessfulAt:'2026-10-20T01:00:00.000Z',diagnostics:[]}],evaluationTime:'2026-10-20T01:00:00.000Z'});
    assert.equal(evaluated.status,'selected');assert.equal(fixture.inventoryOnly.authentication.status,'authenticated');
    assert.equal(evaluated.baseline.evidence.comparisonCoverage.status,'matched');assert.equal(evaluated.baseline.evidence.coverage.status,'mismatched');
    assert.ok(evaluated.baseline.evidence.summary.providers.every(provider=>provider.outcome==='failed'));
    assert.equal(evaluated.baseline.evidence.summary.findings.records,0);
  } finally {await rm(root,{recursive:true});}
});

test('unsupported report schema remains explicit in source diagnostics without a private path', async () => {
  const { createScanEvidenceHost }=await import('./scan-evidence-host.mjs');const { mkdtemp,writeFile,rm }=await import('node:fs/promises');const { tmpdir }=await import('node:os');const { join }=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'ui88-unsupported-'));
  try {
    const path=join(root,'report.json');await writeFile(path,JSON.stringify({schema:'urn:aihq:scan:report:9.0.0'}));
    const host=createScanEvidenceHost({sources:[{id:'configured',path,format:'report'}]});
    const result=await host.check(await scanFixture());assert.equal(result.status,'selected');
    const diagnostic=result.checks.find(value=>value.sourceId==='configured').diagnostics[0];assert.equal(diagnostic.code,'unsupported-report');assert.match(diagnostic.detail,/9\.0\.0/);assert.ok(!diagnostic.detail.includes(root));
  } finally {await rm(root,{recursive:true});}
});

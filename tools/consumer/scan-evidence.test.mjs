import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readRelease } from '@aihq/catalog/reader';
import { selectContentEvidence } from './scan-evidence.mjs';
const fixture = name => readFile(new URL(`./fixtures/scan-evidence/${name}`, import.meta.url));
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
  assert.equal(refused.assessments[0].acquisitions.length,maxAssessments);
});

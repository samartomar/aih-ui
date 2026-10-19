// Synthetic data construction only. No detector, native tool or network runs.
// Identity construction follows the public Scan packed-consumer fixture (Apache-2.0).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readArtifact, readContentCoverage } from '@aihq/scan/read';
import { signArtifact, prepareArtifact } from '@aihq/scan/host';
import { authenticateEvidence } from '@aihq/core';
import { createContentInventory } from '@aihq/catalog/reader';
import { prepareReleaseBaseline } from '@aihq/catalog/node';
import { stable } from './primitives.mjs';
const encode = value => new TextEncoder().encode(stable(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = name => readFile(new URL(`./fixtures/scan-evidence/${name}`, import.meta.url));
export async function buildScanEvidenceFixture(output) {
  await mkdir(output, { recursive: true });
  const packageRoot = join(output, 'catalog-package');
  await cp(dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), packageRoot, { recursive: true, errorOnExist: true, force: false });
  await cp(new URL('./fixtures/scan-evidence/package-release/', import.meta.url), join(packageRoot,'release'), { recursive:true });
  const declaredFixture = JSON.parse(new TextDecoder().decode(await fixture('content.json')));
  const ordinary = JSON.parse(await readFile(fileURLToPath(import.meta.resolve('@aihq/catalog/release.json')), 'utf8'));
  const merged = { ...ordinary, sources: [...ordinary.sources, ...declaredFixture.sources], items: [...ordinary.items, ...declaredFixture.items],
    metadata: { ...ordinary.metadata, ui88Fixture: 'Synthetic alpha/beta content and evidence; not production signing or detector execution' } };
  merged.sources.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0); merged.items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const contentBytes = new TextEncoder().encode(stable(merged) + '\n');
  const inventory = createContentInventory(contentBytes, { expectedSha256: hash(contentBytes) }); assert.equal(inventory.valid,true,JSON.stringify(inventory.diagnostics));
  const content=JSON.parse(new TextDecoder().decode(contentBytes)), item=content.items.find(value => value.id === 'alpha');
  const original = await readArtifact(await fixture('s1.json')); assert.equal(original.status,'read');
  const report=structuredClone(original.report);
  const descriptors=[{path:'release/content-inventory.json',sha256:inventory.sha256,byteLength:inventory.byteLength},item.recipe,...item.materials].map(({path,sha256,byteLength})=>({path,sha256,byteLength}));
  report.selection={paths:descriptors.map(value=>value.path).sort(),excludedPaths:[]};
  report.source.capture.entries=[{kind:'directory',path:'release'},{kind:'directory',path:'release/materials'},{kind:'directory',path:'release/recipes'},...descriptors.map(value=>({kind:'file',...value}))].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  report.source.capture.captureSha256=hash(encode({domain:'aih.scan.capture.v1',profile:report.source.capture.profile,entries:report.source.capture.entries}));
  report.createdAt='2026-10-19T00:10:00.000Z';
  const observation=report.results[1].observations[0];
  observation.body.input.entries=structuredClone(report.source.capture.entries); observation.body.input.targetPaths=[...report.selection.paths];
  observation.body.coverage.coveredPaths=[...report.selection.paths];
  const unavailable={state:'unavailable',reason:'not-reported',detail:'Synthetic fixture: field not reported'};
  observation.body.findings=[{rawOccurrenceFingerprint:`raw-occurrence-v1:${'1'.repeat(64)}`,multiplicity:3,rule:{state:'present',value:{nativeRuleId:'fixture-review'}},severity:{state:'present',value:{level:'vendor-urgent',vendorSeverity:'P0'}},message:{state:'present',value:'Synthetic fixture finding; not a native detector result'},location:unavailable,supportingEvidence:unavailable}, {rawOccurrenceFingerprint:`raw-occurrence-v1:${'2'.repeat(64)}`,multiplicity:2,rule:unavailable,severity:unavailable,message:unavailable,location:unavailable,supportingEvidence:unavailable}];
  observation.body.gaps=[{reason:'fixture-gap',detail:'Synthetic coverage is not a safety guarantee'}];
  observation.observationId=`observation:sha256:${hash(Buffer.concat([Buffer.from('aih.scan.observation.v1\0'),encode(observation.body)]))}`;
  report.results[1].coverage={coveredPaths:[...report.selection.paths],excludedPaths:[],uncoveredPaths:[],complete:true};
  report.results[0].coverage.uncoveredPaths=[...report.selection.paths];
  const keys=[];
  const signer=identity=>{const pair=generateKeyPairSync('ed25519'); const publicBytes=pair.publicKey.export({format:'der',type:'spki'}), keyId=`ed25519:${hash(publicBytes)}`;keys.push({identity,keyId,publicKeySpkiBase64:publicBytes.toString('base64')});return {keyId,privateKey:pair.privateKey};};
  const s1=await signArtifact({report,annexes:[],signer:signer('synthetic-baseline-producer')});
  const later=structuredClone(report); later.createdAt='2026-10-19T01:00:00.000Z'; later.producer.version='0.5.0-synthetic-later'; later.results[1].observations[0].origin='reused';later.results[1].observations[0].fromScanId=s1.scanId;
  const s2=await signArtifact({report:later,annexes:[],signer:signer('synthetic-later-producer')});
  const trust={keys:[...keys],publishers:[]};
  const variants={s1,s2};
  for(const [name,change] of Object.entries({narrow:r=>{r.selection.paths=['release/content-inventory.json']; r.source.capture.entries=r.source.capture.entries.filter(e=>['release','release/content-inventory.json'].includes(e.path)); r.source.capture.captureSha256=hash(encode({domain:'aih.scan.capture.v1',profile:r.source.capture.profile,entries:r.source.capture.entries})); for(const result of r.results){result.observations=[];result.diagnostics=[{code:'fixture-unavailable',detail:'Synthetic fixture unavailable provider'}];result.coverage={coveredPaths:[],excludedPaths:[],uncoveredPaths:r.selection.paths,complete:false};result.outcome='failed';result.diagnostics=[{code:'fixture-unavailable',detail:'Synthetic fixture unavailable provider'}];}},older:r=>{r.createdAt='2026-10-19T00:00:02.000Z';},future:r=>{r.createdAt='2099-01-01T00:00:00.000Z';},allfailed:r=>{r.createdAt='2026-10-19T02:00:00.000Z';for(const result of r.results){result.outcome='failed';result.diagnostics=[{code:'fixture-unavailable',detail:'Synthetic fixture unavailable provider'}];result.observations=[];result.diagnostics=[{code:'fixture-unavailable',detail:'Synthetic fixture unavailable provider'}];result.coverage={coveredPaths:[],excludedPaths:[],uncoveredPaths:r.selection.paths,complete:false};}},unsigned:r=>{r.createdAt='2026-10-19T03:00:00.000Z';}})) {
    const value=structuredClone(later);change(value); console.log('Preparing synthetic variant',name); variants[name]=await prepareArtifact({report:value,annexes:[]});
  }
  const untrustedReport=structuredClone(later);untrustedReport.createdAt='2026-10-19T04:00:00.000Z';
  variants.untrusted=await signArtifact({report:untrustedReport,annexes:[],signer:signer('untrusted-synthetic-producer')});
  const binding={schema:'urn:aihq:catalog:scan-baseline:1.0.0',inventory:descriptors[0],scanId:s1.scanId,artifact:{sha256:hash(s1.bytes),byteLength:s1.bytes.length,location:{kind:'package',path:'release/baseline.json'}},scope:{namespace:'package-relative',...report.selection}};
  const prepared=await prepareReleaseBaseline({contentBytes,expectedSha256:hash(contentBytes),baseline:binding,trust},{acquireArtifact:async()=>s1.bytes,readArtifact,readContentCoverage,authenticateEvidence});
  assert.equal(prepared.valid,true,JSON.stringify(prepared.diagnostics));
  await writeFile(join(packageRoot,'release/release.json'),prepared.releaseBytes);await writeFile(join(packageRoot,binding.inventory.path),inventory.bytes);await writeFile(join(packageRoot,'release/baseline.json'),s1.bytes);
  for(const [name,value] of Object.entries(variants)) {assert.equal((await readArtifact(value.bytes)).status,'read',name);await writeFile(join(output,`${name}.json`),value.bytes);}
  await writeFile(join(output,'public-test-trust.json'),JSON.stringify(trust));
  await writeFile(join(output,'identities.json'),JSON.stringify({fixture:true,meaning:'Synthetic data only; no provider execution, production signing or trust update',packageRoot,baseline:binding,variants:Object.fromEntries(Object.entries(variants).map(([name,value])=>[name,{scanId:value.scanId,sha256:hash(value.bytes),bytes:value.bytes.length}]))},null,2));
  return {packageRoot,trust,variants,binding};
}

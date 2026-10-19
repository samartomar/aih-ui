// Runs only from an installed application in an outside-repository consumer.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { homeEnvironment } from './consumer/home-environment.mjs';
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]), fixtureRoot=resolve(process.argv[3]);
assert.ok(!output.toLowerCase().startsWith('c:\\dev\\'), 'Proof output must be outside source repositories');
const phaseStart=performance.now();
await mkdir(output,{recursive:true});
Object.assign(process.env,homeEnvironment(join(output,'account-home')));
const fixture=JSON.parse(await readFile(join(fixtureRoot,'identities.json'),'utf8'));
const sourcePaths=Object.fromEntries(['later','older','narrow','future','untrusted'].map(name=>[name,join(output,`${name}-source.json`)]));
for(const path of Object.values(sourcePaths)) await copyFile(join(fixtureRoot,'s1.json'),path);
const sources=Object.entries(sourcePaths).map(([id,path])=>({id,path,format:'artifact',label:`Synthetic fixture source ${id}`}));
const sourcesPath=join(output,'sources.json');await writeFile(sourcesPath,JSON.stringify(sources));
const providerPath=join(output,'providers.json');await writeFile(providerPath,JSON.stringify(['fixture-failed','fixture-success','fixture-not-requested']));
process.env.AIH_SCAN_EVIDENCE_SOURCES=sourcesPath;process.env.AIH_SCAN_EVIDENCE_PROVIDERS=providerPath;
process.env.AIH_REVIEW_TRUST=join(fixtureRoot,'public-test-trust.json');
const organizationPath=join(output,'synthetic-organization-source.json');
await writeFile(organizationPath,JSON.stringify({provider:'github',repository:{owner:'synthetic-ui88',name:'authority'},path:'policy/organization.json',revision:{kind:'branch',value:'main'}}));
process.env.AIH_ORGANIZATION_SOURCE=organizationPath;
process.env.AIH_CONSUMER_PROJECT=join(output,'project');await mkdir(process.env.AIH_CONSUMER_PROJECT,{recursive:true});
const controls=join(output,'controls.json');await writeFile(controls,JSON.stringify({logging:'off'}));process.env.AIH_CONSUMER_CONTROLS=controls;
const [{pageAssets,serviceAssets},{buildCss},{createWorkbench},{listen},{callService},{coreTargetsSummary}]=await Promise.all([
  import('./server/assets.mjs'),import('./build-css.mjs'),import('./server/workbench.mjs'),import('./server/static.mjs'),import('./server/service-client.mjs'),import('./server/core-targets-summary.mjs')]);
await buildCss(appRoot);
const runDir=join(output,'page');
for(const [assets,destination] of [[pageAssets(appRoot),runDir],[serviceAssets(appRoot),output]]) for(const asset of assets){const path=join(destination,asset.to);await mkdir(dirname(path),{recursive:true});await copyFile(join(appRoot,asset.from),path);}
const packageManifest=JSON.parse(await readFile(join(process.cwd(),'proof-packages.json'),'utf8'));
const summary={packages:packageManifest.packages.filter(value=>value.name!=='ui'),coreTargets:coreTargetsSummary(callService(output,{op:'coreTargets'}))};
const started=await createWorkbench({consumerDir:output,runDir,summary,settingsPath:join(output,'settings.json')});
summary.entryCount=started.catalog.items.length;await writeFile(join(runDir,'summary.json'),JSON.stringify(summary));
const address=await listen(started.server,Number(process.env.AIH_SCAN_PROOF_PORT??0));const origin=`http://127.0.0.1:${address.port}`;
await writeFile(join(output,'running.json'),JSON.stringify({origin,output,fixtureRoot,appRoot,settings:join(output,'settings.json'),home:join(output,'account-home'),consumer:output,packageManifest},null,2));
console.log(`Ordinary fixture Workbench: ${origin}`);
const setupMs=performance.now()-phaseStart;
const {runScanEvidenceBrowser}=await import(pathToFileURL(join(output,'consumer/scan-evidence-browser.mjs')));
try {
  const result=await runScanEvidenceBrowser({origin,output:join(output,'evidence'),fixtureRoot,sourcePaths,playwrightModule:import.meta.resolve('playwright')});
  const resolution=Object.fromEntries(await Promise.all(['aih-ui/scan-evidence','@aihq/core','@aihq/core/contracts','@aihq/catalog/reader','@aihq/catalog/node','@aihq/scan/read'].map(async name=>{const path=fileURLToPath(import.meta.resolve(name));assert.ok(!path.toLowerCase().startsWith('c:\\dev\\'));const bytes=await readFile(path);return [name,{path,sha256:createHash('sha256').update(bytes).digest('hex')}];})));
  await writeFile(join(output,'proof-result.json'),JSON.stringify({status:'passed',fixture:true,limits:'Synthetic fixture reports/signing only; no detector execution, native/paid scanner or production trust claim',setupMs,totalMs:performance.now()-phaseStart,resolution,...result},null,2));
  console.log('Ordinary browser/headless proof PASS');
} catch(error) {await writeFile(join(output,'failure.txt'),error.stack);console.error(error);process.exitCode=1;}
if(process.env.AIH_SCAN_PROOF_KEEP==='1') console.log(`Retained isolated preview ${origin}`); else started.server.close();

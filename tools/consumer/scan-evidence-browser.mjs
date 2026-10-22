import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readInstalledRelease } from '@aihq/catalog/node';
import { parsePolicy, deriveRecipeIdentity, previewOrganizationAdmission } from '@aihq/core/contracts';
import { selectContentEvidence } from 'aih-ui/scan-evidence';
import { readAuthoring, composeAuthoring, freshAuthoring } from 'aih-ui/authoring';
import { createScanEvidenceHost } from './scan-evidence-host.mjs';
import { createGitHubFixture } from './github-fixture.mjs';
import { createHost } from './host.mjs';
import { authenticateEvidence } from '@aihq/core';
import { openScanReview, openSetupAdvanced, openFileActions, chooseFamily } from './advanced-browser.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function runScanEvidenceBrowser({origin,output,fixtureRoot,sourcePaths,playwrightModule}) {
  const start=performance.now();await mkdir(output,{recursive:true});
  const fixture=JSON.parse(await readFile(join(fixtureRoot,'identities.json'),'utf8'));
  const trust=JSON.parse(await readFile(join(fixtureRoot,'public-test-trust.json'),'utf8'));
  const packageRoot=dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const installed=await readInstalledRelease({root:packageRoot,sourceInput:'maintained'});assert.equal(installed.valid,true);
  const item=installed.release.items.find(value=>value.id==='alpha');
  const materials=await Promise.all([item.recipe,...item.materials].map(async value=>({...value,bytes:new Uint8Array(await readFile(join(packageRoot,value.path)))})));
  const inventory={release:installed.release,materialSource:{kind:'local',input:'maintained'},materials};
  const detectorIds=['fixture-failed','fixture-success','fixture-not-requested'];
  const sources=Object.entries(sourcePaths).map(([id,path])=>({id,path,format:'artifact',label:`Synthetic fixture source ${id}`}));
  const headless=createScanEvidenceHost({sources,packageRoot,trust,detectorIds});
  let headlessSupplied=[];
  const headlessCheck=()=>headless.check({inventory,itemId:'alpha',evaluationTime:new Date().toISOString(),supplied:headlessSupplied});
  const {chromium}=await import(playwrightModule);const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:720}});const page=await context.newPage();page.setDefaultTimeout(30_000);
  const errors=[],steps=[],selections=[];let evidenceBytes=0,latestResponse,preparedRaw,cardReadCost;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(response.url().endsWith('/api/authoring-scan-evidence')) {const bytes=await response.body();evidenceBytes+=bytes.length;latestResponse=JSON.parse(bytes);}});
  const download=async(name,action)=>{const event=page.waitForEvent('download');await action();const path=join(output,name);await(await event).saveAs(path);return new Uint8Array(await readFile(path));};
  const panel=page.getByRole('region',{name:'Latest Scan evidence'});
  async function check(expected) {
    const response=page.waitForResponse(value=>value.url().endsWith('/api/authoring-scan-evidence'));
    await panel.getByRole('button',{name:'Check Scan evidence',exact:true}).click();const body=await(await response).json();
    assert.equal(body.status,'selected',JSON.stringify(body));assert.equal(body.selectedScanId,fixture.variants[expected].scanId);
    const displayed = await panel.getByLabel('Scan history',{exact:true}).inputValue();
    await panel.getByRole('status').filter({hasText:displayed || fixture.variants[expected].scanId}).waitFor();
    const same=await headlessCheck();assert.equal(same.selectedScanId,body.selectedScanId);assert.equal(same.freshness,body.freshness);
    selections.push({expected,scanId:body.selectedScanId,freshness:body.freshness,checks:body.checks,assessments:body.assessments,acquisitionCost:body.acquisitionCost});return body;
  }
  try {
    await page.goto(origin+'/');await page.locator('#browse-family option[value="Catalog"]').waitFor({state:'attached'});
    if(await page.locator('#setup-dialog').isVisible()){await page.getByRole('radio',{name:/Vibe coder/}).check();for(let i=0;i<4;i++)await page.locator('#setup-next').click();await page.locator('#setup-dialog').waitFor({state:'hidden'});}
    await page.locator('#browse-support').selectOption('all');await chooseFamily(page, 'Catalog');
    await page.getByRole('button',{name:'Choose alpha',exact:true}).click();await page.locator('#policy-accept:not([disabled])').waitFor();await page.locator('#policy-accept').click();
    await openScanReview(page);await panel.waitFor();
    await panel.getByLabel('Scan content',{exact:true}).selectOption(`${installed.release.sha256}/alpha`);
    const initial=await check('s1');assert.equal(initial.baseline.scanId,fixture.variants.s1.scanId);assert.equal(initial.baseline.evidence.coverage.status,'matched');
    assert.ok(initial.baseline.evidence.acquisitions.some(value=>value.authentication.status==='authenticated'));
    assert.ok(initial.assessments[0].summary.providers.some(value=>value.outcome==='not-requested'));
    // Record a real checked finding through the ordinary application's public review flow.
    const cardStarted=performance.now();
    const cardsEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-evidence-states'));
    await page.getByLabel('Review evidence files',{exact:true}).setInputFiles(join(fixtureRoot,'s1.json'));
    headlessSupplied=[new Uint8Array(await readFile(join(fixtureRoot,'s1.json')))];
    const cardsResponse=await cardsEvent,cardBytes=await cardsResponse.body(),cardResult=JSON.parse(cardBytes);
    assert.equal(cardResult.status,'ok');assert.ok(cardResult.value.length>=1000);
    cardReadCost={subjects:cardResult.value.length,elapsedMs:performance.now()-cardStarted,requestBytes:cardsResponse.request().postDataBuffer().length,responseBytes:cardBytes.length};
    await page.getByText('Original evidence bytes loaded.',{exact:false}).waitFor();
    await page.getByLabel('Evidence review subject',{exact:true}).selectOption({label:'alpha'});
    await page.getByRole('button',{name:'Inspect evidence',exact:true}).click();await page.getByText(/2 findings bound to the checked subject/).waitFor();
    await page.getByLabel('Review decision ID',{exact:true}).fill('synthetic-baseline-review');
    await page.getByLabel('Review owner kind',{exact:true}).selectOption('individual');await page.getByLabel('Review owner',{exact:true}).fill('fixture-person');
    await page.getByLabel('Reviewer',{exact:true}).fill('fixture-reviewer');await page.getByLabel('Review reason',{exact:true}).fill('Synthetic fixture finding inspected against exact alpha bytes.');
    await page.getByRole('button',{name:'Propose human review',exact:true}).click();await page.locator('#policy-accept:not([disabled])').waitFor();await page.locator('#policy-accept').click();
    const reviewed=await download('reviewed-policy.download.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));
    const policy=JSON.parse(new TextDecoder().decode(reviewed));assert.equal(policy.metadata['aih.workbench'].reviews.records.length,1);
    // Explicit fixture authoring through Core's public validator, then actual ordinary reopen/download.
    policy.evidence=[{schema:'urn:aihq:scan:evidence-association:1.0.0',scanId:fixture.variants.s1.scanId,location:{kind:'file',path:join(fixtureRoot,'s1.json')}}];
    assert.equal(parsePolicy(JSON.stringify(policy)).valid,true);
    const pinnedPath=join(output,'explicit-pinned-policy.json');await writeFile(pinnedPath,JSON.stringify(policy,null,2)+'\n');
    await page.locator('#policy-open').setInputFiles(pinnedPath);await openFileActions(page); await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();await page.locator('#policy-status').filter({hasText:'Saved choices recovered'}).waitFor();
    const before=await download('before.policy.download.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));
    const beforeReview=JSON.stringify(JSON.parse(new TextDecoder().decode(before)).metadata['aih.workbench'].reviews);
    const preparationEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-prepare'));
    await openSetupAdvanced(page, 'Sources and execution').then(() => page.getByRole('button',{name:'Prepare exact effects',exact:true}).click());preparedRaw=new Uint8Array(await(await preparationEvent).body());
    const preparation=JSON.parse(new TextDecoder().decode(preparedRaw));assert.equal(preparation.status,'ready',JSON.stringify(preparation));assert.ok(preparation.sessionId);assert.ok(preparation.review.reviewDigest);
    const hostFacts=page.locator('details').filter({has:page.getByText('Exact host review and effects',{exact:true})}).locator('pre');
    await page.getByRole('button',{name:'Approve and Apply reviewed effects',exact:true}).waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'Approve and Apply reviewed effects',exact:true}).isEnabled(),true);
    const preparedDisplay=await hostFacts.textContent();await writeFile(join(output,'before.prepared.http.json'),preparedRaw);
    await writeFile(join(output,'before.review.json'),beforeReview);
    await check('s1');await page.screenshot({path:join(output,'01-baseline.png'),fullPage:true});steps.push('ordinary-alpha-policy-real-review-and-preparation');
    await copyFile(join(fixtureRoot,'s2.json'),sourcePaths.later);const newer=await check('s2');
    const evaluationTime=new Date().toISOString(), publicCandidates=await Promise.all(['s1','s2'].map(async name=>{
      const bytes=new Uint8Array(await readFile(join(fixtureRoot,`${name}.json`)));
      return {sourceId:name,location:`Synthetic ${name}`,format:'artifact',bytes,authentication:await authenticateEvidence({bytes,expectedScanId:fixture.variants[name].scanId,trust})};
    }));
    const publicSelection=await selectContentEvidence({inventory,itemId:'alpha',assessments:publicCandidates,sourceIds:['s1','s2'],evaluationTime,detectorIds,
      checks:['s1','s2'].map(sourceId=>({sourceId,status:'succeeded',attemptedAt:evaluationTime,lastSuccessfulAt:evaluationTime,diagnostics:[]}))});
    assert.equal(publicSelection.selectedScanId,newer.selectedScanId);await writeFile(join(output,'public-headless-selection.json'),JSON.stringify(publicSelection,null,2));
    assert.equal(newer.baseline.scanId,fixture.variants.s1.scanId);assert.ok(newer.assessments.find(value=>value.summary.scanId===fixture.variants.s2.scanId).acquisitions.some(value=>value.authentication.producerIdentity==='synthetic-later-producer'));
    const panelBounds=await panel.boundingBox();
    for(const control of await panel.locator('select,input,button').all()) {
      const bounds=await control.boundingBox();
      assert.ok(bounds.x>=panelBounds.x && bounds.x+bounds.width<=panelBounds.x+panelBounds.width, 'Evidence control stays within its panel at 1280px');
    }
    assert.ok((await panel.getByLabel('Scan requested scope',{exact:true}).locator('option').first().textContent()).startsWith('Scope 1 ·'));
    await page.screenshot({path:join(output,'02-latest-partial.png'),fullPage:true});steps.push('different-producer-partial-latest');
    await panel.getByLabel('Scan history',{exact:true}).selectOption(fixture.variants.s1.scanId);assert.match(await panel.getByRole('status').textContent(),/Historical selection/);
    await copyFile(join(fixtureRoot,'older.json'),sourcePaths.older);await check('s2');assert.equal(await panel.getByLabel('Scan history',{exact:true}).inputValue(),fixture.variants.s1.scanId);
    await copyFile(join(fixtureRoot,'narrow.json'),sourcePaths.narrow);await copyFile(join(fixtureRoot,'future.json'),sourcePaths.future);const scoped=await check('s2');
    assert.equal(scoped.assessments.find(value=>value.summary.scanId===fixture.variants.narrow.scanId).eligibility,'scope-mismatch');assert.equal(scoped.assessments.find(value=>value.summary.scanId===fixture.variants.future.scanId).eligibility,'future-dated');
    const narrowScope=JSON.stringify(scoped.assessments.find(value=>value.summary.scanId===fixture.variants.narrow.scanId).summary.selection);
    const scopeEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-scan-evidence'));
    await panel.getByLabel('Scan requested scope',{exact:true}).selectOption(narrowScope);await scopeEvent;
    assert.equal(await panel.getByLabel('Scan history',{exact:true}).inputValue(),fixture.variants.s1.scanId,'Changing requested scope preserves explicit history');
    await panel.getByRole('button',{name:'Latest',exact:true}).click();
    await panel.getByRole('status').filter({hasText:fixture.variants.narrow.scanId}).waitFor();
    const returnScope=page.waitForResponse(value=>value.url().endsWith('/api/authoring-scan-evidence'));
    await panel.getByLabel('Scan requested scope',{exact:true}).selectOption(JSON.stringify(scoped.context.selection));await returnScope;
    await page.screenshot({path:join(output,'03-pinned-history-scopes.png'),fullPage:true});steps.push('history-pin-older-arrival-narrow-scope-future');
    await panel.getByRole('button',{name:'Latest',exact:true}).click();
    await writeFile(sourcePaths.later,'malformed');const failed=await check('s2');assert.equal(failed.freshness,'last-known');assert.equal(failed.checks.find(value=>value.sourceId==='later').status,'failed');steps.push('malformed-source-retains-last-known');
    await copyFile(join(fixtureRoot,'allfailed.json'),sourcePaths.later);const allfailed=await check('allfailed');assert.equal(allfailed.assessments.find(value=>value.summary.scanId===fixture.variants.allfailed.scanId).coverage.observations.length,0);steps.push('captured-item-with-no-detector-coverage');
    await copyFile(join(fixtureRoot,'unsigned.json'),sourcePaths.untrusted);const unsigned=await check('unsigned');assert.ok(unsigned.assessments.find(value=>value.summary.scanId===fixture.variants.unsigned.scanId).acquisitions.some(value=>value.authentication.reason==='unsigned'));steps.push('unsigned-latest-is-not-trusted');
    await copyFile(join(fixtureRoot,'untrusted.json'),sourcePaths.untrusted);const untrusted=await check('untrusted');assert.ok(untrusted.assessments.find(value=>value.summary.scanId===fixture.variants.untrusted.scanId).acquisitions.every(value=>value.authentication.status!=='authenticated'));steps.push('untrusted-latest-does-not-change-trust');
    // Actual later malformed supplied bytes preserve earlier supplied history too.
    await panel.getByLabel('Evidence for latest view',{exact:true}).setInputFiles(join(fixtureRoot,'s2.json'));
    headlessSupplied=[new Uint8Array(await readFile(join(fixtureRoot,'s2.json')))];await headlessCheck();
    await panel.getByRole('status').filter({hasText:fixture.variants.untrusted.scanId}).waitFor();
    const malformed=join(output,'malformed-supplied.json');await writeFile(malformed,'malformed');
    headlessSupplied=[new TextEncoder().encode('malformed')];
    const suppliedEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-scan-evidence'));await panel.getByLabel('Evidence for latest view',{exact:true}).setInputFiles(malformed);
    const suppliedResult=await(await suppliedEvent).json();assert.equal(suppliedResult.selectedScanId,fixture.variants.untrusted.scanId);assert.ok(suppliedResult.assessments.some(value=>value.summary.scanId===fixture.variants.s2.scanId));steps.push('malformed-supplied-retains-readable-history');
    const after=await download('after.policy.download.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));assert.deepEqual(after,before);
    const afterReview=JSON.stringify(JSON.parse(new TextDecoder().decode(after)).metadata['aih.workbench'].reviews);assert.equal(afterReview,beforeReview);await writeFile(join(output,'after.review.json'),afterReview);
    assert.equal(await hostFacts.textContent(),preparedDisplay);await writeFile(join(output,'after.prepared.display.json'),await hostFacts.textContent());
    assert.equal(await page.getByRole('button',{name:'Approve and Apply reviewed effects',exact:true}).isEnabled(),true);steps.push('actual-policy-review-and-prepared-bytes-preserved');
    const downloaded=await download('original-untrusted.evidence.json',()=>panel.getByRole('button',{name:'Download original Scan evidence',exact:true}).click());assert.equal(hash(downloaded),fixture.variants.untrusted.sha256);
    await page.screenshot({path:join(output,'04-authentication-gaps.png'),fullPage:true});
    // The original held preparation remains executable; view changes did not replace it.
    const applyEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-apply'));await openSetupAdvanced(page, 'Sources and execution').then(() => page.getByRole('button',{name:'Approve and Apply reviewed effects',exact:true}).click());
    const applied=await(await applyEvent).json();assert.equal(applied.completion,'complete',JSON.stringify(applied));assert.equal(hash(await readFile(join(dirname(output),'project/alpha.txt'))),item.materials[0].sha256);steps.push('original-prepared-handle-applies-after-view-changes');
    const headlessPolicy=await readAuthoring({policyBytes:after,inventories:[inventory],reviewEvidence:[new Uint8Array(await readFile(join(fixtureRoot,'s1.json')))]});assert.equal(headlessPolicy.status,'ok');assert.equal(headlessPolicy.value.reviewJudgments[0].applicability,'applies');
    // Same selected bytes under Core's organization boundary, through the real host/public admission.
    const base=new TextEncoder().encode(JSON.stringify({schema:'urn:aihq:core:execution-policy:1.3.0',mode:'enterprise',selections:[],metadata:{'aih.workbench':freshAuthoring()}}));
    const enterpriseIntent=freshAuthoring();enterpriseIntent.roots=structuredClone(headlessPolicy.value.intent.roots);
    const enterprise=await composeAuthoring({basePolicyBytes:base,intent:enterpriseIntent,inventories:[inventory]});assert.equal(enterprise.status,'ok',JSON.stringify(enterprise.diagnostics));
    const organization={schema:'urn:aihq:core:organization-policy:1.0.0',id:'synthetic-ui88-org',selections:await Promise.all(enterprise.value.policy.selections.map(async selection=>{const identity=await deriveRecipeIdentity({reference:selection.recipe.reference,recipeBytes:materials.find(value=>value.sha256===selection.recipe.reference.sha256).bytes});assert.equal(identity.status,'ok');return {selectionId:selection.organizationSelectionId,recipeIdentity:identity.value.recipeIdentity,scopes:['project'],inputs:{},lifecycle:{replace:true,remove:true}};}))};
    const transport=createGitHubFixture({owner:'synthetic-ui88',name:'authority'});transport.publish(organization);transport.install();
    try {
      const target=join(output,'enterprise-project');await mkdir(target);
      const host=createHost({projectRoot:target,materialRoots:{maintained:packageRoot},organizationSource:transport.source,recipeMaterials:materials,controls:{logging:'off'}});
      const admitted=await host.prepareSession({policyText:new TextDecoder().decode(enterprise.value.policyBytes)});assert.equal(admitted.status,'ready',JSON.stringify(admitted));
      const enterprisePath=join(output,'enterprise.policy.json');await writeFile(enterprisePath,enterprise.value.policyBytes);
      await page.locator('#policy-open').setInputFiles(enterprisePath);await openFileActions(page); await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();await page.locator('#policy-status').filter({hasText:'Saved choices recovered'}).waitFor();
      const admittedEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-prepare'));await openSetupAdvanced(page, 'Sources and execution').then(() => page.getByRole('button',{name:'Prepare exact effects',exact:true}).click());
      const browserAdmitted=await(await admittedEvent).json();assert.equal(browserAdmitted.status,'ready',JSON.stringify(browserAdmitted));
      const enterpriseBefore=await download('enterprise.before.policy.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));
      const enterprisePreparedDisplay=await hostFacts.textContent();
      await check('untrusted');
      assert.equal(await hostFacts.textContent(),enterprisePreparedDisplay);
      assert.equal(await page.getByRole('button',{name:'Approve and Apply reviewed effects',exact:true}).isEnabled(),true);
      const enterpriseAfter=await download('enterprise.after.policy.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));assert.deepEqual(enterpriseAfter,enterpriseBefore);
      transport.publish({...organization,selections:[]});const denied=await host.prepareSession({policyText:new TextDecoder().decode(enterprise.value.policyBytes)});assert.notEqual(denied.status,'ready');
      const deniedEvent=page.waitForResponse(value=>value.url().endsWith('/api/authoring-prepare'));await openSetupAdvanced(page, 'Sources and execution').then(() => page.getByRole('button',{name:'Prepare exact effects',exact:true}).click());
      const browserDenied=await(await deniedEvent).json();assert.notEqual(browserDenied.status,'ready');
      await writeFile(join(output,'organization-boundary.json'),JSON.stringify({fixture:true,admitted,denied,browserAdmitted,browserDenied,enterpriseViewPreserved:true,enterprisePolicySha256:hash(enterpriseBefore),enterprisePreparedDisplaySha256:hash(Buffer.from(enterprisePreparedDisplay)),requests:transport.requests},null,2));
    } finally {transport.restore();}
    steps.push('public-core-organization-admits-and-refuses-independently');
    // An independent item has no matching evidence and remains selectable.
    const catalog=await(await page.request.get(origin+'/api/authoring-catalog')).json();const note=catalog.items.find(value=>value.id==='consumer-proof.review-note');
    await openFileActions(page); await page.getByRole('button', { name: 'New project policy', exact: true }).click();
    await page.locator('#nav-sources').click();await page.locator('#browse-support').selectOption('all');await chooseFamily(page, 'Independent');
    await page.getByRole('button',{name:`Choose ${note.id}`,exact:true}).click();await page.locator('#policy-accept:not([disabled])').waitFor();await page.locator('#policy-accept').click();
    const noEvidencePolicy=await download('no-evidence.policy.json',()=>openSetupAdvanced(page).then(() => page.locator('#policy-save').click()));
    const noEvidenceDocument=JSON.parse(new TextDecoder().decode(noEvidencePolicy));assert.equal(noEvidenceDocument.mode,'vibe');assert.ok(noEvidenceDocument.metadata['aih.workbench'].roots.some(root=>root.itemId===note.id));assert.ok(!noEvidenceDocument.evidence?.length);
    await openScanReview(page);
    await panel.getByLabel('Scan content',{exact:true}).selectOption(`${note.root.releaseSha256}/${note.id}`);await panel.getByRole('status').filter({hasText:'No matching evidence'}).waitFor();steps.push('ordinary-no-evidence-content-selected-and-saved');
    await page.screenshot({path:join(output,'05-no-evidence.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    await writeFile(join(output,'selections.json'),JSON.stringify(selections,null,2));
    await writeFile(join(output,'actual-prepared-identity.json'),JSON.stringify({sessionId:preparation.sessionId,reviewDigest:preparation.review.reviewDigest,policySha256:hash(before),reviewSha256:hash(Buffer.from(beforeReview)),preparedHttpSha256:hash(preparedRaw),preparedDisplaySha256:hash(Buffer.from(preparedDisplay)),applied},null,2));
    return {steps,selections:selections.map(({expected,scanId,freshness,acquisitionCost})=>({expected,scanId,freshness,acquisitionCost})),browserMs:performance.now()-start,cardReadCost,payload:{evidenceResponseBytes:evidenceBytes,policyBytes:before.length,preparedBytes:preparedRaw.length},policySha256:hash(before),reviewSha256:hash(Buffer.from(beforeReview)),errors};
  } catch(error) {await page.screenshot({path:join(output,'FAILURE.png'),fullPage:true}).catch(()=>{});throw error;} finally {await browser.close();}
}

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, openSourceDetails, openPolicyAdvanced, openPolicyFileActions } from './policy-drawer.mjs';
export async function runFrameworksBrowser({ origin, output, playwrightModule, scenario, expected }) {
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true }); await mkdir(output,{recursive:true});
  const errors=[],outcomes=[];
  try {
    for(const theme of ['dark','light']) {
      const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
      const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
      // This is a viewer preference, not a grant. The real header validates it against listTools.
      await context.addInitScript(()=>localStorage.setItem('wb-your-tool','claude'));
      await page.goto(origin+'/');await page.locator('#browse-family option').nth(1).waitFor({state:'attached'});
      if(await page.locator('#setup-dialog').isVisible()){await page.getByRole('radio',{name:/Vibe coder/}).check();for(let i=0;i<4;i++)await page.locator('#setup-next').click();await page.locator('#setup-dialog').waitFor({state:'hidden'});}
      const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.click();
      const rail=page.locator('#framework-navigation');
      assert.match(await rail.innerText(),/Test fixture sources — not production data/);
      const internal=expected.prepared ? rail.locator('[data-framework='+JSON.stringify(`internal:${expected.prepared.framework.id}:${expected.prepared.sha256}`)+']') : rail.locator('[data-framework^="internal:"]');
      if(['ready','failed','missing','conflicting','releaseFailed'].includes(scenario)) {
        await internal.waitFor();assert.match(await internal.innerText(),/Internal · not verified/);
        await internal.click();assert.equal(await page.locator('.wb-source-heading').innerText(),expected.prepared.framework.name);
        assert.equal(await page.locator('#cards-grid [data-card-id]').count(),expected.prepared.items.length,'Actual prepared items are browsable despite another source failure');
        const count=expected.counts.find(row=>row.tool==='claude');await page.waitForFunction(()=>document.getElementById('your-tool-name')?.textContent==='Claude Code');
        assert.match(await internal.innerText(),new RegExp(`${count.count} observed`));
        await page.locator('#catalog-search').focus();await page.keyboard.press('Tab');await internal.focus();await page.locator('#wb-tooltip').filter({hasText:'Static observations'}).waitFor();
        assert.match(await internal.getAttribute('title'),/not “works”/);
        await internal.tap();await page.locator('#wb-tooltip').filter({hasText:'non-production'}).waitFor();
        await page.keyboard.press('Escape');
        const item=expected.prepared.items[0];await page.locator(`#cards-grid [data-card-id="${expected.prepared.sha256}/${item.id}"]`).click();await openSourceDetails(page);
        await page.locator('#internal-content-identity > summary').click();assert.match(await page.locator('#details-source').innerText(),new RegExp(expected.prepared.archiveSha256));await page.locator('#internal-content-identity > summary').click();
        await page.screenshot({animations:'disabled',path:join(output,`${theme}-internal.png`)});
      }
      if(scenario==='ready') {
        const additional=rail.locator('[data-framework='+JSON.stringify(`internal:${expected.additional.framework.id}:${expected.additional.sha256}`)+']');
        await additional.click();await page.waitForFunction(count=>document.querySelectorAll('#cards-grid [data-card-id]').length===count,expected.additional.defaults);assert.equal(await page.locator('#cards-grid [data-card-id]').count(),expected.additional.defaults,'The set-first grid uses public resolved choosable members');await page.locator('#browse-all-items').check();assert.equal(await page.locator('#cards-grid [data-card-id]').count(),expected.additional.choosable,'All items keeps support material in comes with');await internal.click();
        await page.keyboard.press('Escape');
        await addFromCatalog(page,expected.prepared.items[0].id);
        await page.locator('#your-setup').click();
        await page.locator('#policy-internal-content').waitFor();
        await page.locator('#policy-internal-content > summary').click();
        assert.match(await page.locator('#policy-internal-content').innerText(),new RegExp(expected.prepared.archiveSha256));
        await openPolicyAdvanced(page);
        const saved=page.waitForEvent('download');await page.locator('#policy-save').click();
        const download=await saved;const file=join(output,`${theme}-saved-policy.json`);await download.saveAs(file);
        const policy=JSON.parse(await readFile(file,'utf8'));
        const provenance=policy.metadata['aih.workbench'].provenance.find(source=>source.releaseSha256===expected.prepared.sha256);
        assert.deepEqual(provenance.materialSource.internalContent.status,expected.prepared.status);
        assert.equal(provenance.materialSource.internalContent.archiveSha256,expected.prepared.archiveSha256);
        assert.equal(provenance.materialSource.internalContent.provenance.inventorySha256,expected.prepared.provenance.inventorySha256);
        await page.reload();await page.locator('#framework-navigation [aria-pressed="true"]').waitFor();assert.equal(await internal.getAttribute('aria-pressed'),'true','Exact saved framework selection is restored');await page.locator('#your-setup').click();await page.locator('#policy-internal-content').waitFor();
        assert.match(await page.locator('#policy-internal-content').innerText(),/Internal content/);
        await page.keyboard.press('Escape');
      }
      if(['ready','unsigned','internalFailed'].includes(scenario)) {
        const release=rail.locator('[data-framework^="release:"]');await release.waitFor();assert.match(await release.innerText(),new RegExp(expected.release.framework.name));
        assert.match(await rail.innerText(),/Release list not signed yet/);await release.click();
        assert.equal(await page.locator('.wb-source-heading').innerText(),expected.release.framework.name);
        assert.equal(await release.getAttribute('aria-pressed'),'true');
        if(scenario==='ready') {
          await page.locator('#catalog-filter-disclosure > summary').click();await page.locator('#browse-family').selectOption('');
          assert.equal(await release.getAttribute('aria-pressed'),'true','Clearing secondary filters preserves the selected valid release framework');
          await page.locator('#catalog-filters-close').click();await internal.click();
          await page.locator('#catalog-filter-disclosure > summary').click();await page.locator('#catalog-reset-filters').click();
          assert.equal(await internal.getAttribute('aria-pressed'),'true','Normal reset preserves the current framework context');await page.locator('#catalog-filters-close').click();
        }
      }
      if(['failed','missing'].includes(scenario))assert.match(await rail.innerText(),/failed|unavailable/i);
      if(scenario==='conflicting'){assert.match(await rail.innerText(),/Sources disagree about \S+ \S+; neither is used/);assert.equal(await rail.locator('[data-framework*="framework-alpha"]').count(),0,'Conflicting framework is withheld');assert.match(await rail.locator('[data-framework^="release:"] .framework-count').innerText(),/unavailable/);}
      if(scenario==='releaseFailed')assert.match(await rail.locator('[data-framework^="release:"] .framework-count').innerText(),/failed/);
      if(['empty','unavailable'].includes(scenario))assert.match(await rail.innerText(),/No frameworks available/);
      if(scenario==='readerUnavailable'){assert.match(await rail.innerText(),/Internal content unavailable/);assert.equal(await internal.count(),0);}
      if(scenario==='internalFailed'){assert.match(await rail.innerText(),/Internal content source failed/);assert.equal(await internal.count(),0);}
      assert.ok(await page.locator('#framework-guidance').isVisible(), 'State-aware first-step guidance remains visible');
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-rail.png`)});
      const contrast = await page.locator('.framework-source-note, .framework-count, .framework-internal, .framework-landing').evaluateAll(nodes => {
        const rgb = text => text.match(/[\d.]+/g).slice(0,3).map(Number).map(value => { const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4; });
        const luminance = value => {const [r,g,b]=rgb(value);return .2126*r+.7152*g+.0722*b;};
        return nodes.filter(node=>node.getClientRects().length).map(node=>{let back=node;while(back&&['rgba(0, 0, 0, 0)','transparent'].includes(getComputedStyle(back).backgroundColor))back=back.parentElement;const foreground=luminance(getComputedStyle(node).color),background=luminance(getComputedStyle(back??document.body).backgroundColor);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);});
      });
      assert.ok(contrast.every(value=>value>=4.5),`New text contrast in ${theme}: ${contrast}`);
      outcomes.push({theme,scenario,contrast});await context.close();
    }
    assert.deepEqual(errors,[]);await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',outcomes,errors},null,2));return outcomes;
  } finally {await browser.close();}
}

export async function runFrameworkLoadingBrowser({origin,output,playwrightModule}) {
  const {chromium}=await import(playwrightModule);const browser=await chromium.launch({headless:true});await mkdir(output,{recursive:true});
  try {for(const theme of ['dark','light']) {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});let release;const held=new Promise(done=>{release=done;});
    await page.route('**/api/authoring-catalog',async route=>{const response=await route.fetch();await held;try{await route.fulfill({response});}catch { /* The fixture page may close while its held response resumes. */ }});
    await page.goto(origin+'/');const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.last().click();
    await page.locator('#framework-navigation').filter({hasText:'Loading frameworks and observed counts…'}).waitFor();
    assert.ok(await page.locator('#framework-guidance').isVisible(), 'State-aware first-step guidance remains visible');await page.screenshot({path:join(output,`${theme}-loading.png`)});release();await page.close();
  }}finally{await browser.close();}
}

export async function runFrameworkReopenBrowser({origin,output,savedDirectory,expected,playwrightModule}) {
  const {chromium}=await import(playwrightModule);const browser=await chromium.launch({headless:true});await mkdir(output,{recursive:true});
  try {for(const theme of ['dark','light']) {
    const page=await browser.newPage();await page.goto(origin+'/');await page.locator('#browse-family option').nth(1).waitFor({state:'attached'});
    if(await page.locator('#setup-dialog').isVisible()){await page.getByRole('radio',{name:/Vibe coder/}).check();for(let i=0;i<4;i++)await page.locator('#setup-next').click();}
    const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.click();
    await openPolicyFileActions(page);await page.locator('#policy-open').setInputFiles(join(savedDirectory,`${theme}-saved-policy.json`));
    await page.getByRole('button',{name:'Validate and reopen',exact:true}).click();
    await page.locator('#policy-status').filter({hasText:'Saved choices recovered from exact source snapshots.'}).waitFor();
    await page.locator('#policy-internal-content > summary').click();assert.match(await page.locator('#policy-internal-content').innerText(),new RegExp(expected.prepared.archiveSha256));
    const download=page.waitForEvent('download');await page.locator('#policy-save').click();const saved=await download;const path=join(output,`${theme}-reopened.json`);await saved.saveAs(path);
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),JSON.parse(await readFile(join(savedDirectory,`${theme}-saved-policy.json`),'utf8')),'A fresh host and viewer preserve exact source/choice metadata');
    await page.screenshot({path:join(output,`${theme}-reopened.png`)});await page.close();
  }}finally{await browser.close();}
}

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {addFromCatalog} from './policy-drawer.mjs';

// Layout and interaction acceptance on the ordinary running page, fed by packed public packages.
// Mockup counts and unimplemented set/tool-fit operations are deliberately not assertions or fixtures.
export async function runReferenceLayoutBrowser({origin,output,playwrightModule,projectRoot,stateLocation}) {
  const {chromium}=await import(playwrightModule);await mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});const errors=[],observed=[];
  const ready=async page=>{
    await page.goto(origin+'/');await page.locator('#browse-family option[value="ECC"]').waitFor({state:'attached'});
    if(await page.locator('#setup-dialog').isVisible()){await page.getByRole('radio',{name:/Vibe coder/}).check();for(let i=0;i<4;i++)await page.locator('#setup-next').click();await page.locator('#setup-dialog').waitFor({state:'hidden'});}
  };
  try {
    for(const theme of ['dark','light']) {
      const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await ready(page);
      const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.click();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.mode),theme);
      const header=await page.locator('body > header').boundingBox();assert.ok(header.height<=64,'Desktop has one compact primary header');
      const packages=page.locator('#package-disclosure');assert.equal(await packages.evaluate(n=>n.open),false,'Package details start collapsed');
      const summary=packages.locator('summary');await summary.focus();await page.keyboard.press('Enter');await page.locator('.package-panel').waitFor();
      for(const name of ['@aihq/core','@aihq/catalog','@aihq/scan','read-only-mirror'])assert.ok((await packages.innerText()).includes(name));
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-packages.png`)});await page.keyboard.press('Escape');assert.equal(await packages.evaluate(n=>n.open),false);
      await page.locator('#browse-support').selectOption('all');await page.locator('#framework-navigation button[data-family="ECC"]').click();
      assert.equal(await page.locator('.wb-source-heading').innerText(),'ECC');assert.equal(await page.locator('#browse-family').inputValue(),'ECC');
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-ecc.png`)});
      const grid=await page.locator('#cards-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length);assert.equal(grid,2,'Desktop uses two card columns');
      await page.locator('#catalog-search').fill('zzzzui155emptyf3c9e7aabbbb');await page.getByText('No catalog entry matches this view.',{exact:false}).waitFor();assert.equal(await page.locator('#cards-grid [data-card-id]').count(),0);await page.screenshot({animations:'disabled',path:join(output,`${theme}-empty.png`)});await page.locator('#catalog-search').fill('');
      await page.locator('#framework-navigation button[data-family="Extensions"]').click();await page.locator('#catalog-search').fill('grill-me');await page.locator('#cards-grid [data-card-id]').first().click();await page.locator('#inspector-rail:not(.w-0)').waitFor();await page.waitForFunction(()=>document.getElementById('inspector-rail').getBoundingClientRect().width>=390);
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-inspector.png`)});
      await addFromCatalog(page,'extensions.matt.grill-me');await page.locator('#your-setup').click();await page.locator('#policy-review-panel').waitFor();
      const choose=async value=>{if(!await page.locator('#project-folder-input').isVisible())await page.locator('#project-folder-change').click();await page.locator('#project-folder-input').fill(value);await page.locator('#project-folder-use').click();await page.locator('#project-folder-message').filter({hasNotText:/^Checking the folder…$/}).waitFor();return page.locator('#project-folder-message').innerText();};
      if(projectRoot){const project=join(projectRoot,theme);await mkdir(project,{recursive:true});assert.match(await choose(project),/Now using/);await page.locator('#install-button:not([disabled])').waitFor({timeout:120000});await page.locator('#install-button').click();await page.locator('#install-message[data-outcome="installed"]').waitFor({timeout:120000});await page.locator('[data-installed-item="extensions.matt.grill-me"]').waitFor();}
      if(stateLocation){assert.match(await choose(stateLocation.root),/Core keeps its own records/);assert.match(await choose(stateLocation.projectMarkers[0].path),/Core keeps its own records/);}
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-setup.png`)});await page.locator('#policy-back-to-catalog').click();
      await page.setViewportSize({width:390,height:844});await page.locator('#catalog-search').fill('grill-me');await page.locator('#cards-grid [data-card-id]').first().click();await page.locator('#inspector-rail[aria-modal="true"]').waitFor();await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow-inspector.png`)});await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Narrow page has no horizontal document overflow');
      await page.locator('#your-setup').click();await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow-setup.png`)});await page.keyboard.press('Escape');
      await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow.png`)});observed.push({theme,desktopHeaderHeight:header.height,columns:grid,installed:Boolean(projectRoot),publishedStateRefused:Boolean(stateLocation),narrowWidth:390});await context.close();
    }
    assert.deepEqual(errors,[]);await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',observed,errors,humanAcceptance:'pending'},null,2));
    return {observed,errors};
  }finally{await browser.close();}
}

// Authoring catalog delivery states. The installed server remains unchanged;
// only this page's HTTP response is delayed/failed/emptied as a test fixture.
export async function runFamilyStatesBrowser({origin,output,playwrightModule}) {
  const {chromium}=await import(playwrightModule);const browser=await chromium.launch({headless:true});await mkdir(output,{recursive:true});const outcomes=[];
  try{for(const theme of ['dark','light'])for(const state of ['loading','empty','failed']){
    const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();let release;const held=new Promise(done=>{release=done;});
    await page.route('**/api/authoring-catalog',async route=>{
      if(state==='failed')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Catalog unavailable (browser fixture)'})});
      const response=await route.fetch();const body=await response.json();if(state==='loading')await held;
      return route.fulfill({response,json:state==='empty'?{...body,items:[]}:body});
    });
    await page.goto(origin+'/');const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.click();
    const expected=state==='loading'?'Loading content families…':state==='empty'?'No content families listed':'Content families unavailable. See the source error.';
    await page.locator('#framework-navigation').filter({hasText:expected}).waitFor();
    const packages=page.locator('#package-disclosure');await packages.locator('summary').click();await packages.getByText('@aihq/catalog',{exact:true}).waitFor();
    await page.screenshot({animations:'disabled',path:join(output,`${theme}-${state}.png`)});
    if(state==='failed')await page.locator('#catalog-error').filter({hasText:'Installed catalog unavailable (503)'}).waitFor();
    outcomes.push({theme,state,packagesAccessible:true});release();await context.close();
  }await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',outcomes},null,2));return outcomes;}finally{await browser.close();}
}

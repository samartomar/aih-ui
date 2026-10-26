import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chooseCatalogFamily, chooseCatalogSupport, openCatalogFilters, addFromCatalog} from './policy-drawer.mjs';

// Bounded presentation regression on the actual packed running page. Pixel comparisons isolate
// the local SVG from its unchanged button background; screenshots establish recognizability.
async function captureIcon(page, control, output, name) {
  const svg=control.locator('svg');await svg.waitFor();
  const shown=await control.screenshot({path:join(output,name+'.png'),animations:'disabled'});
  await svg.evaluate(node=>node.style.visibility='hidden');
  const background=await control.screenshot({animations:'disabled'});
  await svg.evaluate(node=>node.style.removeProperty('visibility'));
  const pixels=await page.evaluate(async ({a,b})=>{
    const load=src=>new Promise((done,fail)=>{const image=new Image();image.onload=()=>done(image);image.onerror=fail;image.src=src;});
    const [first,second]=await Promise.all([load(a),load(b)]);const canvas=document.createElement('canvas');canvas.width=first.width;canvas.height=first.height;const context=canvas.getContext('2d');context.drawImage(first,0,0);const x=context.getImageData(0,0,canvas.width,canvas.height).data;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(second,0,0);const y=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<x.length;i+=4)if(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2])count++;return count;
  },{a:'data:image/png;base64,'+shown.toString('base64'),b:'data:image/png;base64,'+background.toString('base64')});
  assert.ok(pixels>40,`${name}: SVG ink actually renders (${pixels} pixels), independent of font glyphs`);
  return {name,inkPixels:pixels};
}
export async function runBrowsingLayoutBrowser({origin,output,playwrightModule}) {
  const {chromium}=await import(playwrightModule);await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});const outcomes=[],errors=[];
  try {for(const theme of ['dark','light']) {
    const context=await browser.newContext({viewport:{width:1440,height:1100},hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/');await page.locator('#browse-family option[value="Extensions"]').waitFor({state:'attached'});
    if(await page.locator('#setup-dialog').isVisible()){await page.getByRole('radio',{name:/Vibe coder/}).check();for(let i=0;i<4;i++)await page.locator('#setup-next').click();await page.locator('#setup-dialog').waitFor({state:'hidden'});}
    const toggle=page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true});if(await toggle.count())await toggle.click();await page.evaluate(()=>document.fonts.ready);
    const tools=page.locator('#catalog-filter-disclosure');assert.equal(await tools.evaluate(n=>n.open),false);assert.equal(await page.locator('#package-disclosure').evaluate(n=>n.open),false);
    await chooseCatalogSupport(page,'all');await chooseCatalogFamily(page,'ECC');
    await page.screenshot({animations:'disabled',path:join(output,`${theme}-normal-ecc.png`)});
    await chooseCatalogFamily(page,'Extensions');await page.locator('#catalog-search').fill('grill-me');await page.locator('.wb-source-heading').click();
    const cards=page.locator('#cards-grid [data-card-id]');await cards.first().waitFor();const before=await cards.count();
    assert.equal(await page.locator('#browse-family').isVisible(),false,'Duplicate family selection stays secondary');
    const cardTop=(await cards.first().boundingBox()).y;assert.ok(cardTop<=350,`Normal browsing cards follow compact search/kinds near y300, observed ${cardTop}`);
    await page.screenshot({animations:'disabled',path:join(output,`${theme}-normal-extensions.png`)});
    const cardIcon=await captureIcon(page,cards.first().locator('.gap-indicator-trigger').first(),output,theme+'-card-info');
    await tools.locator('> summary').focus();await page.keyboard.press('Enter');await page.locator('#browse-family').waitFor();
    for(const selector of ['#browse-family','#browse-support','#personal-folder','#personal-binding','#catalog-reset-filters','#support-counts'])assert.ok(await page.locator(selector).isVisible(),`${selector}: supported secondary control/detail remains accessible`);
    const toolbarIcon=await captureIcon(page,page.locator('#review-filters .gap-indicator-trigger').first(),output,theme+'-secondary-info');
    await page.locator('#personal-folder').focus();assert.equal(await page.evaluate(()=>document.activeElement.id),'personal-folder');await page.screenshot({animations:'disabled',path:join(output,`${theme}-secondary-tools.png`)});await page.keyboard.press('Escape');assert.equal(await tools.evaluate(n=>n.open),false);assert.equal(await cards.count(),before,'Disclosure access does not discard actual rows');
    await cards.first().click();await page.waitForFunction(()=>document.getElementById('inspector-rail').getBoundingClientRect().width>=390);await page.screenshot({animations:'disabled',path:join(output,`${theme}-inspector.png`)});
    await addFromCatalog(page,'extensions.matt.grill-me');await page.locator('#your-setup').click();await page.screenshot({animations:'disabled',path:join(output,`${theme}-setup.png`)});await page.locator('#policy-back-to-catalog').click();
    await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await openCatalogFilters(page);await page.locator('#browse-family').waitFor();await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow-tools.png`)});await page.locator('#catalog-filters-close').tap();assert.equal(await tools.evaluate(n=>n.open),false,'Touch close dismisses narrow filters');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'catalog-filter-disclosure');await page.locator('#catalog-advanced > summary').tap();await page.locator('#catalog-advanced-close').tap();assert.equal(await page.locator('#catalog-advanced').evaluate(n=>n.open),false,'Touch close dismisses narrow Advanced');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'catalog-advanced');
    await page.locator('#cards-grid [data-card-id]').first().click();await page.locator('#inspector-rail[aria-modal="true"]').waitFor();await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow-inspector.png`)});await page.keyboard.press('Escape');await page.locator('#your-setup').click();await page.screenshot({animations:'disabled',path:join(output,`${theme}-narrow-setup.png`)});await page.keyboard.press('Escape');
    outcomes.push({theme,cardTop,actualRows:before,cardIcon,toolbarIcon,narrowWidth:390});await context.close();
  }assert.deepEqual(errors,[]);await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',outcomes,errors,functionalInstallLocationProof:'retained; unchanged execution and folder protection'},null,2));return outcomes;}finally{await browser.close();}
}

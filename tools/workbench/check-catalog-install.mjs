import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPrototypeServer } from './local-server.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Supply a packed consumer and a disposable output directory.');
const consumer = resolve(input);
const workspace = await mkdtemp(join(resolve(output), 'catalog-install-'));
const options = { consumer, workspace, sourceCache: join(consumer, 'source-cache.json') };
let host = await createPrototypeServer(options);
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const action = name => page.locator('[data-action="'+name+'"]:visible').first();
  const call = (name, button) => Promise.all([
    page.waitForResponse(r => r.url() === host.origin+'/api/'+name, {timeout:150000}).then(async r => { const value = await r.json(); assert.ok(r.ok(),JSON.stringify(value)); return value; }),
    button.click()
  ]).then(([result]) => result);
  const item = 'egm.skill.egm-draft';
  await page.goto(host.origin + '/?mode=vibe&view=catalog&item='+item);
  await action('catalog-add:'+item).click();
  const preview = await call('catalog-plan',action('catalog-plan'));
  assert.equal(preview.installable,true);
  await action('catalog-preview-toggle').click();
  await action('catalog-preview-toggle').click();
  const review = await call('catalog-prepare',action('catalog-prepare'));
  assert.equal(review.prepared.result.status,'ready');
  const installed = await call('apply',action('install'));
  assert.equal(installed.outcome.completion,'complete');
  assert.ok(installed.inventory.entries.some(entry => entry.managementId===item));
  assert.ok(installed.history.filter(entry => ['prepare','run'].includes(entry.kind)).every(entry => entry.guidance.status==='complete'));
  await host.close();
  // Restore the on-disk boundary left by a stop after Core wrote its receipt
  // and before the host finished recording the result.
  const intentPath=join(workspace,'vibe','intent.json');
  const intent=JSON.parse(await readFile(intentPath,'utf8'));
  const selection=Object.values(intent.catalogSelections)[0];
  intent.pendingCatalogApply={selection,request:intent.requests[selection.key]};
  delete intent.requests[selection.key];
  delete intent.catalogSelections[selection.key];
  await writeFile(intentPath,JSON.stringify(intent));
  host = await createPrototypeServer(options);
  await page.goto(host.origin+'/?view=installed&mode=vibe');
  const checked = await call('check',action('check'));
  assert.equal(checked.check.fileState,'match');
  assert.deepEqual(checked.coverage.untrackedInventory,[]);
  assert.equal(JSON.parse(await readFile(intentPath,'utf8')).pendingCatalogApply,null);
  const removal = await call('remove',action('remove:'+item));
  assert.equal(removal.prepared.operation,'remove');
  const removed = await call('apply',action('install'));
  assert.equal(removed.inventory.entries.length,0);
  await page.locator('[data-job="diagnostics"]').click();
  await page.getByRole('heading',{name:'No workspace report collected'}).waitFor();
  assert.equal(await page.getByText('82/100',{exact:true}).isVisible(),false);
  const report = await call('report',action('report'));
  assert.equal(report.report.status,'ok');
  await page.getByRole('heading',{name:'Workspace checks'}).waitFor();
  const diagnostics = await (await fetch(host.origin+'/reports/vibe/'+report.reportDigest+'.html')).text();
  assert.doesNotMatch(diagnostics,/Diagnostic contract undefined/);
  await page.getByText('View example',{exact:true}).click();
  const exampleHref=await page.getByRole('link',{name:/Open V9/}).getAttribute('href');
  for(const width of [1280,760,390]) {
    await page.setViewportSize({width,height:900});
    await page.locator('[data-job="choose"]').click();
    const boxes=await page.locator('[data-job]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    assert.ok(boxes.every(b=>b.left>=0 && b.right<=width+1),'All four jobs accessible at '+width);
    assert.equal(await page.title(),'Catalog & choices · AIHQ Workbench');
    await page.screenshot({path:join(workspace,'catalog-'+width+'.png')});
  }
  await page.goto(new URL(exampleHref,host.origin).href);
  const card=page.locator('.card.preview').filter({has:page.getByRole('heading',{name:'Outcome deltas'})});
  assert.ok(await card.evaluate(n=>n.querySelector('.card-head').getBoundingClientRect().top-n.getBoundingClientRect().top>20));
  assert.deepEqual(errors,[]);
  const receipt={workspace,item,operations:preview.plan.plan.length,check:checked.check.fileState,removed:true,report:report.reportDigest,widths:[1280,760,390]};
  await writeFile(join(workspace,'acceptance.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
} finally { await browser?.close(); await host.close(); }

import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createPrototypeServer} from './local-server.mjs';

const [consumer,output,sourceCache] = process.argv.slice(2);
if (!output) throw Error('Usage: node check-compact-presentation.mjs <consumer> <output-parent> [source-cache]');
const workspace=await mkdtemp(join(resolve(output),'compact-type-'));
const host=await createPrototypeServer({consumer,workspace,sourceCache});
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined)});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>{if(!request.url().startsWith(host.origin+'/')&&!request.url().startsWith('data:'))external.push(request.url());});
  await page.addInitScript(()=>{if(!sessionStorage.getItem('seeded-layout')){localStorage.setItem('workbench-prototype-layout-v1',JSON.stringify({scrollbar:'standard',rail:230,inspector:320,regions:{}}));sessionStorage.setItem('seeded-layout','yes');}});
  await page.goto(host.origin+'/?view=catalog&mode=vibe');await page.locator('#search').waitFor();
  assert.equal(await page.locator('#scrollbar-width,.scrollbar-preference').count(),0);
  const preferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('workbench-prototype-layout-v1')));
  assert.equal(preferences.scrollbar,undefined);assert.equal(preferences.rail,230);assert.equal(preferences.inspector,320);
  const type=await page.evaluate(()=>({family:getComputedStyle(document.body).fontFamily,size:getComputedStyle(document.body).fontSize,reading:getComputedStyle(document.querySelector('.session-selection-note')).fontSize,bar:getComputedStyle(document.querySelector('main'),'::-webkit-scrollbar').width}));
  assert.match(type.family,/Mono|Consolas|monospace/);assert.equal(type.size,'13px');assert.equal(type.reading,'13px');assert.equal(type.bar,'6px');
  async function thumbContrast(tab,selector,background) {
    return tab.evaluate(({selector,background})=>{
      function luminance(value){const channels=value.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
      const thumb=luminance(getComputedStyle(document.querySelector(selector),'::-webkit-scrollbar-thumb').backgroundColor),surface=luminance(getComputedStyle(document.querySelector(background)).backgroundColor);
      return (Math.max(thumb,surface)+.05)/(Math.min(thumb,surface)+.05);
    },{selector,background});
  }
  assert.ok(await thumbContrast(page,'main','main')>=3);
  const nav=page.locator('#navigation-divider');await nav.focus();const before=Number(await nav.getAttribute('aria-valuenow'));await nav.press('ArrowRight');assert.equal(Number(await nav.getAttribute('aria-valuenow')),before+10);
  await page.reload();await page.locator('#search').waitFor();assert.equal(Number(await nav.getAttribute('aria-valuenow')),before+10);
  await page.locator('#layout-reset').click();
  await page.waitForFunction(()=>!document.querySelector('.workspace').style.getPropertyValue('--rail-width'));
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('workbench-prototype-layout-v1'))),{regions:{}});
  assert.equal(await page.locator('#layout-announcement').innerText(),'Layout reset.');
  assert.equal(Number(await nav.getAttribute('aria-valuenow')),Math.round(await page.locator('#navigation-pane').evaluate(node=>node.getBoundingClientRect().width)));
  const oldTheme=await page.locator('html').getAttribute('class');await page.locator('#theme').click();assert.notEqual(await page.locator('html').getAttribute('class'),oldTheme);
  assert.ok(await thumbContrast(page,'main','main')>=3);
  await page.screenshot({path:join(workspace,'catalog-light-desktop.png')});
  await page.locator('#theme').click();await page.screenshot({path:join(workspace,'catalog-dark-desktop.png')});
  await page.setViewportSize({width:640,height:600});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.setViewportSize({width:1280,height:900});
  await page.goto(host.origin+'/?view=installed&mode=vibe');await page.locator('[data-action="toggle-instructions"]').click();
  const editor=page.locator('#instructions-text');await editor.fill(Array.from({length:50},(_,i)=>'Line '+i+' remains editable and resizable.').join('\n'));
  const toolbar=page.locator('.region-size-tools').filter({hasText:'Project instruction text'});await toolbar.waitFor();
  const oldHeight=await editor.evaluate(node=>node.getBoundingClientRect().height);await toolbar.getByRole('button',{name:/Increase height/}).click();
  assert.ok(await editor.evaluate(node=>node.getBoundingClientRect().height)>oldHeight);
  const expand=toolbar.getByRole('button',{name:/Expand or collapse/});await expand.focus();await expand.press('Enter');assert.equal(await expand.getAttribute('aria-expanded'),'true');await expand.press('Enter');assert.equal(await expand.getAttribute('aria-expanded'),'false');
  await page.emulateMedia({forcedColors:'active'});assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('main'),'::-webkit-scrollbar').width),'auto');
  await page.emulateMedia({forcedColors:'none'});
  const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),mobile=await touch.newPage();
  await mobile.goto(host.origin+'/?view=catalog&mode=vibe');await mobile.locator('#search').waitFor();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  assert.ok(await mobile.locator('#theme').evaluate(node=>node.getBoundingClientRect().height)>=44);
  const smallLabels=await mobile.locator('.top-actions button,.rail nav button,#catalog-client').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&parseFloat(getComputedStyle(node).fontSize)<12).map(node=>node.textContent));assert.deepEqual(smallLabels,[]);
  await mobile.screenshot({path:join(workspace,'catalog-mobile.png')});await touch.close();
  const session=await fetch(host.origin+'/api/session').then(response=>response.json());
  const response=await fetch(host.origin+'/api/report',{method:'POST',headers:{Origin:host.origin,'Content-Type':'application/json','X-Workbench-Token':session.token},body:JSON.stringify({mode:'vibe'})});assert.equal(response.status,200);const report=await response.json();
  assert.match(report.reportDigest,/^[a-f0-9]{64}$/);
  const reportFacts=[];
  for(const [name,path] of [['diagnostics','/reports/vibe/'+report.reportDigest+'.html'],['console','/reports/vibe/'+report.reportDigest+'/console.html']]) {
    const tab=await context.newPage();tab.on('pageerror',error=>errors.push(error.message));await tab.goto(host.origin+path);
    assert.equal(await tab.locator('#wide-report-bars,.report-scroll-option').count(),0);
    const facts=await tab.evaluate(()=>({family:getComputedStyle(document.body).fontFamily,size:getComputedStyle(document.body).fontSize,bar:getComputedStyle(document.documentElement,'::-webkit-scrollbar').width}));
    assert.match(facts.family,/Mono|Consolas|monospace/);assert.equal(facts.size,'13px');assert.equal(facts.bar,'6px');reportFacts.push({name,...facts});
    assert.ok(await thumbContrast(tab,'html','body')>=3);
    const smallControls=await tab.locator('button,input,select,label,[role="tab"]').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&parseFloat(getComputedStyle(node).fontSize)<12).map(node=>({text:node.textContent,class:node.className,size:getComputedStyle(node).fontSize})));assert.deepEqual(smallControls,[]);
    await tab.keyboard.press('Control+k');await tab.locator('#palette.open').waitFor();await tab.keyboard.press('ArrowDown');await tab.keyboard.press('Escape');assert.equal(await tab.locator('#palette.open').count(),0);
    const toggle=tab.locator('[onclick*="aihTheme"]').first();if(await toggle.count())await toggle.click();
    await tab.screenshot({path:join(workspace,name+'-desktop.png')});
    await tab.setViewportSize({width:390,height:844});assert.ok(await tab.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await tab.screenshot({path:join(workspace,name+'-mobile.png')});
    await tab.emulateMedia({forcedColors:'active'});assert.equal(await tab.evaluate(()=>getComputedStyle(document.documentElement,'::-webkit-scrollbar').width),'auto');await tab.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={status:'passed',workspace,type,reports:reportFacts,checks:['local monospace and readable labels','slim bars without preference controls','legacy layout migration','keyboard resize and reset','region expand/collapse','theme switching and thumb contrast','640px reflow and mobile/touch targets','report palette keyboard navigation','forced-color native scrollbars','no external runtime or font requests']};
  await writeFile(join(workspace,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{try{await browser?.close();}finally{await host.close();}}

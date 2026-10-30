// One tool list, on the running page: first-run setup as an Enterprise Admin ticks the owner's eleven tools in the
// Your tools step, and the header's Your tools and the FRAMEWORKS rail then hold exactly those eleven, by Core's labels.
// Setup offers Core's own listTools({ includeUnobserved: true }), in its order and with its labels, read here through the
// same public export the host reads; a tool Core does not support yet is offered, stays chosen and says so in words.
// No raw tool id and no Core function name is shown anywhere on the page.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listTools } from '@aihq/core/harness';
import { OWNER_SETTINGS } from './your-tools-browser.mjs';

const CODE_WORDS = /nativeClientIds|listTools|tool-not-observed|PREREQUISITE_UNAVAILABLE|AI clients/;

export async function runOneToolListBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const all = listTools({ includeUnobserved: true }), observed = new Set(listTools().map(tool => tool.id));
  const chosen = all.filter(tool => OWNER_SETTINGS.clients.includes(tool.id));
  assert.equal(chosen.length, OWNER_SETTINGS.clients.length, 'Core lists every one of the owner\'s tools');
  const labels = chosen.map(tool => tool.label), ids = chosen.map(tool => tool.id);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('#setup-dialog').waitFor();
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    await page.getByRole('radio', { name: /Enterprise/ }).first().check(); await page.locator('#setup-next').click();
    await page.getByRole('radio', { name: /Admin/ }).first().check(); await page.locator('#setup-next').click();
    await page.fill('#setup-field-name', 'Gosam'); await page.fill('#setup-field-shortId', 'gosam');
    await page.fill('#setup-field-policyRepo', 'github.com/samartomar/test'); await page.fill('#setup-field-emails', 'owner@example.invalid');
    await page.locator('#setup-next').click();

    // The Your tools step: Core's list, its order and labels; no raw id, no Core code word.
    assert.equal(await page.locator('#setup-title').innerText(), 'Your tools');
    await page.locator('#setup-content .setup-choice').first().waitFor();
    const offered = await page.locator('#setup-content .setup-choice').evaluateAll(rows => rows.map(row => ({ id: row.dataset.tool, text: row.innerText.trim() })));
    assert.deepEqual(offered.map(row => row.id), all.map(tool => tool.id), 'setup offers Core\'s tool list, in its order');
    for (const [index, row] of offered.entries()) {
      const tool = all[index];
      assert.deepEqual(row.text.split('\n').map(line => line.trim()).filter(Boolean), observed.has(tool.id) ? [tool.label] : [tool.label, 'Not supported yet'], `${tool.id}: Core's label${observed.has(tool.id) ? '' : ', not supported yet in words'}, never its id`);
    }
    const step = await page.locator('#setup-dialog').innerText();
    assert.doesNotMatch(step, CODE_WORDS);
    for (const tool of chosen) await page.locator(`#setup-content .setup-choice[data-tool="${tool.id}"] input`).check();
    await page.locator('#setup-next').click();
    const review = await page.locator('#setup-content').innerText();
    assert.match(review, new RegExp(`Your tools\\s+${labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(', ')}`), 'the review names the chosen tools by Core\'s labels');
    await page.screenshot({ path: join(output, `01-setup-review-${theme}.png`) });
    await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();

    // The header holds exactly the eleven, by Core's labels, as a multi-select.
    await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
    assert.equal(await page.locator('#your-tool-name').innerText(), labels.join(', '), 'the header names every tool chosen in setup');
    await page.locator('#your-tool-trigger').click();
    assert.equal(await page.locator('#your-tool-list').getAttribute('role'), 'group');
    assert.deepEqual(await page.locator('#your-tool-list [role="checkbox"][aria-checked="true"]').evaluateAll(rows => rows.map(row => row.dataset.tool)), ids);
    for (const tool of chosen.filter(value => !observed.has(value.id))) {
      assert.match(await page.locator(`#your-tool-list [data-tool="${tool.id}"]`).innerText(), /Not supported yet/, `${tool.label} stays chosen and says it is not supported yet`);
    }
    await page.screenshot({ path: join(output, `02-header-${theme}.png`) });
    await page.keyboard.press('Escape');

    // The rail's observations note names the same eleven and says plainly which have none yet.
    const note = page.locator('#framework-navigation [data-compatibility-note]');
    await note.waitFor({ state: 'attached' });
    assert.deepEqual((await note.getAttribute('data-tools')).split(' '), ids);
    const summary = await note.locator('summary').innerText();
    const unsupported = chosen.filter(tool => !observed.has(tool.id)).map(tool => tool.label);
    assert.equal(summary, `Compatibility observations for ${labels.join(', ')}.${unsupported.length ? ` None yet for ${unsupported.join(', ')}: not supported yet.` : ''}`);

    // No Core code word anywhere on the page, and no raw tool id in a control that shows tools (Catalog's own content
    // may name a tool in its descriptions).
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), CODE_WORDS);
    await page.locator('#your-tool-trigger').click();
    const controls = [step, review, ...await Promise.all(['#your-tool-trigger', '#your-tool-pop', '#framework-navigation'].map(selector => page.locator(selector).innerText()))].join('\n');
    await page.keyboard.press('Escape');
    const words = new Set(controls.split(/[\s,.:;()·]+/));
    const raw = all.map(tool => tool.id).filter(id => words.has(id));
    assert.deepEqual(raw, [], 'no raw tool id is shown');
    assert.deepEqual(errors, []);
    return { status: 'passed', setup: offered.length, header: ids, rail: ids };
  } finally {
    await browser.close();
  }
}

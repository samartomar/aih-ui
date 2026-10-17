// Visual check of the V9 renderer in Chromium, relocated with the renderer from Core
// (scripts/verify-report-visual.mjs). For one snapshot it renders report and demo mode, loads each with
// scripts off (static) and on (hydrated), and records full-page and first-screen screenshots plus
// visual-check.json in a new evidence folder. It fails on a page error, a console error, any network
// request, a missing section, an invisible or mis-sized outcome bar, report-mode states other than
// 5 LIVE and 9 EMPTY, hydrated sections that differ from the static ones, or a broken Ctrl+K palette.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECTION_IDS } from '../../src/report/render.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** `renderer` is loadReportRenderer()'s result; `snapshot` a snapshot value it accepts; `output` a folder that must not exist yet. */
export async function runReportVisual({ renderer, snapshot, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule ?? process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href);
  await mkdir(output);
  const { data, renderReport } = renderer;
  const channel = process.env.REPORT_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const errors = [], sections = {};
  const record = { snapshotSha256: createHash('sha256').update(data.exportSnapshot(snapshot)).digest('hex'),
    renderer: 'aih-ui src/report/render.js', coreVersion: renderer.version, browser: channel ?? `chromium ${browser.version()}`, modes: {}, errors };
  try {
    for (const mode of ['report', 'demo']) {
      const html = renderReport(snapshot, { mode });
      for (const javaScriptEnabled of [false, true]) {
        const label = `${mode}-${javaScriptEnabled ? 'hydrated' : 'static'}`;
        const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
        page.on('request', request => { if (/^https?:/.test(request.url())) errors.push(`${label}: network request`); });
        await page.setContent(html, { waitUntil: 'load' });
        const content = await page.locator('main section').evaluateAll(nodes => nodes.map(node => ({ id: node.id, state: node.getAttribute('data-state'), html: node.innerHTML })));
        assert.deepEqual(content.map(section => section.id), SECTION_IDS, `${label}: the 14 V9 sections in order`);
        const bars = await page.locator('.mat-fill').evaluateAll(nodes => nodes.map(node => ({
          percent: parseFloat(node.style.width), width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height, trackWidth: node.parentElement.getBoundingClientRect().width,
        })));
        assert.ok(bars.some(bar => bar.percent > 0), `${label}: expected nonzero outcome bars`);
        for (const bar of bars.filter(bar => bar.percent > 0)) {
          assert.ok(bar.height > 0 && bar.width > 0, `${label}: a nonzero outcome bar must be visible`);
          assert.ok(Math.abs(bar.width - bar.trackWidth * bar.percent / 100) < 2, `${label}: an outcome bar's width must match its proportion`);
        }
        if (mode === 'report') {
          assert.equal(content.filter(section => section.state === 'empty').length, 9, `${label}: 9 EMPTY sections`);
          assert.equal(content.filter(section => section.state === 'live').length, 5, `${label}: 5 LIVE sections`);
        } else {
          assert.equal(await page.locator('body[data-demo="on"] .demo-banner').count(), 1, `${label}: the design sample carries its DEMO banner`);
          assert.match(await page.locator('.demo-banner').innerText(), /Design sample/, `${label}: the banner says design sample`);
        }
        if (javaScriptEnabled) {
          if (mode === 'report') assert.deepEqual(content, sections[mode], `${label}: hydration re-applies the static sections exactly`);
          await page.keyboard.press('Control+k');
          assert.equal(await page.locator('#palette.open').count(), 1, `${label}: Ctrl+K opens the palette`);
          assert.equal(await page.locator('.palette-item').count(), 14, `${label}: the palette lists every section`);
          await page.keyboard.press('Escape');
        } else sections[mode] = content;
        await page.screenshot({ path: join(output, `${label}.png`), fullPage: true });
        await page.screenshot({ path: join(output, `${label}-hero.png`) });
        record.modes[label] = { sections: content.length, visibleBars: bars.filter(bar => bar.percent > 0).length,
          ...(javaScriptEnabled && mode === 'report' ? { staticHydratedMatch: true } : {}) };
        await context.close();
      }
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'visual-check.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally { await browser.close(); }
}

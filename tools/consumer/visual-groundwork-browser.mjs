import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The visual groundwork, on the running page: one icon map and one tooltip helper (every icon carries its words,
// reachable by keyboard focus and by touch; icon-only buttons are named), the new colour roles at 4.5:1 in the theme
// shown, only neutral scan words across the catalog, inspector and drawer, and the start-up contract-check message in
// each of its states. The host's own answer is checked first (`actual`: what this host's installed packages really
// say); the other states come from fixtures (fixtures/contract-check/states) served in place of the host's answer.
const here = dirname(fileURLToPath(import.meta.url));
const STATES = join(here, 'fixtures', 'contract-check', 'states');
const POSITIVE = /\b(matched|passed|safe|clean|secure|trusted|no findings|verified)\b/i;
const CONTRACT_CHECK_ABSENT = "This Core can't check contracts yet.";

const luminance = ([r, g, b]) => { const [x, y, z] = [r, g, b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = value => {
  const text = value.trim();
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  const css = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(text);
  assert.ok(hex || css, `a colour: ${value}`);
  return hex ? hex.slice(1).map(v => parseInt(v, 16)) : css.slice(1).map(Number);
};

async function openPage(browser, origin, theme, { touch = false, route } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: touch });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  if (route) await page.route('**/api/contract-check', route);
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const destination = `Switch to ${theme} mode`;
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.mode), theme, `The page shows the ${theme} theme.`);
  return { context, page };
}

const bubble = page => page.locator('#wb-tooltip');
// Keyboard focus from the stop before: the shared bubble shows the element's own words.
async function tabTo(page, before, target) {
  await before.focus();
  await page.keyboard.press('Tab');
  assert.equal(await target.evaluate(node => node === document.activeElement), true, 'Tab reaches the element after the one before it.');
  await bubble(page).waitFor({ state: 'visible' });
  assert.equal(await bubble(page).innerText(), await target.getAttribute('data-tooltip'), 'The focus bubble carries the tooltip words.');
}

// Every visible icon is inside an element with a tooltip or a gap indicator; every tooltip is reachable by keyboard;
// every icon-only button is named.
async function auditIcons(page, where) {
  const found = await page.evaluate(() => {
    const visible = node => node.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    const reachable = node => (node.tabIndex >= 0 && !node.disabled) || node.closest('.gap-indicator')
      || (node.matches('[role=tab][tabindex="-1"]') && node.closest('[role=tablist]')?.querySelector('[role=tab][tabindex="0"]'));
    const icons = [...document.querySelectorAll('.material-symbols-outlined')].filter(visible);
    const untipped = icons.filter(node => !node.closest('[data-tooltip],.gap-indicator') && !node.parentElement?.querySelector(':scope > .gap-indicator')).map(node => `${node.textContent.trim()} in #${node.closest('[id]')?.id ?? '?'}`);
    const unreachable = [...document.querySelectorAll('[data-tooltip]')].filter(visible).filter(node => !reachable(node)).map(node => node.outerHTML.slice(0, 100));
    // A stop the keyboard reaches is never hidden from assistive technology.
    const silent = [...document.querySelectorAll('[tabindex="0"], [data-tooltip]')].filter(visible).filter(node => node.closest('[aria-hidden="true"]')).map(node => node.outerHTML.slice(0, 100));
    const unnamed = [...document.querySelectorAll('button, [role="button"], a[href], summary')].filter(visible).filter(node => {
      const words = [...node.childNodes].filter(child => !child.classList?.contains('material-symbols-outlined')).map(child => child.textContent).join('').trim();
      return !words && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby');
    }).map(node => node.outerHTML.slice(0, 100));
    return { count: icons.length, untipped: [...new Set(untipped)], unreachable, unnamed, silent };
  });
  assert.ok(found.count > 0, `${where}: icons are shown`);
  assert.deepEqual(found.untipped, [], `${where}: every icon has a tooltip`);
  assert.deepEqual(found.unreachable, [], `${where}: every tooltip is reachable by keyboard focus`);
  assert.deepEqual(found.unnamed, [], `${where}: every icon-only control has an accessible name`);
  assert.deepEqual(found.silent, [], `${where}: nothing focusable is hidden from assistive technology`);
  // Green is kept for Verified and confirmed on disk: no other shown text or icon is drawn in the success role.
  const green = await page.evaluate(() => {
    const success = getComputedStyle(document.documentElement).getPropertyValue('--color-success').trim();
    const probe = document.createElement('span'); probe.style.color = success; document.body.append(probe);
    const colour = getComputedStyle(probe).color; probe.remove();
    return [...document.querySelectorAll('body *')].filter(node => node.checkVisibility({ visibilityProperty: true }) && node.childNodes.length
      && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && getComputedStyle(node).color === colour
      && !node.closest('[data-icon="scan:verified"], [data-icon="state:confirmed-on-disk"]')).map(node => `${node.textContent.trim().slice(0, 40)} in #${node.closest('[id]')?.id ?? '?'}`);
  });
  assert.deepEqual(green, [], `${where}: green only for Verified and confirmed on disk`);
  return found.count;
}

// The Workbench's own scan words in a region: its scan-state pills and their tooltips, and the region's words with
// the item's own description (content, not a scan word) left out.
async function scanWords(locator) {
  return locator.evaluate(root => {
    const copy = root.cloneNode(true);
    for (const node of copy.querySelectorAll('.wb-card-description, #details-desc, .wb-card-title, #inspector-name, [data-item-content]')) node.remove();
    const tips = [...root.querySelectorAll('[data-evidence-state], [data-evidence-state] *')].map(node => node.getAttribute('title') ?? '');
    return `${copy.innerText}\n${tips.join('\n')}`;
  });
}
const positive = text => text.replace(/not verified/gi, '').split('\n').filter(line => POSITIVE.test(line));

async function expectNote(page, state, words) {
  const packages = page.locator('#package-disclosure');
  if (!await packages.evaluate(node => node.open)) await packages.locator('summary').click();
  const note = page.locator(`#contract-check-note[data-contract-check="${state}"]`);
  await note.waitFor();
  if (words) assert.equal(await note.locator('span').last().innerText(), words);
  return note;
}

export async function runVisualGroundworkBrowser({ origin, output, playwrightModule, theme = 'dark', actual = 'host', readers = [], item = 'extensions.matt.grill-me' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    // ---------------------------------------------------------------- the host's own start-up answer
    let { context, page } = await openPage(browser, origin, theme);
    page.on('pageerror', error => errors.push(error.message));
    const answer = await (await page.request.get(origin + '/api/contract-check')).json();
    if (actual === 'absent') assert.equal(answer.state, 'absent', 'This host installed a Core without checkContracts.');
    if (answer.state === 'absent') {
      await expectNote(page, 'unavailable', CONTRACT_CHECK_ABSENT);
    } else {
      assert.equal(answer.state, 'ran', JSON.stringify(answer).slice(0, 300));
      const failed = answer.checks.filter(row => row.status === 'failed');
      if (actual === 'refused') assert.ok(failed.length > 0, 'The host was given a declaration a package refuses.');
      if (failed.length) {
        const first = failed[0];
        await expectNote(page, 'cant-read');
        assert.match(await page.locator('#contract-check-note').innerText(), new RegExp(`${first.updatePackage.replace(/[/@.]/g, '\\$&')} \\S+ can't read ${first.contractId.replace(/[.:]/g, '\\$&')}; update ${first.updatePackage.replace(/[/@.]/g, '\\$&')}\\.`));
      } else if (answer.checks.some(row => row.status === 'unavailable')) await expectNote(page, 'unavailable');
      else if (!answer.checks.length) await expectNote(page, 'empty');
      else assert.equal(await page.locator('#contract-check-note').count(), 0, 'Nothing is shown when every required check passed.');
      // The Workbench's own readers (aih-ui/stored-results) run for every Core result fixture they have a validator for; a row without one is
      // named on the page as a check that cannot run, never as passed. `readers` says which the host's Core must let the Workbench run.
      const tooltip = (await page.locator('#contract-check-note').getAttribute('data-tooltip').catch(() => null)) ?? '';
      const workbenchRows = answer.checks.filter(row => row.readerPackage === 'aih-ui');
      for (const id of readers) assert.ok(workbenchRows.some(row => row.contractId === id), `The host checked the Workbench's reader for ${id}.`);
      for (const row of workbenchRows) {
        const listed = tooltip.includes(`reads ${row.contractId} from ${row.fixturePackage}`);
        if (readers.includes(row.contractId) || row.contractId === 'urn:aihq:core:native-verification-result:1.0.0') assert.equal(row.status, 'passed', JSON.stringify(row));
        if (row.status === 'passed') {
          assert.equal(listed, false, `The Workbench's own reader for ${row.contractId} is not listed as missing.`);
        } else {
          assert.deepEqual([row.contractId, row.status, row.reason], ['urn:aihq:core:file-state-result:1.1.0', 'unavailable', 'reader-missing']);
          assert.ok(tooltip.includes(`reads ${row.contractId} from @aihq/core: the Workbench has no reader it can run for it.`), 'The page names the file-state check that cannot run.');
        }
      }
    }
    await page.screenshot({ path: join(output, `01-startup-${actual}.png`) });

    // ------------------------------------------------------------- icons, tooltips and keyboard focus
    const strip = await auditIcons(page, 'catalog');
    const card = page.locator('[data-card-id]').first();
    const kindIcon = card.locator('[data-icon^="kind:"]').first();
    await tabTo(page, card, kindIcon);
    const packages = page.locator('#package-disclosure > summary');
    if (await page.locator('#contract-check-note').count()) await tabTo(page, packages, page.locator('#contract-check-note'));
    // Behind Advanced, the greyed token tile keeps its reason reachable by keyboard.
    await page.locator('#catalog-advanced > summary').click();
    const tokens = page.locator('[data-metric="tokens"]');
    assert.equal(await tokens.getAttribute('aria-disabled'), 'true');
    await tabTo(page, page.locator('[data-metric]').nth(-2), tokens);
    const advanced = await auditIcons(page, 'catalog with Advanced open');

    // ------------------------------------------------------------- colour roles in this theme, measured on the page
    const roles = await page.evaluate(() => Object.fromEntries(['kind-hook', 'kind-rule', 'kind-document', 'info', 'info-bg', 'canvas', 'panel', 'card', 'subtle', 'hover']
      .map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()])));
    for (const name of ['kind-hook', 'kind-rule', 'kind-document', 'info']) for (const surface of ['canvas', 'panel', 'card', 'subtle', 'hover']) {
      const ratio = contrast(rgb(roles[name]), rgb(roles[surface]));
      assert.ok(ratio >= 4.5, `${theme}: ${name} on ${surface} is ${ratio.toFixed(2)}:1`);
    }
    assert.ok(contrast(rgb(roles.info), rgb(roles['info-bg'])) >= 4.5, `${theme}: info on info-bg`);
    // The new roles are palette values only in the two root themes; everything else uses them by name.
    const definedAt = await page.evaluate(() => {
      const names = ['--color-kind-hook', '--color-kind-rule', '--color-kind-document', '--color-info', '--color-info-bg'];
      const found = [];
      const walk = rules => { for (const rule of rules) { if (rule.cssRules) walk(rule.cssRules); if (rule.style) for (const name of names) if (rule.style.getPropertyValue(name)) found.push(`${rule.selectorText} ${name}`); } };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* a cross-origin font sheet */ } }
      return found;
    });
    assert.ok(definedAt.length >= 10, `each new role is defined in both themes: ${definedAt.join(', ')}`);
    assert.deepEqual([...new Set(definedAt.map(line => line.split(' ')[0]))].sort(), [':root', 'html.light'], 'only the root themes define the new roles');
    const hookIcon = page.locator(`[data-kind='"hook"'] [data-icon="kind:hook"]`).first();
    if (await hookIcon.count()) {
      const [color, hook] = [await hookIcon.evaluate(node => getComputedStyle(node).color), roles['kind-hook']];
      assert.deepEqual(rgb(color), rgb(hook), 'The hook icon is drawn in the hook role.');
      const [r, g, b] = rgb(color); assert.ok(r > g && g > b, `the hook accent is orange: ${color}`);
    }

    // ------------------------------------------------------------- neutral scan words: catalog, inspector, drawer
    assert.deepEqual(positive(await scanWords(page.locator('#cards-grid'))), [], 'catalog: no positive scan word');
    await card.click();
    await page.locator('#tab-details').focus();
    for (const id of ['tab-security', 'tab-json', 'tab-details']) {
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.id), id, 'Arrow keys reach every inspector tab.');
      await bubble(page).waitFor({ state: 'visible' });
      assert.equal(await bubble(page).innerText(), await page.locator(`#${id}`).getAttribute('data-tooltip'));
    }
    await page.locator('#tab-security').click();
    await page.locator('#pane-security').waitFor();
    assert.deepEqual(positive(await scanWords(page.locator('#inspector-rail'))), [], 'inspector: no positive scan word');
    const inspectorIcons = await auditIcons(page, 'inspector');
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#catalog-search').fill(item.split('.').at(-1));
    await page.getByRole('button', { name: `Add ${item}`, exact: true }).click();
    await page.locator('#added-notice-message').filter({ hasText: /^Added / }).waitFor();
    await page.locator('#your-setup').click();
    const drawer = page.locator('#policy-review-panel');
    await drawer.waitFor();
    assert.deepEqual(positive(await scanWords(drawer)), [], 'drawer: no positive scan word');
    const drawerIcons = await auditIcons(page, 'drawer');
    await page.screenshot({ path: join(output, '02-drawer.png') });
    await context.close();

    // ------------------------------------------------------------- touch: the same words on a tap
    ({ context, page } = await openPage(browser, origin, theme, { touch: true }));
    const gap = page.locator('#cards-grid .gap-indicator-trigger').filter({ visible: true }).first();
    await gap.tap();
    assert.equal(await gap.locator('xpath=following-sibling::*[@role="tooltip"]').isVisible(), true, 'A tap shows a gap indicator\'s reason.');
    const touched = page.locator('#cards-grid [data-card-id] [data-icon^="kind:"]').filter({ visible: true }).first();
    await touched.tap();
    await bubble(page).waitFor({ state: 'visible' });
    assert.equal(await bubble(page).innerText(), await touched.getAttribute('data-tooltip'), 'A tap shows the icon\'s words.');
    await page.screenshot({ path: join(output, '03-touch.png') });
    await context.close();

    // ------------------------------------------------------------- each message state from its fixture
    let release;
    const held = new Promise(resolve => { release = resolve; });
    ({ context, page } = await openPage(browser, origin, theme, { route: async route => { await held; await route.fulfill({ path: join(STATES, 'loading.json'), contentType: 'application/json' }); } }));
    const loading = await expectNote(page, 'loading', 'Checking contracts…');
    assert.equal(await loading.getAttribute('aria-busy'), 'true');
    await page.screenshot({ path: join(output, '04-state-loading.png') });
    release();
    await expectNote(page, 'unavailable', CONTRACT_CHECK_ABSENT);
    await context.close();
    const expected = {
      empty: ['empty', 'No contract checks apply.'],
      unavailable: ['unavailable', CONTRACT_CHECK_ABSENT],
      failed: ['failed', 'The contract check failed.'],
      'cant-read': ['cant-read', "@aihq/core 1.0.0-dev.37 can't read urn:aihq:core:execution-policy:1.3.0; update @aihq/core."],
    };
    const tones = {};
    for (const [fixture, [state, words]] of Object.entries(expected)) {
      ({ context, page } = await openPage(browser, origin, theme, { route: route => route.fulfill({ path: join(STATES, `${fixture}.json`), contentType: 'application/json' }) }));
      const note = await expectNote(page, state, words);
      const fixtureAnswer = JSON.parse(await readFile(join(STATES, `${fixture}.json`), 'utf8'));
      if (fixture === 'cant-read') assert.match(await note.getAttribute('data-tooltip'), /Can't check that @aihq\/catalog 0\.1\.0 reads urn:aihq:core:recipe:1\.0\.0/, 'The detail names a check that cannot run.');
      if (fixture === 'failed') assert.ok((await note.getAttribute('data-tooltip')).includes(fixtureAnswer.reason));
      assert.ok((await note.getAttribute('data-tooltip')).includes('Nothing is blocked') || fixture === 'empty', 'The message blocks nothing.');
      const [color, background] = await note.evaluate(node => [getComputedStyle(node).color, getComputedStyle(node).backgroundColor]);
      tones[state] = contrast(rgb(color), rgb(background));
      assert.ok(tones[state] >= 4.5, `${theme} ${state} message: ${tones[state].toFixed(2)}:1`);
      await tabTo(page, page.locator('#package-disclosure > summary'), note);
      await page.screenshot({ path: join(output, `05-state-${fixture}.png`) });
      await context.close();
    }
    assert.deepEqual(errors, [], 'The page raised no errors.');
    return { theme, actual: answer.state, iconCounts: { catalog: strip, advanced, inspector: inspectorIcons, drawer: drawerIcons }, messageContrast: tones };
  } finally {
    await browser.close();
  }
}

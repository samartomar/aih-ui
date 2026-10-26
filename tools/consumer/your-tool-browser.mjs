import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTools } from '@aihq/core/harness';

// V1 header Your tool, on the running page. The list is the installed packed Core's own listTools({ includeUnobserved:
// true }), read here through the same public export the host reads: observed tools (listTools()) can be chosen, every
// other tool stays listed and greyed with Core's refusal reason. Each ready icon is the tool's state in the host's Core
// inspect answer. The choice survives a restart of the host, there is one tool control, every row's tooltip is
// reachable by keyboard focus and touch, and its words meet 4.5:1 in the theme shown. The empty, loading, unavailable
// and failed states come from fixtures (fixtures/your-tool) served in place of the host's answer.
const here = dirname(fileURLToPath(import.meta.url));
const STATES = join(here, 'fixtures', 'your-tool');
const KEY = 'wb-your-tool';

const luminance = ([r, g, b]) => { const [x, y, z] = [r, g, b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = value => { const found = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value.trim()); assert.ok(found, `a colour: ${value}`); return found.slice(1).map(Number); };

async function openPage(context, origin, theme, { route } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  if (route) await page.route('**/api/tools', route);
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
  return page;
}

const trigger = page => page.locator('#your-tool-trigger');
const rows = page => page.locator('#your-tool-list > button');
const bubble = page => page.locator('#wb-tooltip');
async function open(page) {
  if (await page.locator('#your-tool-pop').isHidden()) await trigger(page).click();
  await page.locator('#your-tool-pop').waitFor();
}

// Every word and icon in the open control against the popup's own background.
async function contrasts(page) {
  return page.evaluate(() => {
    const pop = document.getElementById('your-tool-pop');
    const background = getComputedStyle(pop).backgroundColor;
    const shown = [...pop.querySelectorAll('*')].filter(node => node.checkVisibility() && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()));
    return { background, colours: shown.map(node => ({ text: node.textContent.trim().slice(0, 40), colour: getComputedStyle(node).color, own: getComputedStyle(node.closest('[aria-checked="true"]') ?? pop).backgroundColor })) };
  });
}

export async function runYourToolBrowser({ origin, output, playwrightModule, theme = 'dark', restart }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const all = listTools({ includeUnobserved: true }), observed = new Set(listTools().map(tool => tool.id));
  assert.ok(all.length > observed.size && observed.size > 0, 'The installed Core lists observed and unobserved tools.');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    // ------------------------------------------------------------------- the host's own answer
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    let page = await openPage(context, origin, theme);
    page.on('pageerror', error => errors.push(error.message));
    const inspection = await (await page.request.get(origin + '/api/tool-inspection')).json();
    assert.equal(inspection.state, 'inspected', JSON.stringify(inspection).slice(0, 300));
    assert.equal(await page.locator('#your-tool-trigger, #ai-tools-trigger').count(), 1, 'There is one tool control on the page.');
    assert.equal(await page.locator('[role="radiogroup"]').count(), 1, 'There is one tool list on the page.');
    await open(page);
    // The icons settle once the inspection has answered.
    await page.locator('#your-tool-list [data-icon="tool:checking"]').first().waitFor({ state: 'detached' });
    const shown = await rows(page).evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.tool, name: node.querySelector('.your-tool-option-name').textContent,
      disabled: node.getAttribute('aria-disabled') === 'true', icon: node.querySelector('[data-icon]').dataset.icon, tip: node.dataset.tooltip })));
    assert.deepEqual(shown.map(row => [row.id, row.name]), all.map(tool => [tool.id, tool.label]), 'The list is Core\'s listTools({ includeUnobserved: true }), in its order and with its labels.');
    for (const row of shown) {
      assert.equal(row.disabled, !observed.has(row.id), `${row.id}: choosable exactly when listTools() offers it`);
      const found = inspection.tools.find(tool => tool.id === row.id);
      assert.equal(row.icon, `tool:${found ? found.state : 'not-reported'}`, `${row.id}: the ready icon is Core inspect's state`);
      if (row.disabled) assert.match(row.tip, /Can't be chosen: Core hasn't observed it working \(tool-not-observed\)\./, `${row.id}: greyed with Core's reason`);
    }
    assert.ok(shown.some(row => row.disabled && all.find(tool => tool.id === row.id).surface === 'ide'), 'Unobserved IDEs are listed, greyed.');
    await page.screenshot({ path: join(output, `01-your-tool-list-${theme}.png`) });

    // Words and icons at 4.5:1 against the popup in this theme.
    const measured = await contrasts(page);
    for (const item of measured.colours) assert.ok(contrast(rgb(item.colour), rgb(item.own)) >= 4.5, `"${item.text}" meets 4.5:1 in ${theme} (${item.colour} on ${item.own})`);
    const icons = await page.locator('#your-tool-list .material-symbols-outlined').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
    for (const colour of icons) assert.ok(contrast(rgb(colour), rgb(measured.background)) >= 4.5, `an icon meets 4.5:1 in ${theme} (${colour})`);

    // A greyed tool does nothing when clicked; an observed one becomes Your tool.
    const unobserved = shown.find(row => row.disabled), first = shown.find(row => !row.disabled);
    await page.locator(`#your-tool-list > button[data-tool="${unobserved.id}"]`).click({ force: true });
    assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null, 'A greyed tool cannot be chosen.');
    await page.locator(`#your-tool-list > button[data-tool="${first.id}"]`).click();
    await page.locator('#your-tool-pop').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#your-tool-name').innerText(), first.name);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('tool'))), [KEY], 'Only the tool id is kept in browser storage.');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), first.id);

    // Keyboard: the trigger's tooltip, then a greyed row's reason, each in the focus bubble.
    await page.locator('#your-setup').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await trigger(page).evaluate(node => node === document.activeElement), true, 'The keyboard reaches Your tool.');
    await bubble(page).waitFor({ state: 'visible' });
    assert.equal(await bubble(page).innerText(), await trigger(page).getAttribute('data-tooltip'));
    assert.match(await bubble(page).innerText(), new RegExp(`^Your tool: ${first.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Core's inspection`));
    await page.keyboard.press('Enter');
    await page.locator('#your-tool-pop').waitFor();
    assert.equal(await page.locator(`#your-tool-list > button[data-tool="${first.id}"]`).evaluate(node => node === document.activeElement), true, 'Opening focuses Your tool.');
    const greyed = page.locator(`#your-tool-list > button[data-tool="${unobserved.id}"]`);
    for (let step = 0; step < all.length && !(await greyed.evaluate(node => node === document.activeElement)); step++) await page.keyboard.press('Tab');
    assert.equal(await greyed.evaluate(node => node === document.activeElement), true, 'The keyboard reaches a greyed tool.');
    await bubble(page).waitFor({ state: 'visible' });
    assert.equal(await bubble(page).innerText(), unobserved.tip, 'Its reason shows on keyboard focus.');
    await page.screenshot({ path: join(output, `02-your-tool-keyboard-${theme}.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Touch: tapping a greyed tool shows its reason and leaves the choice alone.
    await open(page);
    await bubble(page).evaluate(node => { node.hidden = true; });
    await greyed.tap({ force: true });
    await bubble(page).waitFor({ state: 'visible' });
    assert.equal(await bubble(page).innerText(), unobserved.tip, 'Its reason shows on touch.');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), first.id);
    await page.screenshot({ path: join(output, `03-your-tool-touch-${theme}.png`) });
    await page.close();

    // ----------------------------------------------------------- the choice survives a restart
    if (restart) {
      await restart();
      page = await openPage(context, origin, theme);
      page.on('pageerror', error => errors.push(error.message));
      await page.locator(`#your-tool-trigger[data-your-tool="listed"]`).waitFor();
      assert.equal(await page.locator('#your-tool-name').innerText(), first.name, 'Your tool survives a restart of the Workbench.');
      await open(page);
      assert.equal(await page.locator(`#your-tool-list > button[data-tool="${first.id}"]`).getAttribute('aria-checked'), 'true');
      await page.screenshot({ path: join(output, `04-your-tool-after-restart-${theme}.png`) });
      await page.close();
    }
    await context.close();

    // ---------------------------------------------------------------- empty, loading, unavailable, failed
    const fixture = name => async route => route.fulfill({ path: join(STATES, `${name}.json`), contentType: 'application/json' });
    const expect = async (page, state, name, words) => {
      await page.locator(`#your-tool-trigger[data-your-tool="${state}"]`).waitFor();
      assert.equal(await page.locator('#your-tool-name').innerText(), name);
      await open(page);
      assert.match(await page.locator('#your-tool-note').innerText(), words);
      assert.equal(await rows(page).count(), 0, `${state}: no tool is offered`);
      await page.screenshot({ path: join(output, `05-your-tool-${state}-${theme}.png`) });
    };
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const loadingContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await openPage(loadingContext, origin, theme, { route: async route => { await held; await fixture('loading')(route); } });
    await page.locator('#your-tool-trigger[data-your-tool="loading"]').waitFor();
    assert.equal(await page.locator('#your-tool-name').innerText(), 'Loading…');
    await open(page);
    assert.match(await page.locator('#your-tool-note').innerText(), /Loading the tools Core knows…/);
    await page.screenshot({ path: join(output, `05-your-tool-loading-${theme}.png`) });
    release();
    await page.locator('#your-tool-trigger[data-your-tool="empty"]').waitFor();
    await loadingContext.close();
    for (const [state, name, words] of [['empty', 'None listed', /Core's tool registry lists no tools\./],
      ['unavailable', 'Not published', /Not published: The installed @aihq\/core\/harness does not export listTools\./],
      ['failed', "Couldn't load", /The tool list couldn't be read: core service exited 1: fixture failure\./]]) {
      const stateContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      page = await openPage(stateContext, origin, theme, { route: fixture(state) });
      page.on('pageerror', error => errors.push(error.message));
      await expect(page, state, name, words);
      await stateContext.close();
    }
    assert.deepEqual(errors, [], 'The page raised no errors.');
  } finally { await browser.close(); }
}

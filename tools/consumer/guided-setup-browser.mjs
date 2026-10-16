// Guided setup walkthrough in a real browser against a running Workbench: both entries, a goal
// sentence with the fixture project, detected clients, suggestions, save, download, reopen in a
// fresh page, and an unrecognised project. Every request is recorded to show that no file
// content leaves the page. Usage: node guided-setup-browser.mjs <origin> <output-directory>
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GOAL = 'I want to add tests to my React app and fix a bug that keeps coming back';

export async function runGuidedSetupBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const fixtureText = await readFile(join(FIXTURES, 'guided-project/src/App.tsx'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  const errors = [], requests = [], shots = [];
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
    await page.goto(origin + '/guided.html');
    return page;
  };
  // The current suggestion's prompt lists exactly the ticked clients. A client that arrives after
  // suggesting invalidates them on purpose, so this suggests again first when the page asks for it.
  const currentPromptListsTickedClients = async page => {
    await page.waitForLoadState('networkidle');
    if (/inputs changed/.test(await page.locator('#suggest-status').innerText())) {
      await page.locator('#suggest').click();
      await page.locator('#suggest-status').filter({ hasText: /Suggestions are ready|No confident|could not/ }).waitFor();
    }
    const ticked = await page.locator('#clients li').filter({ has: page.locator('input:checked') }).locator('span.font-mono').allInnerTexts();
    const line = (await page.locator('#prompt').inputValue()).split('\n').find(text => text.startsWith('AI clients I use:'));
    assert.equal(line, `AI clients I use: ${ticked.length ? ticked.sort().join(', ') : '(none chosen)'}`);
  };
  const shot = async (page, name) => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true }); shots.push(path); };
  try {
    // Entry 1: Fix what's broken reaches the readiness flow and asks for no goal or project.
    const entry = await openPage();
    await shot(entry, '01-entries');
    await entry.locator('#fix-link').click();
    await entry.waitForURL(/\/readiness\.html$/);
    await entry.locator('#check').waitFor();
    assert.equal(await entry.locator('textarea:not([readonly]), input[type="file"]').count(), 0, 'The repair route asks for no goal or project folder.');
    await shot(entry, '02-fix-whats-broken');

    // Entry 2: Set up for a project.
    const page = await openPage();
    await page.locator('#start-guided').click();
    await page.locator('#goal').fill(GOAL);
    await page.waitForLoadState('networkidle');
    // Every item id the rules can suggest must be served by the installed catalog.
    const ruleTargets = await page.evaluate(async () => (await import('/app/guided-rules.js')).RULE_TARGETS);
    const served = await fetch(origin + '/api/authoring-catalog', { headers: { 'x-aih-client': '00000000-0000-4000-8000-000000000000' } });
    assert.equal(served.ok, true, `The installed catalog is served (${served.status}).`);
    const servedIds = new Set((await served.json()).items.map(item => item.id));
    assert.ok(ruleTargets.length > 0, 'The rules name catalog items.');
    assert.deepEqual(ruleTargets.filter(id => !servedIds.has(id)), [], 'Every rule target is served by the installed catalog.');
    const beforeFolder = requests.length;
    await page.locator('#folder').setInputFiles(join(FIXTURES, 'guided-project'));
    await page.locator('#folder-status').filter({ hasText: 'Nothing was uploaded' }).waitFor();
    const detected = await page.locator('#detections li').allInnerTexts();
    assert.ok(detected.some(text => /React/.test(text) && /package\.json/.test(text)), `React with provenance: ${detected.join(' | ')}`);
    assert.ok(detected.some(text => /TypeScript/.test(text) && /tsconfig\.json/.test(text)), 'TypeScript with provenance');
    // Editable: add one by hand, then remove it again.
    await page.locator('#add-stack').selectOption({ label: 'Docker (tool)' }).catch(async () => page.locator('#add-stack').selectOption({ index: 1 }));
    await page.locator('#add-stack-button').click();
    assert.ok((await page.locator('#detections li').allInnerTexts()).some(text => /added by you/.test(text)), 'A detection can be added by hand.');
    await page.locator('#detections li', { hasText: 'added by you' }).getByRole('button', { name: /Remove/ }).click();
    assert.deepEqual(requests.slice(beforeFolder).map(request => request.url), [], 'Inspecting the folder and editing detections makes no request.');
    await shot(page, '03-project-detections');

    await page.locator('#detect-clients').click();
    await page.locator('#clients-status').filter({ hasText: /Nothing was changed|did not run/ }).waitFor({ timeout: 240_000 });
    const clientsStatus = await page.locator('#clients-status').innerText();
    await shot(page, '04-clients');

    const beforeSuggest = requests.length;
    await page.locator('#suggest').click();
    await page.locator('#suggest-status').filter({ hasText: /Suggestions are ready|No confident|could not/ }).waitFor();
    assert.match(await page.locator('#suggest-status').innerText(), /Suggestions are ready/);
    assert.equal(requests.slice(beforeSuggest).filter(request => request.url.startsWith(origin + '/api/') && !request.url.endsWith('/api/authoring-catalog') && !/authoring-new$/.test(request.url)).length, 0,
      'Suggesting makes no host request beyond loading the installed catalog.');
    const cards = page.locator('#choices > li');
    const count = await cards.count();
    assert.ok(count >= 3 && count <= 5, `3–5 choices, got ${count}`);
    for (const heading of ['What it helps with', 'What it needs', 'What it will change', 'Why suggested']) assert.equal(await cards.filter({ hasText: heading }).count(), count, heading);
    const prompt = await page.locator('#prompt').inputValue();
    assert.ok(prompt.includes(GOAL) && !prompt.includes(fixtureText.trim()), 'The prompt carries the goal and no file content.');
    await currentPromptListsTickedClients(page);
    await shot(page, '05-suggestions');

    // Changing an input after suggestions hides the choices and save, and asks for a new suggestion before saving.
    await page.locator('#goal').fill(`${GOAL} today`);
    await page.locator('#save-section').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#choices > li').count(), 0, 'Choices are cleared when the inputs change.');
    assert.match(await page.locator('#suggest-status').innerText(), /Your inputs changed; suggest again to update the choices./);
    await page.locator('#goal').fill(GOAL);
    await page.locator('#suggest').click();
    await page.locator('#suggest-status').filter({ hasText: /Suggestions are ready|No confident|could not/ }).waitFor();
    assert.match(await page.locator('#suggest-status').innerText(), /Suggestions are ready/);
    assert.equal(await page.locator('#save-section').isVisible(), true);

    await page.locator('#save').click();
    await page.locator('#save-status').filter({ hasText: /Saved to a draft|Nothing was saved/ }).waitFor();
    assert.match(await page.locator('#save-status').innerText(), /Saved to a draft/);
    const savedLines = await page.locator('#saved-lines li').allInnerTexts();
    assert.ok(savedLines.some(line => /^Chosen/.test(line)) && savedLines.some(line => /^Included/.test(line)), `Plain-language policy: ${savedLines.join(' | ')}`);
    const envelopePath = join(output, 'guided-setup.journey.json');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    await (await downloaded).saveAs(envelopePath);
    const envelope = JSON.parse(await readFile(envelopePath, 'utf8'));
    assert.equal(envelope.executable, false);
    assert.deepEqual(envelope.records.map(record => record.schema), ['urn:aihq:workbench:journey-record:unresolved-draft:1.0.0']);
    const reasons = envelope.records[0].intent.roots.map(root => root.reason);
    assert.ok(reasons.length === count && reasons.every(reason => reason.includes('guided-setup rules 1.0.0') && reason.includes(GOAL)), 'Every saved choice keeps its rule version and goal.');
    await shot(page, '06-saved');

    // Reopen the downloaded setup in a fresh page.
    const fresh = await openPage();
    await fresh.locator('#start-guided').click();
    await fresh.locator('#reopen-file').setInputFiles(envelopePath);
    await fresh.locator('#reopen-status').filter({ hasText: /Reopened|could not be reopened/ }).waitFor();
    assert.match(await fresh.locator('#reopen-status').innerText(), /Reopened/);
    const reopened = await fresh.locator('#reopen-lines li').allInnerTexts();
    assert.ok(reasons.every(reason => reopened.some(line => line.includes(reason))), 'Reopened choices show their saved reasons.');
    await shot(fresh, '07-reopened');

    // An unrecognised project with an unmatched goal gets an honest answer and a way to browse.
    const unknown = await openPage();
    await unknown.locator('#start-guided').click();
    await unknown.locator('#goal').fill('hmm, something nice');
    await unknown.locator('#folder').setInputFiles(join(FIXTURES, 'guided-unknown'));
    await unknown.locator('#folder-status').filter({ hasText: 'Nothing was uploaded' }).waitFor();
    // Saved setup clients load in the background; the list renders once they are in.
    await unknown.locator('#clients li').first().waitFor();
    await unknown.waitForLoadState('networkidle');
    await unknown.locator('#suggest').click();
    await unknown.locator('#suggest-status').filter({ hasText: /No confident suggestion|could not/ }).waitFor();
    assert.match(await unknown.locator('#suggest-status').innerText(), /No confident suggestion/);
    assert.equal(await unknown.locator('#choices > li').count(), 0);
    assert.equal(await unknown.locator('#browse-link').isVisible(), true);
    await currentPromptListsTickedClients(unknown);
    await shot(unknown, '08-no-confident-suggestion');

    // No request left the Workbench origin and none carried fixture file content.
    assert.deepEqual(requests.filter(request => !request.url.startsWith(origin) && !request.url.startsWith('data:') && !/fonts\.(googleapis|gstatic)\.com/.test(request.url)).map(request => request.url), []);
    assert.equal(requests.filter(request => request.body.includes(fixtureText.trim())).length, 0);
    assert.deepEqual(errors, []);
    const evidence = { origin, goal: GOAL, clientsStatus, choices: count, ruleTargets, reasons, screenshots: shots, requests: requests.map(({ method, url }) => `${method} ${url.replace(origin, '')}`) };
    await writeFile(join(output, 'guided-setup-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    return evidence;
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [origin = 'http://127.0.0.1:4197', output = 'guided-setup-evidence'] = process.argv.slice(2);
  const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(resolve(fileURLToPath(new URL('../../node_modules/playwright/index.mjs', import.meta.url)))).href;
  runGuidedSetupBrowser({ origin, output: resolve(output), playwrightModule })
    .then(evidence => console.log(`guided setup walkthrough passed: ${evidence.choices} choices, ${evidence.screenshots.length} screenshots`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}

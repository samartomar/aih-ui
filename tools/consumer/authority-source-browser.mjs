import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openPolicyAdvanced } from './policy-drawer.mjs';
// The organization baseline author view is offered to an Enterprise Admin setup only; other phases read as a Vibe coder.
export async function openAuthorityPage({ browser, origin, role }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // The demo has no browser network dependency outside its loopback Workbench.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible() && role === 'admin') {
    await page.getByRole('radio', { name: /Enterprise/ }).check(); await page.locator('#setup-next').click();
    await page.getByRole('radio', { name: /Admin/ }).check(); await page.locator('#setup-next').click();
    for (const [key, value] of Object.entries({ name: 'Fixture Organization', shortId: 'fixture-org', policyRepo: 'github.com/fixture-org/ai-policies', emails: 'author@fixture.test' })) await page.locator(`#setup-field-${key}`).fill(value);
    // Organization, optional assistance, AI clients, then review and save.
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  } else if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  // The organization source sits in the review drawer's Advanced section; a person opens it to read the source.
  await page.locator('#nav-policy').click(); await openPolicyAdvanced(page);
  assert.equal(await page.locator('#authority-source input, #authority-source select, #authority-source textarea, #authority-source [contenteditable="true"]').count(), 0);
  return { page, context };
}
export async function refreshAuthority(page) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/authoring-authority-source') && response.request().method() === 'POST');
  await page.locator('#authority-source-refresh').click();
  const result = await (await response).json();
  assert.equal(result.status, 'ok', JSON.stringify(result));
  await page.waitForFunction(commit => document.getElementById('authority-source-commit')?.textContent === commit, result.authority.resolvedCommit);
  await page.locator('#authority-source-refresh:not([disabled])').waitFor();
  return result;
}
export async function captureAuthority(page, output, name) {
  await page.locator('#authority-source').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
}

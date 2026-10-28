// Your setup's drawer holds Install and the installed list, and its one Advanced section (#115) holds Check Policy,
// Download project policy, the collapsed "File actions" section (new, open, validate and reopen), Updates,
// Improvements, Trials, Workspace, Sources and execution, and Evidence review. Journeys reach them the way a person
// would: open the drawer from Your setup, open Advanced, then expand the section.
import { openSetupAdvanced } from './advanced-browser.mjs';

export async function openPolicyDrawer(page) {
  const panel = page.locator('#policy-review-panel');
  // The header's one entry, Your setup, opens the drawer from any page.
  if (await panel.isHidden()) await page.locator('#your-setup').click();
  await panel.waitFor();
}

export async function openPolicyFileActions(page) {
  await openSetupAdvanced(page);
  const section = page.locator('#policy-file-actions');
  if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
}

// The drawer stays open after Accept because Install lives there; close it as a person would before working under it.
// Close is merged into Back to catalog, which also leaves for the catalog; Escape closes the drawer where it is.
export async function closePolicyDrawer(page) {
  const panel = page.locator('#policy-review-panel');
  if (await panel.isHidden()) return;
  await panel.locator('#policy-review-panel-title').press('Escape');
  await panel.waitFor({ state: 'hidden' });
}

// The inspector keeps an item's source facts under a collapsed "Source and provenance" section.
export async function openSourceDetails(page) {
  const section = page.locator('details:has(> #details-source)');
  if (!await section.evaluate(node => node.open)) await section.locator('> summary').click();
}

// Host preparation, exact artifact, source and intake controls sit under "Sources and execution" in Advanced.
export const openPolicyAdvanced = page => openSetupAdvanced(page, 'Sources and execution');

// Updates, improvement suggestions, trials and workspace repositories each check when a person opens their section.
export async function openPolicySection(page, label) {
  await openSetupAdvanced(page);
  const summary = page.locator('#policy-review-panel details.policy-advanced > summary').filter({ hasText: new RegExp(`^${label}$`) });
  if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
}

// Controls inside the review drawer. A role or label query scoped here avoids walking the whole catalog grid, which
// holds most of the page's nodes; the query still matches by accessible name exactly as a page-wide one would.
export const drawer = page => page.locator('#policy-review-panel');

// One-click Add: a card's Add proposes the item and, when nothing needs deciding, accepts it at once and confirms it
// in a notice; a proposal with something to decide opens the review instead, where the person accepts it. Either way
// the item is in the setup afterwards, and the notice is dismissed so it covers nothing.
export async function addFromCatalog(page, id) {
  await closePolicyDrawer(page);
  await page.locator('#cards-grid').getByRole('button', { name: `Add ${id}`, exact: true }).click();
  const added = page.locator('#added-notice-message').filter({ hasText: /^Added / }), review = page.locator('#policy-accept:not([disabled])');
  await added.or(review).first().waitFor();
  if (await review.isVisible()) await review.click();
  else await page.locator('#added-notice-dismiss').click();
}

// Secondary browsing tools are deliberately closed in the normal catalog view.
export async function openCatalogFilters(page) {
  await closePolicyDrawer(page);
  const section = page.locator('#catalog-filter-disclosure');
  if (!await section.evaluate(node => node.open)) await section.locator('> summary').click();
}
export async function chooseCatalogFamily(page, value) {
  await closePolicyDrawer(page);
  const rail = page.locator('#nav-rail');
  if (await rail.evaluate(node => node.classList.contains('w-0'))) await page.locator('#toggle-nav-btn').click();
  const primary = page.locator('#framework-navigation button[data-family=' + JSON.stringify(value) + ']');
  if (await primary.count()) await primary.click();
  else { await openCatalogFilters(page); await page.locator('#browse-family').selectOption(value); await page.locator('#catalog-filters-close').click(); }
}
export async function chooseCatalogSupport(page, value) {
  await openCatalogFilters(page);
  await page.locator('#browse-support').selectOption(value);
  await page.locator('#catalog-filter-disclosure > summary').click();
}
export async function setPersonalFolder(page, files) {
  await openCatalogFilters(page);
  await page.locator('#personal-folder').setInputFiles(files);
}

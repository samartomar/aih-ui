// Controls placed in an Advanced section or the Settings menu (#115) are reached the way a person reaches them: open the
// section or the menu first, then use the control. Each helper only opens what is closed, so calling it twice is harmless.

/** The catalog page's Advanced section: kind tiles, catalog scopes, Policy workspace links and Scan Review. */
export async function openCatalogAdvanced(page) {
  const advanced = page.locator('#catalog-advanced');
  if (!await advanced.isVisible()) await page.locator('#nav-sources').click();
  if (!await advanced.evaluate(node => node.open)) await advanced.locator(':scope > summary').click();
}

/** A framework, from the left panel. Choosing the framework already chosen leaves it chosen. */
export async function chooseFramework(page, family) {
  const button = page.locator(`#framework-list button[data-family="${family}"]`);
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}

/** Any content family (the Catalog's other content, personal content, an independent inventory), from the Family list under Advanced. */
export async function chooseFamily(page, family) {
  await openCatalogAdvanced(page);
  await page.locator('#browse-family').selectOption(family);
}

/** The Policy workspace screen, through the catalog's Advanced section. */
export async function openPolicyWorkspace(page) {
  await openCatalogAdvanced(page);
  await page.locator('#nav-policy').click();
}

/** Scan Review, through the catalog's Advanced section. */
export async function openScanReview(page) {
  await openCatalogAdvanced(page);
  await page.locator('#nav-scan-review').click();
}

/** Your setup's Advanced section, and optionally one of its own sections by its summary (such as "File actions"). */
export async function openSetupAdvanced(page, section) {
  if (await page.locator('#policy-review-panel').isHidden()) await page.locator('#your-setup').click();
  const advanced = page.locator('#setup-advanced');
  if (!await advanced.evaluate(node => node.open)) await advanced.locator(':scope > summary').click();
  if (!section) return;
  const summary = advanced.locator('details > summary').filter({ hasText: section }).first();
  if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
}

/** File actions (New project policy, open a file, Validate and reopen, Download original artifact). */
export const openFileActions = page => openSetupAdvanced(page, 'File actions');

/** The header Settings menu: workspace settings, mode, Check this machine and Get started. */
export async function openSettings(page) {
  if (await page.locator('#workspace-actions').isHidden()) await page.locator('#org-modal-trigger').click();
}

/** The target-support filter, under the catalog's Advanced section (#122). */
export async function chooseSupport(page, value) {
  await openCatalogAdvanced(page);
  await page.locator('#browse-support').selectOption(value);
}

/** A folder on this machine, chosen from Add a source under Your sources in the left panel (#124). */
export async function choosePersonalFolder(page, files) {
  if (await page.locator('#your-sources').isHidden()) await page.locator('#nav-your-sources-add').click();
  await page.locator('#personal-folder').setInputFiles(files);
}

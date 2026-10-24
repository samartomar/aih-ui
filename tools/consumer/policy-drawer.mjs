// The project policy's review drawer holds Accept, Install, Download and the collapsed "File actions" section (new,
// open, validate and reopen). Journeys reach them the way a person would: open the drawer, then expand the section.
export async function openPolicyDrawer(page) {
  const panel = page.locator('#policy-review-panel');
  if (await panel.isHidden()) await page.locator('section:has(> #policy-review-description)').getByRole('button', { name: 'Open policy choices and review', exact: true }).click();
  await panel.waitFor();
}

export async function openPolicyFileActions(page) {
  await openPolicyDrawer(page);
  const section = page.locator('#policy-file-actions');
  if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
}

// The drawer stays open after Accept because Install lives there; close it as a person would before working under it.
export async function closePolicyDrawer(page) {
  const panel = page.locator('#policy-review-panel');
  if (await panel.isHidden()) return;
  await panel.locator('.policy-review-close').click();
  await panel.waitFor({ state: 'hidden' });
}

// The inspector keeps an item's source facts under a collapsed "Source and provenance" section.
export async function openSourceDetails(page) {
  const section = page.locator('details:has(> #details-source)');
  if (!await section.evaluate(node => node.open)) await section.locator('> summary').click();
}

// Host preparation, exact artifact, source and intake controls sit in the drawer's collapsed "Advanced" section.
export async function openPolicyAdvanced(page) {
  await openPolicyDrawer(page);
  const section = page.locator('#policy-review-panel details.policy-advanced', { has: page.getByText('Advanced: sources and execution', { exact: true }) });
  if (!await section.evaluate(node => node.open)) await section.getByText('Advanced: sources and execution', { exact: true }).click();
}

// Updates, improvement suggestions, trials and workspace repositories each check when a person opens their section.
export async function openPolicySection(page, label) {
  await openPolicyDrawer(page);
  const summary = page.locator('#policy-review-panel details.policy-advanced > summary').filter({ hasText: new RegExp(`^${label}$`) });
  if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
}

// Controls inside the review drawer. A role or label query scoped here avoids walking the whole catalog grid, which
// holds most of the page's nodes; the query still matches by accessible name exactly as a page-wide one would.
export const drawer = page => page.locator('#policy-review-panel');

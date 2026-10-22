// The project policy's review drawer holds Accept, Install, Download and the collapsed "File actions" section (new,
// open, validate and reopen). Journeys reach them the way a person would: open the drawer, then expand the section.
export async function openPolicyDrawer(page) {
  const panel = page.locator('#policy-review-panel');
  if (await panel.isHidden()) await page.getByRole('button', { name: 'Open policy choices and review', exact: true }).click();
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

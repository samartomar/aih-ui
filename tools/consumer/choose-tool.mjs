// Your tools is a multi-select. A journey that needs exactly one tool unticks every other one and ticks that one, as a
// person would, and closes the list.
export async function chooseOnlyTool(page, id) {
  if (await page.locator('#your-tool-pop').isHidden()) await page.locator('#your-tool-trigger').click();
  const target = page.locator(`#your-tool-list > button[data-tool="${id}"]`);
  if (await target.getAttribute('aria-checked') !== 'true') await target.click();
  for (const other of await page.locator('#your-tool-list > button[aria-checked="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.tool)))
    if (other !== id) await page.locator(`#your-tool-list > button[data-tool="${other}"]`).click();
  // The trigger closes the list; Escape could also close a drawer underneath.
  await page.locator('#your-tool-trigger').click();
}

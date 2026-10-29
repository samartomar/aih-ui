// Your setup's content identity and the release list's index status, on the running page. Sources are host
// configuration built only from the installed Catalog package: its prepared content bound to the exact Catalog archive,
// and Catalog's own published release-index fixtures, read by Catalog's reader in the host.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { readRelease } from '@aihq/catalog/reader';
import { chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

const bytes = async specifier => readFile(fileURLToPath(import.meta.resolve(specifier)));
const sha = value => createHash('sha256').update(value).digest('hex');
// The prepared frameworks a person picks from in the journey, each bound to the exact Catalog archive.
const PREPARED = ['ecc', 'superpowers', 'extensions'];
const INDEX_FIXTURES = { expired: 'expired-index', 'rollback-refused': 'rollback-refused', conflict: 'conflict-two-sources' };

export async function setupIdentitySources({ directory, scenario, archivePath, archiveSha256 }) {
  await mkdir(directory, { recursive: true });
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const prepared = PREPARED.map(frameworkId => ({ root, frameworkId, archivePath, archiveSha256 }));
  if (['identity', 'prepared'].includes(scenario)) return { prepared };
  const indexStatePath = join(directory, 'index-state.json');
  if (scenario === 'unsigned') {
    // One index naming Catalog's published Project basics release, with no TUF root selected.
    const golden = await bytes('@aihq/catalog/fixtures/release-1-7/project-basics-release-1.7.0.json');
    const checked = readRelease(golden, { expectedSha256: sha(golden) });
    if (!checked.valid) throw new Error('Public golden release fixture is refused.');
    const releasePath = join(directory, 'release.json'); await writeFile(releasePath, golden);
    const entry = { frameworkId: checked.release.framework.id, name: checked.release.framework.name, version: checked.release.framework.version,
      schema: checked.release.schema, sha256: checked.release.sha256, status: 'current', evidence: [], source: { id: 'catalog-public', kind: 'public' }, location: { kind: 'local', input: 'fixture-release' } };
    const index = { schema: 'urn:aihq:catalog:release-index:1.0.0', sourceId: 'catalog-public', version: 1, issuedAt: '2026-01-01T00:00:00Z', expires: '2999-01-01T00:00:00Z', entries: [entry] };
    const indexPath = join(directory, 'index.json'); await writeFile(indexPath, stable(index) + '\n');
    return { indexes: [{ sourceId: index.sourceId, trust: 'none', path: indexPath, authorizedFrameworks: [entry.frameworkId], releases: [{ sha256: entry.sha256, path: releasePath, root }] }], indexStatePath };
  }
  if (scenario === 'signed' || scenario === 'offline-undated') {
    // Catalog's published TUF fixture: an index signed under a fixture root, with its timestamp, snapshot and targets
    // metadata. The host verifies it through Catalog's public verifier; the prepared content sits beside it.
    // offline-undated uses the fixture's expired metadata: verification fails, so Catalog reports the source offline with
    // no verified copy and no date.
    const tuf = JSON.parse(await bytes('@aihq/catalog/fixtures/release-index/tuf-local.json')), metadata = scenario === 'signed' ? tuf.initial : tuf.expired;
    const file = async (name, value) => { const path = join(directory, name); await writeFile(path, stable(value) + '\n'); return path; };
    await writeFile(indexStatePath, JSON.stringify([{ sourceId: tuf.index.sourceId, lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null }]));
    return { prepared, indexStatePath, indexes: [{ sourceId: tuf.index.sourceId, path: await file('index.json', tuf.index), authorizedFrameworks: tuf.index.entries.map(entry => entry.frameworkId),
      tuf: { rootPath: await file('root.json', tuf.root), timestampPath: await file('timestamp.json', metadata.timestamp), snapshotPath: await file('snapshot.json', metadata.snapshot),
        targetsPath: await file('targets.json', metadata.targets), targetPath: Object.keys(metadata.targets.signed.targets)[0] } }] };
  }
  const fixture = JSON.parse(await bytes(`@aihq/catalog/fixtures/release-index/${INDEX_FIXTURES[scenario]}.json`));
  // The recorded state is the fixture's own (rollback-refused needs the higher version Catalog last accepted).
  await writeFile(indexStatePath, JSON.stringify(fixture.state));
  return { indexes: await Promise.all(fixture.sources.map(async (source, i) => {
    const path = join(directory, `index-${i}.json`); await writeFile(path, stable(source.index) + '\n');
    return { sourceId: source.sourceId, trust: source.trust, authorizedFrameworks: source.authorizedFrameworks, path };
  })), indexStatePath };
}

// The contract's index-status wordings. A scenario names the exact lines it expects; every other wording must be absent.
const STATUS_WORDINGS = {
  unsigned: /Release list not signed yet/,
  expired: /'s list has expired; not used/,
  'rollback-refused': / offered an older list; refused/,
  offline: /Can't reach .+; using the copy from /,
  'root-revoked': /'s keys were withdrawn; its releases are hidden/,
  conflict: /Sources disagree about .+; neither is used/,
};
const EXPECTED_STATUSES = {
  // Prepared content is not a release list: with no index there is no index status at all.
  prepared: {},
  // A TUF-verified index: no status, and never "not signed yet" for prepared content beside it.
  signed: {},
  // Offline with no recorded date: no contract wording can be filled, so the source keeps its failure line.
  'offline-undated': {},
  unsigned: { unsigned: 'Release list not signed yet' },
  expired: { expired: "catalog-public's list has expired; not used" },
  'rollback-refused': { 'rollback-refused': 'catalog-public offered an older list; refused' },
  conflict: { unsigned: 'Release list not signed yet', conflict: 'Sources disagree about framework-alpha 1.0.0; neither is used' },
};
function assertStatuses(text, scenario, where) {
  const expected = EXPECTED_STATUSES[scenario], lines = text.split('\n').map(line => line.trim());
  for (const [code, words] of Object.entries(expected)) assert.ok(lines.includes(words), `${where} says exactly "${words}" for ${code}`);
  for (const [code, pattern] of Object.entries(STATUS_WORDINGS)) if (!(code in expected)) assert.doesNotMatch(text, pattern, `${where} shows no ${code} wording`);
  // A release list Catalog read, signed or not, is never called unavailable.
  assert.doesNotMatch(text, /Release index unavailable/, `${where} does not call the release list unavailable`);
}

async function openPage(browser, origin, theme, errors) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.locator('#framework-navigation').filter({ hasNotText: 'Loading frameworks' }).waitFor();
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let i = 0; i < 4; i++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const toggle = page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true }); if (await toggle.count()) await toggle.click();
  return { context, page };
}

export async function runSetupIdentityBrowser({ origin, output, playwrightModule, scenario, catalogSha256, catalogPackage }) {
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true }); await mkdir(output, { recursive: true });
  const errors = [], outcomes = [];
  try {
    for (const theme of ['dark', 'light']) {
      const { context, page } = await openPage(browser, origin, theme, errors);
      if (scenario === 'identity') {
        // A person adds prepared content, then opens Your setup: the contract's label is shown as is, and the exact
        // package, version and digest of the Catalog archive the page loaded are in its details, as data.
        await chooseCatalogFamily(page, 'Extensions');
        // Extensions' own pre-ticked starting sets, added the way a person adds them.
        const added = page.waitForResponse(response => /authoring-(?:draft-edit|edit)$/.test(response.url()));
        await page.locator('[data-add-sets]').click();
        assert.equal((await (await added).json()).status, 'ok', 'Catalog resolves the chosen Extensions sets');
        await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
        await openPolicyDrawer(page);
        const identity = page.locator('#policy-internal-content'), summary = identity.locator('> summary');
        assert.ok(await identity.isVisible(), 'Your setup shows the content identity of the chosen prepared content');
        assert.equal((await summary.innerText()).trim(), 'Internal content · not verified', 'The identity reads exactly the contract label');
        // No wording the contract does not have, and no index status, which belongs to the release index alone.
        const panel = await page.locator('#policy-review-panel').innerText();
        for (const invented of [/archive sha256/i, /From @aihq\/catalog/, /the Catalog package/, /Release list not signed yet/]) assert.doesNotMatch(panel, invented, `Your setup shows no ${invented}`);
        if (!await identity.evaluate(node => node.open)) await summary.click();
        const details = await identity.locator('pre').innerText();
        const recorded = JSON.parse(details.slice(details.indexOf('\n') + 1)).map(source => source.materialSource.internalContent);
        assert.ok(recorded.length > 0, 'The details name the recorded internal content');
        for (const content of recorded) {
          assert.equal(content.archiveSha256, catalogSha256, 'The details carry the loaded Catalog archive digest');
          assert.equal(content.provenance.package.name, catalogPackage.name, 'The details carry the Catalog package name');
          assert.equal(content.provenance.package.version, catalogPackage.version, 'The details carry the Catalog package version');
        }
        assert.ok((await page.locator('#policy-review-panel').innerText()).includes(catalogSha256), 'The opened details show the digest');
        await page.screenshot({ animations: 'disabled', path: join(output, `${theme}-setup-identity.png`) });
      }
      if (scenario in EXPECTED_STATUSES) {
        // The status is chosen from what Catalog's reader reported for these sources, in the contract's exact words.
        assertStatuses(await page.locator('#framework-navigation').innerText(), scenario, 'The frameworks list');
        assertStatuses(await page.locator('body').innerText(), scenario, 'The page');
        if (scenario === 'signed') assert.match(await page.locator('#framework-navigation').innerText(), /Framework Alpha/, 'The verified index was read: its framework is listed');
        if (scenario === 'offline-undated') assert.ok((await page.locator('#framework-navigation').innerText()).split('\n').map(line => line.trim()).includes('Release index failed'), 'The undated offline source still shows a line');
        if (['prepared', 'signed'].includes(scenario)) assert.equal(await page.locator('#framework-navigation [data-index-status]').count(), 0, 'No index-status line');
        await page.screenshot({ animations: 'disabled', path: join(output, `${theme}-index-status.png`) });
      }
      outcomes.push({ theme, scenario }); await context.close();
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'browser-result.json'), JSON.stringify({ status: 'passed', scenario, outcomes }, null, 2));
    return { status: 'passed', scenario, outcomes };
  } finally { await browser.close(); }
}

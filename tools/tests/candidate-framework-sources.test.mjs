// The candidate's one framework-source input: Catalog's own prepared content, from the installed and pinned Catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparedFrameworkSources, writePreparedFrameworkSources } from '../candidate/framework-sources.mjs';

const catalog = { tarball: '/packs/aihq-catalog-0.1.0.tgz', sha256: 'c'.repeat(64), commit: 'b6040b15' };

test('each named framework becomes a prepared selection of the installed Catalog, bound to its pinned archive', () => {
  assert.deepEqual(preparedFrameworkSources({ frameworks: ['ecc', 'superpowers'], catalogRoot: '/release/node_modules/@aihq/catalog', catalog }), { prepared: [
    { root: '/release/node_modules/@aihq/catalog', frameworkId: 'ecc', archivePath: catalog.tarball, archiveSha256: catalog.sha256 },
    { root: '/release/node_modules/@aihq/catalog', frameworkId: 'superpowers', archivePath: catalog.tarball, archiveSha256: catalog.sha256 },
  ] });
});

test('the selections are written inside the run directory and read from the consumer\'s own Catalog; nothing is written when none is named', t => {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-framework-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumerDir = join(root, 'consumer'), runDir = join(root, 'run');
  mkdirSync(join(consumerDir, 'node_modules', '@aihq', 'catalog'), { recursive: true });
  writeFileSync(join(consumerDir, 'node_modules', '@aihq', 'catalog', 'package.json'), '{"name":"@aihq/catalog"}');
  mkdirSync(runDir);
  assert.equal(writePreparedFrameworkSources({ frameworks: undefined, consumerDir, runDir, catalog }), undefined);
  const path = writePreparedFrameworkSources({ frameworks: ['extensions'], consumerDir, runDir, catalog });
  assert.equal(path, join(runDir, 'framework-sources.json'));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { prepared: [{ root: realpathSync(join(consumerDir, 'node_modules', '@aihq', 'catalog')), frameworkId: 'extensions', archivePath: catalog.tarball, archiveSha256: catalog.sha256 }] });
});

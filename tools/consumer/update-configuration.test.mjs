import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInstallRecord, selectionKey } from './install-record.mjs';
import { updateRoot } from './host.mjs';

// An update's configuration is the one the item was installed with, as this Workbench recorded it; never what the
// page sends, which reads the editable setup.
const installed = { managementId: 'project--aihq.catalog--project-basics.working-rules', scope: 'project', configuration: { projectFolder: 'team-notes' },
  requires: ['project:project--aihq.catalog--project-basics.router'] };
const replacement = { releaseSha256: 'a'.repeat(64), itemId: 'project-basics.working-rules', scope: 'project' };

test('an update root takes the recorded configuration, not the page\'s', () => {
  for (const sent of [{ configuration: { projectFolder: 'edited-in-the-page' } }, { replacement: { ...replacement, configuration: {} } }, {}]) {
    const root = updateRoot({ update: { managementId: installed.managementId, replacement, ...sent }, install: installed, scope: 'project' });
    assert.deepEqual(root.configuration, { projectFolder: 'team-notes' });
    assert.equal(root.itemId, replacement.itemId);
  }
});

test('the configuration recorded at install is read back exactly, per project', () => {
  const root = mkdtempSync(join(tmpdir(), 'install-record-')), one = join(root, 'one'), two = join(root, 'two');
  mkdirSync(one); mkdirSync(two);
  const record = createInstallRecord({ root: join(root, 'store'), project: one });
  record.record([installed, { managementId: 'project--other', scope: 'project', configuration: {}, requires: [] }]);
  const read = record.read().get(selectionKey('project', installed.managementId));
  assert.deepEqual(read, installed);
  // Recording an updated selection replaces only that entry.
  record.record([{ ...installed, requires: [] }]);
  assert.deepEqual(record.read().get(selectionKey('project', installed.managementId)).configuration, { projectFolder: 'team-notes' });
  assert.ok(record.read().has(selectionKey('project', 'project--other')));
  assert.equal(createInstallRecord({ root: join(root, 'store'), project: two }).read().size, 0, 'another folder has its own record');
});

test('a record that is a symbolic link is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'install-record-')), project = join(root, 'project'), elsewhere = join(root, 'elsewhere');
  mkdirSync(project); mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(root, 'installed'));
  assert.throws(() => createInstallRecord({ root, project }).read(), /symbolic link/);
});

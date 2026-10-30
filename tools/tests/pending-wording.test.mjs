// New user-facing sentences wait for the owner's approval as contract amendment 3.2.3; each carries its row marker
// on one of the three lines before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROWS = [
  [19, 'src/app/install-panel.js', 'Install is still running in this project folder.'],
  [19, 'src/app/installed-panel.js', 'Install is still running in this project folder.'],
  [20, 'src/app/installed-panel.js', 'What is installed shows here once it has finished.'],
  [21, 'src/app/authoring-client.js', 'This page lost contact with the Workbench while it was running.'],
  [22, 'tools/consumer/server.mjs', 'This Workbench no longer holds that result.'],
  [23, 'src/app/install-panel.js', 'Install outcome unknown: '],
  [24, 'src/app/installed-removal.js', 'Removal outcome unknown: '],
  [25, 'src/app/installed-update.js', 'Update outcome unknown: '],
  [26, 'src/app/installed-update.js', 'which is not installed'],
  [27, 'src/app/installed-update.js', 'which it did not need when it was installed'],
  [28, 'src/app/installed-update.js', 'has no record of how this Workbench installed it, so its update cannot be checked'],
  [29, 'src/app/installed-update.js', 'this Workbench cannot read its record of what it installed in this folder, so no update can be checked'],
  [30, 'tools/consumer/host.mjs', 'Installed, but this Workbench could not record it, so it cannot be updated from here.'],
  [31, 'src/app/installed-update.js', 'Update is not available in an Enterprise setup, because Core cannot yet check an update against the organization'],
];
for (const [row, file, sentence] of ROWS) test(`row ${row}: "${sentence.trim()}" is marked pending in ${file}`, () => {
  const lines = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n');
  const at = lines.findIndex(line => line.includes(sentence));
  assert.ok(at >= 0, `${file} says "${sentence}"`);
  const marker = lines.slice(Math.max(0, at - 3), at + 1).join('\n').match(/Pending owner approval as contract amendment 3\.2\.3 rows? ([\d, and]+)/i);
  assert.ok(marker && marker[1].match(/\d+/g).map(Number).includes(row), `marked as row ${row}`);
});

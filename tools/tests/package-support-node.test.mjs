// The Workbench's own support declaration names the Node the candidate and the producer archives run on, and no other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_RANGE } from '../candidate/upgrade.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every Node entry in package-support-1.1.json declares the candidate\'s NODE_RANGE', () => {
  const declared = JSON.parse(readFileSync(join(repo, 'package-support-1.1.json'), 'utf8'));
  const node = declared.entries.filter(entry => entry.runtime === 'node');
  assert.ok(node.length > 0, 'the declaration has Node entries');
  assert.deepEqual(node.filter(entry => entry.nodeRange !== NODE_RANGE).map(entry => `${entry.export}: ${entry.nodeRange}`), []);
  assert.deepEqual(declared.entries.filter(entry => 'nodeRange' in entry && entry.runtime !== 'node'), [], 'only Node entries carry a range');
});

test('the candidate\'s NODE_RANGE is the producers\' engines range', () => {
  assert.equal(NODE_RANGE, '>=26.12.1 <27');
});

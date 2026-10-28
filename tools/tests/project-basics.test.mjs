import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isProjectFile, projectFileEntries } from '../../src/catalog/project-basics.js';

// Test-only items shaped like the consumer host's catalog: the Catalog's default release holds the tool adapters and the
// project files beside ordinary skills; a framework release holds its own content.
const item = (id, kind, family = 'Catalog', label = id) => ({ id, kind, family, label });
const entry = value => ({ entryId: value.id, authoringItem: value });
const catalog = [
  item('aihq.client.claude', 'client-adapter'), item('aihq.client.codex', 'client-adapter'),
  item('aihq.project-context-pointer.claude-md', 'client-entry-pointer', 'Catalog', 'CLAUDE.md entry'),
  item('aihq.project-context', 'project-context', 'Catalog', 'Project context'),
  item('aihq.project-context-pointer.agents-md', 'client-entry-pointer', 'Catalog', 'AGENTS.md entry'),
  item('mattpocock.grill-me', 'skill'), item('ext.tdd', 'skill', 'Extensions'), item('ecc.agent', 'agent', 'ECC'),
].map(entry);

test('project files are the project-context item and its pointers, chosen by published kind', () => {
  assert.equal(isProjectFile({ kind: 'project-context' }), true);
  assert.equal(isProjectFile({ kind: 'client-entry-pointer' }), true);
  assert.equal(isProjectFile({ kind: 'client-adapter' }), false, 'a tool adapter is not a project file');
  assert.equal(isProjectFile({ kind: 'skill' }), false);
});

test('Project basics offers the project files, the shared one first, and never a tool adapter', () => {
  assert.deepEqual(projectFileEntries(catalog).map(value => value.entryId),
    ['aihq.project-context', 'aihq.project-context-pointer.agents-md', 'aihq.project-context-pointer.claude-md']);
});

// The page's own markup.
const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = id => {
  const start = html.indexOf(`id="${id}"`), tag = html.lastIndexOf('<', start), name = /<(\w+)/.exec(html.slice(tag))[1];
  let depth = 0;
  for (const match of html.slice(tag).matchAll(new RegExp(`<(/?)${name}\\b`, 'g'))) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(tag, tag + match.index);
  }
  return html.slice(tag);
};

test('Project basics has its own entry in the left panel', () => {
  const rail = section('nav-rail');
  assert.match(rail, /id="nav-project-basics"/);
  assert.doesNotMatch(section('catalog-advanced'), /nav-project-basics/, 'not behind Advanced');
});

test('Project basics holds tool support and the workspace apart from the catalog cards, and points to the Project basics framework for project files', () => {
  const basics = section('project-basics');
  for (const id of ['project-basics-tools', 'project-basics-files', 'project-basics-workspace']) assert.match(basics, new RegExp(`id="${id}"`));
  assert.match(section('project-basics-tools'), /href="readiness\.html"/, 'tool support opens the existing Check this machine page');
  const files = section('project-basics-files');
  assert.match(files, /id="project-files-context"/, 'the project-files section reports the maintained count');
  assert.doesNotMatch(files, /id="project-files-grid"/, 'project files are not repeated as cards here');
  assert.match(files, /Project basics framework/, 'the section points at the maintained Project basics framework');
  assert.match(section('project-basics-workspace'), /id="project-basics-open-workspace"/);
  assert.doesNotMatch(section('catalog-workspace'), /id="project-basics"/);
});

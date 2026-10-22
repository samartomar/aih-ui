import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameworkShows, isProjectBasics, isProjectFile, projectFileEntries } from '../../src/catalog/project-basics.js';

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
  assert.equal(isProjectBasics({ kind: 'client-adapter' }), true);
  assert.equal(isProjectBasics({ kind: 'skill' }), false);
});

test('Project basics offers the project files, the shared one first, and never a tool adapter', () => {
  assert.deepEqual(projectFileEntries(catalog).map(value => value.entryId),
    ['aihq.project-context', 'aihq.project-context-pointer.agents-md', 'aihq.project-context-pointer.claude-md']);
});

test('a framework view never shows tool adapters or project files', () => {
  for (const family of ['Extensions', 'ECC', 'Anthropic', 'Superpowers', 'Future']) {
    // Even if a framework release published one, it would stay out of the framework's cards.
    assert.equal(frameworkShows({ kind: 'client-adapter', family }, family), false, family);
    assert.equal(frameworkShows({ kind: 'client-entry-pointer', family }, family), false, family);
    assert.equal(frameworkShows({ kind: 'project-context', family }, family), false, family);
    assert.equal(frameworkShows({ kind: 'skill', family }, family), true, family);
  }
  assert.equal(frameworkShows({ kind: 'skill', family: 'ECC' }, 'Extensions'), false, 'another framework\'s content');
});

test('under Advanced, every family and the other Catalog content still list them', () => {
  assert.equal(frameworkShows({ kind: 'client-adapter', family: 'Catalog' }, ''), true, 'All families');
  assert.equal(frameworkShows({ kind: 'client-adapter', family: 'Catalog' }, 'Catalog'), true, 'Other Catalog content');
  assert.equal(frameworkShows({ kind: 'client-entry-pointer', family: 'Catalog' }, 'Catalog'), true);
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

test('Project basics has its own entry in the left panel, below the frameworks and not one of them', () => {
  const rail = section('nav-rail');
  assert.match(rail, /id="nav-project-basics"/);
  assert.ok(rail.indexOf('id="nav-project-basics"') > rail.indexOf('id="framework-list"'), 'below the frameworks');
  assert.doesNotMatch(section('framework-list'), /nav-project-basics/);
  assert.doesNotMatch(section('framework-list-section'), /nav-project-basics/, 'its own section, not the frameworks\'');
});

test('Project basics holds tool support, project files and the workspace, apart from the catalog cards', () => {
  const basics = section('project-basics');
  for (const id of ['project-basics-tools', 'project-basics-files', 'project-basics-workspace']) assert.match(basics, new RegExp(`id="${id}"`));
  assert.match(section('project-basics-tools'), /href="readiness\.html"/, 'tool support opens the existing Check this machine page');
  assert.match(section('project-files-grid'), /id="project-files-grid"/);
  assert.match(section('project-basics-workspace'), /id="project-basics-open-workspace"/);
  assert.doesNotMatch(section('catalog-workspace'), /id="project-basics"/);
});

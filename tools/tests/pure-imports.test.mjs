// The portable readers stay portable: their whole static import graph imports no package (so no Node built-in,
// Catalog producer or host dependency), no host module and no browser or Node global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exportsMap = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).exports;
// Package entries documented as portable (README, docs/authoring.md, docs/readiness.md), plus the browser-shared
// client identity module.
const PURE_EXPORTS = ['./journey', './readiness', './workspace'];
const PURE_FILES = ['tools/consumer/client-identity.mjs'];
// Modules that acquire, run or host; a pure reader never reaches them even if they stopped importing a package.
const HOST_MODULE = /(^|\/)(intake|headless|host|server|envelope-file|home-environment)\.mjs$|-(host|child|browser|fixture|service)\.mjs$/;
const GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'location', 'btoa', 'atob', 'Buffer', 'process', 'require', 'module', '__dirname', '__filename', 'global', 'setImmediate'];

// Code with comments, string, template and regular-expression literal bodies blanked, so only code tokens remain.
// Import specifiers are read from the original text separately.
function codeOnly(source) {
  let out = '', i = 0, last = '';
  const regexAllowed = () => /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(out.trimEnd());
  while (i < source.length) {
    const c = source[i], n = source[i + 1];
    if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = source.indexOf('*/', i + 2) + 2; if (i < 2) i = source.length; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`' || (c === '/' && regexAllowed())) {
      let inClass = false; i++;
      while (i < source.length && (source[i] !== c || inClass)) {
        if (source[i] === '\\') i++;
        else if (c === '/' && source[i] === '[') inClass = true;
        else if (c === '/' && source[i] === ']') inClass = false;
        else if (c === '/' && source[i] === '\n') break;
        i++;
      }
      i++; out += `${c}${c}`; last = c; continue;
    }
    out += c; if (!/\s/.test(c)) last = c; i++;
  }
  return out;
}

const IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
function closure(entry) {
  const files = new Map(), problems = [];
  (function walk(file) {
    if (files.has(file)) return;
    const source = readFileSync(file, 'utf8'), name = relative(repo, file).replaceAll('\\', '/');
    files.set(file, name);
    if (HOST_MODULE.test(name)) problems.push(`${name} is a host or producer module`);
    const code = codeOnly(source);
    if (/\bimport\s*\(\s*(?!['"`])/.test(code)) problems.push(`${name} has a dynamic import without a literal specifier`);
    if (/\bimport\.meta\b/.test(code)) problems.push(`${name} reads import.meta`);
    for (const global of GLOBALS) if (new RegExp(String.raw`(?<![.\w$])${global}\b(?!\s*:)`).test(code)) problems.push(`${name} uses the global ${global}`);
    for (const match of source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(IMPORT)) {
      const specifier = match[2] ?? match[4];
      if (specifier.startsWith('./') || specifier.startsWith('../')) walk(resolve(dirname(file), specifier));
      else problems.push(`${name} imports ${specifier}`);
    }
  })(resolve(repo, entry));
  return { files: [...files.values()], problems };
}

for (const entry of [...PURE_EXPORTS.map(key => exportsMap[key]), ...PURE_FILES]) {
  test(`${entry} and everything it imports is portable`, () => {
    assert.ok(entry, 'the entry is in the export map');
    const { files, problems } = closure(entry);
    assert.deepEqual(problems, [], `import closure: ${files.join(', ')}`);
  });
}

test('the journey reader reaches its records and the shared primitives, not intake or authoring', () => {
  const { files } = closure(exportsMap['./journey']);
  for (const name of ['primitives', 'intent-shape', 'maintenance-record', 'improvement-record', 'workspace-record', 'organization-draft-record', 'batch-record', 'trial-record'])
    assert.ok(files.includes(`tools/consumer/${name}.mjs`), name);
  assert.equal(files.some(file => /(intake|headless)\.mjs$/.test(file)), false);
});

test('the check sees a package import, a host module, a global and a dynamic import', () => {
  assert.ok(closure(exportsMap['./intake']).problems.includes('tools/consumer/intake.mjs imports @aihq/catalog/producer'));
  assert.ok(closure(exportsMap['./intake']).problems.includes('tools/consumer/intake.mjs is a host or producer module'));
  assert.ok(closure('tools/consumer/workspace-host.mjs').problems.some(problem => problem.endsWith('imports node:fs')));
  assert.match(codeOnly("const a = '//x'; /* window */ const b = /['\"]/.test(a); fetch(b);"), /fetch\(b\)/);
  assert.doesNotMatch(codeOnly("const a = 'window'; // document\nconst b = `navigator`; const c = /process/;"), /window|document|navigator|process/);
});

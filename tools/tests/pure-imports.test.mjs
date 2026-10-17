// The portable readers stay portable: their whole static import graph imports no package (so no Node built-in,
// Catalog producer or host dependency), no host module and no browser or Node global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exportsMap = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).exports;
// Package entries documented as portable (README, docs/authoring.md), plus the browser-shared client identity module and the
// readiness projection (docs/readiness.md), which is application-internal.
const PURE_EXPORTS = ['./journey', './workspace', './batch'];
const PURE_FILES = ['tools/consumer/client-identity.mjs', 'tools/consumer/readiness.mjs', 'src/report/render.js'];
// Modules that acquire, run or host; a pure reader never reaches them even if they stopped importing a package.
const HOST_MODULE = /(^|\/)(intake|headless|host|server|envelope-file|home-environment)\.mjs$|-(host|child|browser|fixture|service)\.mjs$/;
// Globals a portable module may not touch: environment, I/O, timers and scheduling. Web Crypto (`crypto`) and the
// encoding classes are shared by every supported runtime and stay allowed.
const GLOBALS = ['globalThis', 'window', 'self', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'btoa', 'atob', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'Buffer', 'process', 'require', 'module', '__dirname', '__filename', 'global'];

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

// Each forbidden global used in code: an identifier not reached as a member (`o.self`) and not an object key
// (`{ location: x }`, `, self: y`). After `?` or in any other position a following `:` does not make it a key.
function globalsUsed(code) {
  const used = new Set();
  for (const global of GLOBALS) {
    for (const match of code.matchAll(new RegExp(String.raw`(?<![.\w$])${global}(?![\w$])`, 'g'))) {
      const key = /^\s*:/.test(code.slice(match.index + global.length)) && /[{,]\s*$/.test(code.slice(0, match.index));
      if (!key) used.add(global);
    }
  }
  return [...used];
}

const IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;

// One module's own problems and the relative specifiers it imports.
function inspect(source, name) {
  const problems = [], relatives = [];
  if (HOST_MODULE.test(name)) problems.push(`${name} is a host or producer module`);
  const code = codeOnly(source);
  if (/\bimport\s*\(\s*(?!['"`])/.test(code)) problems.push(`${name} has a dynamic import without a literal specifier`);
  if (/\bimport\.meta\b/.test(code)) problems.push(`${name} reads import.meta`);
  for (const global of globalsUsed(code)) problems.push(`${name} uses the global ${global}`);
  for (const match of source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(IMPORT)) {
    const specifier = match[2] ?? match[4];
    if (specifier.startsWith('./') || specifier.startsWith('../')) relatives.push(specifier);
    else problems.push(`${name} imports ${specifier}`);
  }
  return { problems, relatives };
}

function closure(entry) {
  const files = new Map(), problems = [];
  (function walk(file) {
    if (files.has(file)) return;
    const name = relative(repo, file).replaceAll('\\', '/');
    files.set(file, name);
    const found = inspect(readFileSync(file, 'utf8'), name);
    problems.push(...found.problems);
    for (const specifier of found.relatives) walk(resolve(dirname(file), specifier));
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

test('every forbidden global is caught as a value, in either conditional branch and as a callee; a key, member or string is not', () => {
  for (const global of GLOBALS) {
    for (const [use, label] of [[`const x = ${global};`, 'value'], [`f(c ? ${global} : y);`, 'consequent'], [`f(c ? y : ${global});`, 'alternate'],
      [`${global}.call();`, 'callee'], [`if (a) ${global}(1);`, 'statement'], [`const o = { k: ${global} };`, 'property value']])
      assert.deepEqual(globalsUsed(codeOnly(use)), [global], `${global} as ${label}`);
    assert.deepEqual(globalsUsed(codeOnly(`const o = { ${global}: 1, b: 2 }; f({ a, ${global}: 3 }); o.${global}; const s = '${global}';`)), [],
      `${global} as a key, member or string`);
  }
  assert.deepEqual(globalsUsed(codeOnly('const selfish = 1, myprocess = 2, timeout = 3; o.self.process;')), []);
});

test('a portable module that gains a forbidden use is refused', () => {
  const clean = "import { hash } from './primitives.mjs';\nexport const ok = value => hash(value);\n";
  assert.deepEqual(inspect(clean, 'tools/consumer/example.mjs').problems, []);
  for (const mutation of ["import { readFile } from 'node:fs/promises';", "import x from 'fs';", "import { readRelease } from '@aihq/catalog/reader';",
    "export { only } from '@aihq/core';", "const m = await import('node:path');", 'const m = await import(name);', 'const u = import.meta.url;',
    'export const t = c ? process : 1;', 'globalThis.x = 1;', 'setInterval(f, 5);', 'queueMicrotask(f);', 'const s = self;', 'const n = performance.now();']) {
    assert.notDeepEqual(inspect(`${clean}${mutation}\n`, 'tools/consumer/example.mjs').problems, [], mutation);
  }
  assert.ok(inspect(clean, 'tools/consumer/example-host.mjs').problems.length > 0, 'a host module name');
});

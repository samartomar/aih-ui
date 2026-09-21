// One-shot browser acceptance sweep for the Sources & Catalogs preview.
// Usage: node tools/acceptance-sweep.mjs [page-url] [tag]
//
// Drives playwright-cli in the "preview" session and prints one JSON report of the
// acceptance facts. Writes the raw CLI transcript to .playwright-cli/<tag>.txt as evidence.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [url = "http://127.0.0.1:4199/", tag = "acceptance"] = process.argv.slice(2);
mkdirSync(".playwright-cli", { recursive: true });
const transcript = [];

function cli(args) {
  const result = spawnSync("playwright-cli", ["-s=preview", ...args], { encoding: "utf8", shell: process.platform === "win32" });
  const output = `${(result.stdout ?? "").trim()}\n${(result.stderr ?? "").trim()}`.trim();
  transcript.push(`$ playwright-cli ${args.join(" ")}\n${output}\n`);
  return output;
}

const raw = (args) => cli(["--raw", ...args]);
const ev = (expression) => raw(["eval", expression]);

const report = {};
report.title = ev("document.title");
report.errorBox = ev(
  "JSON.stringify({hidden: document.getElementById('catalog-error').className.includes('hidden'), text: document.getElementById('catalog-error').textContent})",
);
report.provenance = ev("document.getElementById('provenance-strip').innerText.split('\\n').join(' ')");
report.masthead = ev("document.getElementById('masthead-facts').innerText.split('\\n').join(' ')");
report.counts = ev(
  "JSON.stringify({nav: document.getElementById('nav-sources-count').textContent, railPackage: document.getElementById('rail-package-count').textContent, visible: document.getElementById('visible-count').textContent, caption: document.getElementById('visible-caption').textContent, mastheadVersion: document.getElementById('masthead-version').textContent})",
);
report.ledger = ev(
  "JSON.stringify([...document.querySelectorAll('#framework-matrix-tabs button')].map(b => b.innerText.split('\\n').join(' | ')))",
);
report.sourceTypes = ev(
  "JSON.stringify([...document.querySelectorAll('#rail-source-list > div > button')].map(b => b.innerText.split('\\n').join(':')))",
);
report.kindRail = ev("JSON.stringify([...document.querySelectorAll('#rail-kind-list button')].map(b => b.innerText.split('\\n').join(':')))");
report.githubRepos = ev(
  "(() => { [...document.querySelectorAll('#rail-source-list button')].find(b => b.innerText.startsWith('github')).click(); return JSON.stringify([...document.querySelectorAll('#rail-source-list button')].map(b => b.innerText.split('\\n').join(':'))); })()",
);
report.anthropicsFilter = ev(
  "(() => { [...document.querySelectorAll('#rail-source-list button')].find(b => b.innerText.startsWith('anthropics/skills')).click(); return JSON.stringify({visible: document.getElementById('visible-count').textContent, ids: [...document.querySelectorAll('#cards-grid [data-card-id]')].map(n => n.dataset.cardId).slice(0, 3), active: [...document.querySelectorAll('#rail-source-list button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.innerText.trim())}); })()",
);
report.pathSearch = ev(
  "(() => { const i = document.getElementById('catalog-search'); i.value = 'skills/writing-skills'; i.dispatchEvent(new Event('input',{bubbles:true})); return JSON.stringify({visible: document.getElementById('visible-count').textContent, ids: [...document.querySelectorAll('#cards-grid [data-card-id]')].map(n => n.dataset.cardId)}); })()",
);
report.githubInspector = ev(
  "(() => { document.querySelector('#cards-grid [data-card-id]').click(); return JSON.stringify({locator: document.getElementById('inspector-version').textContent, locatorTitle: document.getElementById('inspector-version').title, source: document.getElementById('details-source').innerText.split('\\n').join(' | ')}); })()",
);
report.commitSearch = ev(
  "(() => { const i = document.getElementById('catalog-search'); i.value = 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797'; i.dispatchEvent(new Event('input',{bubbles:true})); return JSON.stringify({visible: document.getElementById('visible-count').textContent}); })()",
);
report.npmInspector = ev(
  "(() => { const i = document.getElementById('catalog-search'); i.value = 'picocolors'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#cards-grid [data-card-id]').click(); return JSON.stringify({name: document.getElementById('inspector-name').textContent, locator: document.getElementById('inspector-version').textContent, source: document.getElementById('details-source').innerText.split('\\n').join(' | ')}); })()",
);
report.aihInspector = ev(
  "(() => { const i = document.getElementById('catalog-search'); i.value = 'governance-quality.core-0-6-2'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#cards-grid [data-card-id]').click(); return JSON.stringify({name: document.getElementById('inspector-name').textContent, locator: document.getElementById('inspector-version').textContent, source: document.getElementById('details-source').innerText.split('\\n').join(' | ')}); })()",
);
report.absenceMarkers = ev(
  "(() => { const i = document.getElementById('catalog-search'); i.value = ''; i.dispatchEvent(new Event('input',{bubbles:true})); const s = document.getElementById('source-filter'); s.value = ''; s.dispatchEvent(new Event('change',{bubbles:true})); const body = document.body.innerText; return JSON.stringify({notPublished: body.split('Not published').length - 1, notSupplied: body.split('Not supplied').length - 1, notConnected: body.split('Not connected').length - 1, releaseLabelsPhrase: body.split('release label').length - 1, visible: document.getElementById('visible-count').textContent}); })()",
);
report.sortOptions = ev("JSON.stringify([...document.getElementById('sort-select').options].map(o => o.value + '=' + o.textContent))");
report.theme = ev(
  "(() => { document.getElementById('theme-toggle-btn').click(); return JSON.stringify({cls: document.documentElement.className, background: getComputedStyle(document.body).backgroundColor, cards: document.querySelectorAll('#cards-grid [data-card-id]').length}); })()",
);
report.railsAfterToggle = ev(
  "(() => { document.getElementById('toggle-nav-btn').click(); document.getElementById('toggle-inspector-btn').click(); return JSON.stringify({navCollapsed: document.getElementById('nav-rail').className.includes('w-0'), inspectorCollapsed: document.getElementById('inspector-rail').className.includes('w-0')}); })()",
);
report.inspectorTabs = ev(
  "(() => { const buttons = [...document.querySelectorAll('.inspector-tab-btn')]; buttons.find(b => b.dataset.tab === 'security').click(); const securityShown = !document.getElementById('pane-security').className.includes('hidden'); buttons.find(b => b.dataset.tab === 'json').click(); const jsonShown = !document.getElementById('pane-json').className.includes('hidden'); buttons.find(b => b.dataset.tab === 'details').click(); return JSON.stringify({securityShown, jsonShown, detailsShown: !document.getElementById('pane-details').className.includes('hidden'), jsonText: document.getElementById('live-json-viewer').textContent.slice(0, 48), copyDisabled: document.getElementById('copy-json-btn').disabled, applyDisabled: document.getElementById('apply-staging-btn').disabled, statementCount: document.getElementById('statement-count').textContent}); })()",
);
report.consoleErrors = cli(["console", "error"]);

writeFileSync(`.playwright-cli/${tag}.txt`, transcript.join("\n"));
for (const [key, value] of Object.entries(report)) {
  console.log(`${key}: ${value}`);
}

// Report: the Workbench's normalized claims, rendered from reportPanels(). The host builds the
// claim set from its readiness journal and Core projects it; this page prints the strings the
// view module produced and computes no meaning of its own. Text goes in with textContent only.
import { reportPanels, reportText } from './app/claims-view.js';

const $ = id => document.getElementById(id);
const TEXT_TONE = { error: 'text-error', warning: 'text-tertiary', success: 'text-secondary', neutral: 'text-on-surface' };
const EDGE_TONE = { error: 'border-error', warning: 'border-tertiary', success: 'border-secondary', neutral: 'border-wb-border' };
const SECTIONS = ['score', 'repairs', 'actions', 'claims', 'context', 'observations'];
const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
};

// Every response is JSON with a status; anything else is shown, never read as success.
async function load() {
  try {
    const response = await fetch('/api/readiness-report', { cache: 'no-store' });
    const payload = await response.json();
    if (response.ok && payload.status === 'ok') return { status: 'ok', value: payload.value };
    const message = (payload.diagnostics ?? []).map(item => item.message).filter(Boolean).join(' ') || payload.message || `The host answered ${response.status}.`;
    return { status: 'error', message };
  } catch (error) {
    return { status: 'error', message: `The host could not be reached: ${error.message}` };
  }
}

function renderPanel(panel, { heading = 'h2', headingId, depth = 0 } = {}) {
  const fragment = document.createDocumentFragment();
  const title = el(heading, depth ? 'font-medium' : 'font-semibold', panel.title);
  if (headingId) title.id = headingId;
  fragment.append(title);
  if (panel.value !== undefined) fragment.append(el('p', `text-2xl font-semibold font-mono ${TEXT_TONE[panel.tone] ?? TEXT_TONE.neutral}`, panel.value));
  fragment.append(el('p', 'text-on-surface-variant', panel.summary));
  if (panel.items.length) {
    const list = el('ul', 'space-y-2');
    for (const entry of panel.items) {
      const item = el('li', `border-l-4 pl-2 space-y-0.5 ${EDGE_TONE[entry.tone] ?? EDGE_TONE.neutral}`);
      item.append(el('p', 'font-medium', entry.text));
      for (const detail of entry.details) item.append(el('p', 'text-xs text-on-surface-variant break-words', detail));
      list.append(item);
    }
    fragment.append(list);
  }
  for (const section of panel.sections ?? []) {
    const block = el('div', 'space-y-2 border-t border-wb-border pt-2');
    block.append(renderPanel(section, { heading: 'h3', depth: depth + 1 }));
    fragment.append(block);
  }
  return fragment;
}

// A failed load or render leaves no earlier report on screen to be read as current.
// The headings are the view's own panel titles and keep their ids, so each section stays labelled.
function clear(message) {
  const empty = reportPanels(null);
  for (const name of SECTIONS) {
    const heading = el('h2', 'font-semibold', empty[name].title);
    heading.id = `report-${name}-heading`;
    $(`report-${name}`).replaceChildren(heading, el('p', 'text-on-surface-variant', message));
  }
  $('report-text').value = '';
}

async function refresh() {
  $('report-refresh').disabled = true;
  $('report-status').textContent = 'Loading the report.';
  const result = await load();
  $('report-refresh').disabled = false;
  if (result.status !== 'ok') {
    $('report-status').textContent = `The report could not be loaded: ${result.message}`;
    clear('The report is unavailable.');
    return;
  }
  const { projection, records } = result.value;
  try {
    const panels = reportPanels(projection);
    for (const name of SECTIONS) $(`report-${name}`).replaceChildren(renderPanel(panels[name], { headingId: `report-${name}-heading` }));
    $('report-text').value = reportText(projection);
    $('report-status').textContent = `Report loaded from ${records} readiness record${records === 1 ? '' : 's'}.`;
  } catch (error) {
    $('report-status').textContent = `The report could not be shown: ${error.message}`;
    clear('The report is unavailable.');
  }
}

$('report-refresh').addEventListener('click', refresh);
refresh();

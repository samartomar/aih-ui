import { action, link, readStored, store } from './dom.js';
import { loadConfiguration, currentPolicy, managedMode, refreshPolicy } from './managed-policy.js';
import { loadWorkbench } from './host.js';
import { make as icon } from './icons.js';
import { mount as mountScene } from './scene.js';
import { mountWorkbenchBook } from './book.js';
import { emptyDraft, renderJourney, stepsFor } from './journey.js';
import { publishedSelection, restrictEnterprise } from './organization.js';
import { renderProfiles } from './profiles.js';
import { renderDiagnostics, renderReports } from './reports.js';

const roles = {
  admin: { label: 'Enterprise Admin', title: 'Organization policy', description: 'Choose what your team can install. Review the evidence and prepare a policy for their CLIs.', rail: 'Policy setup' },
  enterprise: { label: 'Enterprise User', title: 'Team CLI setup', description: 'Build from your organization’s policy, add your own files, and save a setup you can use again.', rail: 'CLI setup' },
  individual: { label: 'Individual User', title: 'Personal CLI setup', description: 'Bring your own tools and instructions, or start with a Profile. Preview what each CLI will receive.', rail: 'CLI setup' },
};
const ancillary = {
  profiles: { title: 'Profile library', description: 'Browse and create reusable Profiles.', render: renderProfiles },
  diagnostics: { title: 'Workspace diagnostics', description: 'Open machine checks and review saved evidence.', render: renderDiagnostics },
  reports: { title: 'V9 Developer Console', description: '', render: renderReports },
};
const $ = id => document.getElementById(id);
const view = $('intake-view');
const host = $('ix-pane');
const editionKey = 'aih-workbench-edition';
const roleKey = 'aih-workbench-role';
const motionKey = 'aih-workbench-motion-paused';

const data = {
  items: [], clients: [], frameworks: [], tools: [],
  gaps: { catalog: 'Connecting to Catalog…', clients: 'Connecting to Core…', tools: 'Connecting to Core…' },
};
let scene, current, mounted, paused = readStored(motionKey, false), toastTimeout;

function status(text) {
  $('ix-status').textContent = text;
  clearTimeout(toastTimeout);
  if (text) toastTimeout = setTimeout(() => { $('ix-status').textContent = ''; }, 5500);
}

function path(theme, role, step) {
  return '#' + (theme === 'light' ? 'light' : 'intake') + '/' + role + (step ? '/' + step : '');
}

function showMotion() {
  scene?.setPaused(paused || current?.step.id === 'reports');
  const button = $('ix-motion');
  button.setAttribute('aria-label', paused ? 'Play background motion' : 'Pause background motion');
  button.setAttribute('aria-pressed', String(paused));
  button.replaceChildren(icon(paused ? 'play' : 'pause', { size: 13 }));
}

function routeState() {
  const [prefix, roleInput, stepInput] = location.hash.slice(1).split('/');
  const storedRole = readStored(roleKey, 'admin');
  const role = [roleInput, storedRole, 'admin'].find(value => Object.hasOwn(roles, value));
  const theme = prefix === 'light' ? 'light' : prefix === 'intake' ? 'dark' : readStored(editionKey, 'dark') === 'light' ? 'light' : 'dark';
  const steps = stepsFor(role);
  const prior = steps.find(item => item.id === readStored('aih-workbench-step-' + role, null)) ?? steps[0];
  const special = Object.hasOwn(ancillary, stepInput);
  const step = special ? { id: stepInput, ...ancillary[stepInput] } : steps.find(item => item.id === stepInput) ?? prior;
  return { role, theme, steps, prior, step, special };
}

function render(focus = false, refresh = false) {
  const next = routeState();
  const { role, theme, steps, prior, step, special } = next;
  const sameStep = current?.role === role && current?.step.id === step.id;
  const index = steps.findIndex(item => item.id === step.id);
  const route = id => path(theme, role, id);
  if (current?.theme !== theme) {
    scene?.destroy();
    document.documentElement.dataset.workbenchTheme = theme;
    $('ix-book').hidden = theme !== 'light';
    scene = theme === 'light' ? mountWorkbenchBook($('ix-book')) : mountScene($('ix-canvas'), $('ix-ambient'));
  }
  current = next;
  store(editionKey, theme);
  store(roleKey, role);
  if (!special) store('aih-workbench-step-' + role, step.id);
  const edition = $('ix-light');
  edition.href = path(theme === 'light' ? 'dark' : 'light', role, step.id);
  edition.replaceChildren(icon('light'), document.createTextNode(theme === 'light' ? 'Dark edition' : 'Light edition'));
  $('ix-reports').href = route('reports');
  $('ix-profiles').href = route('profiles');
  $('ix-diagnostics').href = route('diagnostics');
  for (const id of ['reports', 'profiles', 'diagnostics']) {
    if (step.id === id) $('ix-' + id).setAttribute('aria-current', 'page');
    else $('ix-' + id).removeAttribute('aria-current');
  }
  view.toggleAttribute('data-report-view', step.id === 'reports');
  scene?.setStep(index, role, step);
  showMotion();


  const definition = roles[role];
  $('ix-title').textContent = definition.title;
  $('ix-description').textContent = definition.description;
  const shortcut = $('ix-shortcut');
  shortcut.hidden = role !== 'admin' || step.id === 'scan';
  shortcut.href = route('scan');
  shortcut.replaceChildren(icon('scan'), document.createTextNode('Inspect Scan evidence'), icon('arrow-up-right', { size: 12 }));
  $('ix-rail-title').textContent = definition.rail;
  $('ix-position').textContent = (index + 1) + ' / ' + steps.length;
  $('ix-position').hidden = special;
  const nav = $('ix-role-nav');
  nav.replaceChildren(...Object.entries(roles).map(([key, value]) => {
    const entry = link(value.label, path(theme, key, step.id === 'reports' ? 'reports' : null), 'ix-role');
    if (key === role) entry.setAttribute('aria-current', 'page');
    return entry;
  }));
  const stepLinks = $('ix-step-nav');
  const menu = $('ix-step-select');
  stepLinks.replaceChildren();
  menu.replaceChildren();
  for (const [order, item] of steps.entries()) {
    const entry = link(item.title, route(item.id), 'ix-step');
    entry.prepend(icon(item.id === 'start' && role === 'enterprise' ? 'org' : item.id, { size: 16, tone: item.id }));
    if (item.id === step.id) entry.setAttribute('aria-current', 'step');
    stepLinks.append(entry);
    menu.append(new Option((order + 1) + ' · ' + item.title, item.id));
  }
  if (special) menu.append(new Option(step.title, step.id));
  menu.value = step.id;
  const resume = $('ix-return-setup');
  resume.hidden = !special;
  resume.href = route(prior.id);
  resume.textContent = '← Return to ' + prior.title;
  $('ix-phase').hidden = special;
  $('ix-phase').textContent = 'Step ' + String(index + 1).padStart(2, '0');
  $('ix-step-title').textContent = step.title;
  if (step.id === 'reports') $('ix-step-title').setAttribute('aria-level', '1');
  else $('ix-step-title').removeAttribute('aria-level');
  $('ix-step-description').textContent = step.description;
  document.title = step.title + ' · ' + definition.label + ' · AIHQ Workbench';

  const draftKey = 'aih-workbench-draft-' + role;
  const draft = { ...emptyDraft(), ...readStored(draftKey, {}) };
  function saveDraft(value) {
    if (!store(draftKey, value)) status('This browser does not allow saving. Export the setup to keep it.');
  }
  const activePolicy = () => managedMode() ? currentPolicy() : publishedSelection();
  const published = activePolicy();
  const roleData = role === 'enterprise' ? restrictEnterprise(data, published) : data;
  const api = {
    role, route, status, data: roleData, fullData: data, published, draft,
    currentData: () => role === 'enterprise' ? restrictEnterprise(data, activePolicy()) : data,
    refresh() { render(false, true); },
    change(key, value) { draft[key] = value; saveDraft(draft); },
    replaceDraft(value) { saveDraft(value); render(false, true); },
    returnFromProfiles(message) { location.hash = resume.hash; status(message); },
  };
  if (!sameStep || refresh) {
    mounted?.abort();
    mounted = new AbortController();
    api.signal = mounted.signal;
    host.replaceChildren();
    if (special) step.render(host, api);
    else renderJourney(host, step.id, api);
  }
  const footer = $('ix-footer');
  footer.replaceChildren();
  if (!special) {
    const undoKey = draftKey + '-before-reset';
    footer.append(action('Reset draft', () => {
      if (!store(undoKey, readStored(draftKey, emptyDraft())) || !store(draftKey, emptyDraft())) {
        status('This browser could not reset the draft.');
        return;
      }
      render(false, true);
      status('Draft reset. Use Undo reset to restore it.');
    }));
    if (readStored(undoKey, null)) footer.append(action('Undo reset', () => {
      const saved = readStored(undoKey, null);
      if (!saved || !store(draftKey, saved)) {
        status('This browser could not restore the draft.');
        return;
      }
      store(undoKey, null);
      render(false, true);
      status('Draft restored.');
    }));
  }
  if (index > 0) footer.append(link('← Back', route(steps[index - 1].id), 'ix-back'));
  if (index >= 0 && steps[index + 1]) {
    const advance = link('Continue', route(steps[index + 1].id), 'ix-primary ix-advance');
    advance.append(icon('arrow-right', { size: 15 }));
    footer.append(advance);
  }
  footer.hidden = !footer.childElementCount;
  if (focus && !sameStep) $('ix-step-title').focus();
}

$('ix-motion').addEventListener('click', () => {
  paused = !paused;
  store(motionKey, paused);
  showMotion();
});
$('ix-step-select').addEventListener('change', event => {
  location.hash = path(current.theme, current.role, event.target.value);
});
for (const [id, key] of [['reports', 'review'], ['diagnostics', 'diagnostics'], ['profiles', 'profiles']]) {
  $(`ix-${id}`).prepend(icon(key, { size: 16 }));
}
window.addEventListener('hashchange', () => render(true));
render();
loadWorkbench().then(result => {
  Object.assign(data, result);
  if (current?.step.id === 'reports') window.dispatchEvent(new Event('aih-workbench-data'));
  else render(false, true);
}).catch(() => {
  data.gaps = { catalog: 'The Workbench host could not be reached.', clients: 'Core is unavailable.', tools: 'Core is unavailable.' };
  if (current?.step.id === 'reports') window.dispatchEvent(new Event('aih-workbench-data'));
  else render(false, true);
});

loadConfiguration().then(refreshPolicy).finally(() => {
  if (current.role === 'enterprise' || current.step.id === 'publish') {
    if (current.step.id === 'reports') window.dispatchEvent(new Event('aih-workbench-data'));
    else render(false, true);
  }
});

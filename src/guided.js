// Get started: a goal sentence, an optional local project folder and the AI clients become a
// short list of starter choices, a copyable prompt and a saved draft. The folder is read in this
// page only and nothing from it is sent anywhere. Rules live in app/guided-rules.js; Core
// validates and composes through the same authoring operations as the policy workspace.
import { el } from './app/dom.js';
import { clientNodes, offersClient, publishedClients } from './app/core-targets.js';
import { adapterClientIds } from './app/client-identity.js';
import { createAuthoringClient, importLimitError } from './app/authoring-client.js';
import { loadSetup } from './app/settings-client.js';
import { saveDraftHandoff } from './app/draft-session.js';
import { defaultCatalogTool, saveCatalogTool, savedCatalogTool } from './catalog/catalog-tool.js';
import { declaredTargets } from './catalog/authoring-model.js';
import { ADDED_BY_YOU, KNOWN_STACK, MANIFEST_BYTE_LIMIT, addDetection, choiceReason, clientPrompt, describePolicy, detectStack, observationsFrom, provenanceText, reconcileClient, suggestStarters, wantsContent }
  from './app/guided-rules.js';

const $ = id => document.getElementById(id);
const TONE_CLASS = {
  warning: 'bg-tertiary-container text-tertiary',
  neutral: 'bg-surface-container-highest text-on-surface-variant',
  success: 'bg-secondary-container text-secondary',
};
const LINE_LABEL = { chosen: ['Chosen', 'success'], included: ['Included', 'neutral'], unknown: ['Unknown', 'warning'] };
const INTENT_SCHEMA = 'urn:aihq:workbench:saved-intent:3.0.0';
const REVIEW_SCHEMA = 'urn:aihq:workbench:review-decisions:1.0.0';
const DOWNLOAD_NAME = 'guided-setup.journey.json';

let listSource = 'supported by Core';
// Core's nativeClientIds when it published them, and the tool states the latest readiness check reported by client id.
let coreList = null, observed = {};
let detections = [], folderChosen = false, published = [], publishedLabels = {}, suggestion = null, busy = false, suggesting = false, started = false;
// The inputs the current suggestion was made from, and a counter that changes whenever that suggestion stops applying.
let snapshot = null, generation = 0, savedShown = false, preparedBytes = null;
const clients = new Map(); // id -> { setup, detected, added, checked, unlisted }
const picked = new Map();  // itemId -> checked

let clientPromise;
const ensureClient = () => clientPromise ??= (async () => {
  const client = createAuthoringClient({ sessionRecovery: false });
  await client.start();
  return client;
})().catch(error => { clientPromise = undefined; throw error; });

const goal = () => $('goal').value.trim();
const selectedClients = () => [...clients].filter(([, state]) => state.checked).map(([id]) => id).sort();
const messagesOf = result => (result?.diagnostics ?? []).map(item => item.message).filter(Boolean);
// The tool name the Catalog uses for the person's AI tool, as chosen here or as Your tool in the catalog's header; never derived from the clients.
const catalogTool = () => $('catalog-tool').value;
const inputsNow = () => ({ goal: goal(), detections, clients: selectedClients(), projectInspected: folderChosen, observations: observed, catalogTool: catalogTool() });
const sameInputs = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STALE_MESSAGE = 'Your inputs changed; suggest again to update the choices.';
const SUPERSEDED_SAVE = 'Nothing was saved: a newer action replaced this one. Try again.';

// A suggestion answers one set of inputs. Any change to them hides what was derived from it.
function invalidate() {
  generation += 1;
  suggestion = null; snapshot = null;
  picked.clear();
  $('suggestion').hidden = true;
  $('choices').replaceChildren(); $('prompt').value = '';
  // A draft already saved stays true to what was saved; only new choices need a new suggestion.
  if (savedShown) $('save-status').textContent = 'The prepared draft uses your earlier inputs. Suggest again to prepare new choices.';
  else { $('save-section').hidden = true; $('download').hidden = true; $('saved').hidden = true; $('save-status').textContent = ''; }
  $('suggest-status').textContent = STALE_MESSAGE;
  syncButtons();
}
// While a save runs its inputs stay fixed; anything that arrives meanwhile is compared once it ends.
function checkStale() {
  if (!busy && suggestion && !sameInputs(inputsNow(), snapshot)) invalidate();
  syncButtons();
}
function syncButtons() {
  $('suggest').disabled = busy || suggesting;
  $('save').disabled = busy || !suggestion || !suggestion.choices.some(choice => picked.get(choice.itemId));
  $('continue-workbench').hidden = !preparedBytes;
  $('continue-workbench').disabled = busy;
  $('download').disabled = busy;
  for (const id of ['goal', 'folder', 'add-stack', 'add-stack-button', 'reopen-file']) $(id).disabled = busy;
  $('detect-clients').disabled = busy || published.length === 0;
  for (const control of [...$('detections').querySelectorAll('button'), ...$('clients').querySelectorAll('input'), ...$('choices').querySelectorAll('input')]) control.disabled = busy;
}

function showLines(list, lines) {
  list.replaceChildren(...lines.map(line => {
    const [label, tone] = LINE_LABEL[line.kind];
    const item = el('li', 'border border-wb-border rounded p-2 flex flex-wrap items-start gap-2');
    item.append(el('span', `px-1.5 py-0.5 rounded text-xs font-medium ${TONE_CLASS[tone]}`, label), el('span', 'flex-1', line.text));
    return item;
  }));
}
function showRefusal(status, prefix, messages) {
  status.replaceChildren(el('span', 'block', prefix), ...messages.map(message => el('span', 'block', message)));
}

// Project detections
function renderDetections() {
  $('detections').replaceChildren(...detections.map(detection => {
    const item = el('li', 'border border-wb-border rounded p-2 flex flex-wrap items-center gap-2');
    const remove = el('button', 'px-2 py-0.5 rounded border border-wb-control-border text-xs hover:bg-surface-container', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${detection.label}`);
    remove.addEventListener('click', () => { detections = detections.filter(other => other.id !== detection.id); renderDetections(); });
    item.append(el('span', 'font-medium', detection.label), el('span', 'px-1.5 py-0.5 rounded text-xs bg-surface-container-highest text-on-surface-variant', detection.kind),
      el('span', 'text-xs text-on-surface-variant flex-1', provenanceText(detection)), remove);
    return item;
  }));
  if (!detections.length) $('detections').append(el('li', 'text-on-surface-variant', 'Nothing recognised yet. Choose a folder or add what your project uses.'));
  const options = KNOWN_STACK.filter(known => !detections.some(detection => detection.id === known.id));
  const placeholder = el('option', '', 'Choose…');
  placeholder.value = '';
  $('add-stack').replaceChildren(placeholder, ...options.map(known => { const option = el('option', '', `${known.label} (${known.kind})`); option.value = known.id; return option; }));
  checkStale();
}

async function inspectFolder(fileList) {
  const files = [];
  let unread = 0;
  for (const file of fileList) {
    const path = String(file.webkitRelativePath ?? '').split('/').slice(1).join('/');
    if (!path) continue;
    if (!wantsContent(path)) { files.push({ path }); continue; }
    if (file.size > MANIFEST_BYTE_LIMIT) { unread += 1; files.push({ path }); continue; }
    try { files.push({ path, text: await file.text() }); } catch { unread += 1; files.push({ path }); }
  }
  const byHand = detections.filter(detection => detection.provenance.includes(ADDED_BY_YOU));
  detections = detectStack(files).detections;
  for (const detection of byHand) detections = addDetection(detections, detection.id);
  folderChosen = files.length > 0;
  $('folder-status').textContent = folderChosen
    ? `Looked at ${files.length} file names in this browser and recognised ${detections.length} things. Nothing was uploaded.${unread ? ` ${unread} manifest file(s) were too large or unreadable and counted by name only.` : ''}`
    : 'No folder chosen. You can skip this and add what your project uses by hand.';
  renderDetections();
}

// AI clients
function renderClients() {
  const rows = [...clients].sort(([a], [b]) => a < b ? -1 : 1).map(([id, state]) => {
    const item = el('li', 'flex flex-wrap items-center gap-2');
    const label = el('label', 'flex items-center gap-2');
    const box = el('input'); box.type = 'checkbox'; box.checked = state.checked;
    box.addEventListener('change', () => {
      state.checked = box.checked;
      state.autoTicked = false;
      state.added = box.checked && !state.setup && !state.detected;
      renderClients();
    });
    // A saved client outside the offered list is shown, not offered as a choice.
    label.append(...(state.unlisted ? [] : [box]), ...clientNodes(publishedLabels, id));
    const tags = [state.unlisted ? 'saved in your Workbench setup, but not in the list this Workbench offers' : state.setup && 'chosen in your Workbench setup', state.detected && (state.broken ? 'found on this machine, but its check failed' : 'detected on this machine'), state.added && 'added by you'].filter(Boolean);
    item.append(label, el('span', 'text-xs text-on-surface-variant', tags.length ? tags.join(' · ') : listSource));
    return item;
  });
  $('clients').replaceChildren(...rows);
  // Clients can arrive after suggestions (saved setup, detection); a suggestion made without them no longer applies.
  checkStale();
  if (!rows.length) $('clients').append(el('li', 'text-on-surface-variant', 'No AI clients are known yet. Neither Core nor the installed Catalog lists them for this Workbench.'));
}
const clientState = id => { if (!clients.has(id)) clients.set(id, { setup: false, detected: false, broken: false, added: false, checked: false, unlisted: false, autoTicked: false }); return clients.get(id); };

async function loadClients() {
  try {
    const summary = await (await fetch('/api/packages')).json();
    const offered = publishedClients(summary.coreTargets);
    if (offered) { published = offered.ids; publishedLabels = offered.labels; coreList = offered.ids; }
  } catch { /* the setup choices below still work */ }
  // Without Core's published list, offer the clients the installed Catalog has an adapter for.
  if (!published.length) {
    try {
      const client = await ensureClient();
      published = adapterClientIds(client.catalog.items);
      if (published.length) listSource = 'has a Catalog adapter · Core support unknown';
    } catch { /* reported when suggestions are requested */ }
  }
  for (const id of published) clientState(id);
  try {
    const result = await loadSetup();
    if (result.state === 'saved' && Array.isArray(result.settings?.clients))
      // A saved client outside the offered list keeps its saved preference but is not an active choice.
      for (const id of result.settings.clients.filter(value => typeof value === 'string')) { const state = clientState(id); state.setup = true; state.unlisted = !offersClient(published, id); state.checked = !state.unlisted; }
  } catch { /* no saved Workbench setup */ }
  renderClients();
  syncButtons();
  if (!published.length) $('clients-status').textContent = 'Detecting is unavailable: neither Core nor the installed Catalog lists AI clients for this Workbench.';
}

async function detectClients() {
  $('detect-clients').disabled = true;
  $('clients-status').textContent = 'Checking this machine (read-only, network off)…';
  try {
    const response = await fetch('/api/readiness-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targets: published, network: 'off' }) });
    const payload = await response.json();
    if (!response.ok || payload.status !== 'ok') throw new Error(messagesOf(payload).join(' ') || payload.message || `The host answered ${response.status}.`);
    // Core states each client as runnable or binary (found), broken (found, but its check failed), config-only, or absent.
    // This check replaces every earlier answer: a client it does not report as found is no longer detected.
    observed = observationsFrom(payload.value?.projection?.tools);
    for (const id of Object.keys(observed)) clientState(id);
    for (const [id, state] of clients) clients.set(id, reconcileClient(state, observed[id]));
    renderClients();
    const found = Object.keys(observed).filter(id => clients.get(id)?.detected).sort();
    const broken = found.filter(id => clients.get(id).broken);
    $('clients-status').textContent = found.length
      ? `Found ${found.join(', ')} on this machine.${broken.length ? ` ${broken.join(', ')} did not pass its check; use Fix what's broken to see why.` : ''} Nothing was changed.`
      : 'No supported AI client was found on this machine. Nothing was changed.';
  } catch (error) {
    $('clients-status').textContent = `The check did not run: ${error.message} You can still tick the clients you use.`;
  } finally { syncButtons(); }
}

// Suggestions
function refreshPrompt() {
  if (!suggestion) return;
  const chosen = suggestion.choices.filter(choice => picked.get(choice.itemId));
  $('prompt').value = clientPrompt({ goal: snapshot.goal, detections: snapshot.detections, clients: snapshot.clients, choices: chosen });
  syncButtons();
}

function choiceCard(choice) {
  const item = el('li', 'border border-wb-border rounded p-3 space-y-2');
  const head = el('label', 'flex items-center gap-2 font-medium');
  const box = el('input'); box.type = 'checkbox'; box.checked = picked.get(choice.itemId) !== false;
  box.addEventListener('change', () => {
    picked.set(choice.itemId, box.checked);
    preparedBytes = null; savedShown = false;
    $('download').hidden = true; $('saved').hidden = true;
    $('save-status').textContent = 'Your choices changed. Create a new draft to download or continue.';
    refreshPrompt();
  });
  head.append(box, el('span', '', choice.label), el('span', 'text-xs font-normal text-on-surface-variant', choice.scope === 'user' ? 'for your user account' : 'in this project'));
  item.append(head);
  const section = (title, lines) => {
    const block = el('div', 'space-y-0.5');
    block.append(el('p', 'text-xs font-medium text-on-surface-variant', title));
    if (!lines.length) block.append(el('p', 'text-xs text-on-surface-variant', 'Nothing else.'));
    for (const line of lines) block.append(el('p', '', line));
    details.append(block);
  };
  const details = el('details', 'space-y-2');
  details.append(el('summary', 'text-primary font-medium', 'Why this choice and what it changes'));
  item.append(el('p', '', choice.helpsWith), details);
  section('What it helps with', [choice.helpsWith]);
  section('What the catalog says', [choice.catalogDescription || 'The catalog gives no description for this item.']);
  section('What it needs', choice.needs);
  section('What it will change', choice.changes);
  // Three separate facts; none of them implies another.
  if (choice.client) section('About this client', [choice.client.target.text, choice.client.core.text, choice.client.installed.text]);
  section('Why suggested', [choice.why]);
  return item;
}

async function suggest() {
  if (busy || suggesting) return;
  suggesting = true; syncButtons();
  const inputs = inputsNow();
  $('suggest-status').textContent = 'Matching your goal and project to the installed catalog…';
  try {
    const client = await ensureClient();
    if (!sameInputs(inputsNow(), inputs)) { $('suggest-status').textContent = STALE_MESSAGE; return; }
    generation += 1;
    snapshot = inputs;
    suggestion = suggestStarters({ ...inputs, catalogItems: client.catalog.items, coreClients: coreList });
    picked.clear();
    for (const choice of suggestion.choices) picked.set(choice.itemId, true);
    $('suggestion').hidden = false;
    $('suggestion-message').textContent = suggestion.message;
    $('choices').replaceChildren(...suggestion.choices.map(choiceCard));
    $('browse-link').hidden = suggestion.status === 'confident';
    $('prompt-block').hidden = false;
    $('save-section').hidden = suggestion.status !== 'confident';
    $('download').hidden = true; $('saved').hidden = true; $('save-status').textContent = ''; savedShown = false; preparedBytes = null;
    $('copy-status').textContent = 'Copying only puts this text on your clipboard. It executes nothing and changes nothing.';
    refreshPrompt();
    $('suggest-status').textContent = suggestion.status === 'confident' ? 'Suggestions are ready below.' : 'No confident suggestion.';
  } catch (error) {
    $('suggest-status').textContent = `The installed catalog could not be read: ${error.message}`;
  } finally { suggesting = false; syncButtons(); }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText($('prompt').value);
    $('copy-status').textContent = 'Copied to your clipboard. Nothing was executed or changed.';
  } catch {
    $('copy-status').textContent = 'The browser refused clipboard access. Select the text above and copy it yourself; nothing was executed.';
  }
}

// Save, download and reopen
function download(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = DOWNLOAD_NAME; link.click();
  URL.revokeObjectURL(url);
}

async function save() {
  const chosen = suggestion?.choices.filter(choice => picked.get(choice.itemId)) ?? [];
  if (!chosen.length) { $('save-status').textContent = 'Tick at least one starter choice to save.'; return; }
  const mine = generation, inputs = snapshot, rulesVersion = suggestion.rulesVersion;
  // A result belongs to the suggestion it started from; if that no longer applies the page already says so.
  const outdated = () => mine !== generation;
  busy = true; savedShown = false; preparedBytes = null; syncButtons(); $('download').hidden = true; $('saved').hidden = true;
  $('save-status').textContent = 'Preparing choices as a draft…';
  try {
    const client = await ensureClient();
    if (outdated()) return;
    const items = new Map(client.catalog.items.map(item => [item.id, item]));
    const missing = chosen.find(choice => !items.get(choice.itemId)?.root);
    if (missing) { $('save-status').textContent = `Nothing was saved: the installed catalog no longer offers ${missing.label}.`; return; }
    const intent = { schema: INTENT_SCHEMA, origins: [{ id: 'direct', kind: 'direct' }],
      roots: chosen.map(choice => ({ ...items.get(choice.itemId).root, scope: choice.scope, configuration: {}, originIds: ['direct'],
        reason: choiceReason({ goal: inputs.goal, detections: inputs.detections, choice, rulesVersion }) })),
      exclusions: [], pins: [], provenance: [], inputs: [], reviews: { schema: REVIEW_SCHEMA, records: [], history: [] } };
    const fresh = await client.newDraft();
    if (outdated()) return;
    if (fresh.status === 'superseded') { $('save-status').textContent = SUPERSEDED_SAVE; return; }
    if (fresh.status !== 'ok') { showRefusal($('save-status'), 'Nothing was saved. The host refused to start a draft.', messagesOf(fresh)); return; }
    const composed = await client.request('compose', { intent });
    if (outdated()) return;
    if (composed.status !== 'ok') { showRefusal($('save-status'), 'Nothing was saved. The choices were refused:', messagesOf(composed)); return; }
    const opened = await client.openDraft(Uint8Array.from(composed.value.policyBytes));
    if (outdated()) return;
    if (opened.status === 'superseded') { $('save-status').textContent = SUPERSEDED_SAVE; return; }
    if (opened.status !== 'ok' || !client.draft) { showRefusal($('save-status'), 'Nothing was saved. The draft could not be opened:', messagesOf(opened)); return; }
    showLines($('saved-lines'), describePolicy({ roots: client.draft.roots, pins: client.draft.intent?.pins ?? [], catalogItems: client.catalog.items }));
    $('saved').hidden = false; $('download').hidden = false; savedShown = true;
    preparedBytes = Uint8Array.from(client.draft.envelopeBytes);
    $('save-status').textContent = 'Draft prepared in this page. Download it to keep a file, or continue in Workbench to review these exact choices. Nothing was installed.';
  } catch (error) {
    if (!outdated()) $('save-status').textContent = `Nothing was saved: ${error.message}`;
  } finally { busy = false; refreshPrompt(); syncButtons(); checkStale(); }
}

async function reopen(file) {
  $('reopened').hidden = true;
  // Reopening replaces the saved draft, so the earlier save result and download no longer apply.
  $('saved').hidden = true; $('download').hidden = true; savedShown = false;
  preparedBytes = null; syncButtons();
  if (!file) { $('reopen-status').textContent = ''; return; }
  const tooLarge = importLimitError(file.size);
  if (tooLarge) { $('reopen-status').textContent = tooLarge; return; }
  $('reopen-status').textContent = 'Reopening…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tooBig = importLimitError(bytes.length, bytes);
    if (tooBig) { $('reopen-status').textContent = tooBig; return; }
    const client = await ensureClient();
    client.importBytes(bytes);
    const result = await client.reopen();
    if (result.status === 'superseded') { $('reopen-status').textContent = 'A newer action replaced this one.'; return; }
    const refusals = result.status === 'ok' ? (result.value?.editing === 'unavailable' ? messagesOf(result.value) : []) : messagesOf(result);
    if (result.status !== 'ok' || refusals.length) {
      showRefusal($('reopen-status'), 'This setup could not be reopened:', refusals.length ? refusals : [`The host answered ${result.status}.`]);
      return;
    }
    const roots = client.draft?.roots ?? client.intent?.roots ?? [];
    const pins = client.draft?.intent?.pins ?? client.intent?.pins ?? [];
    showLines($('reopen-lines'), describePolicy({ roots, pins, catalogItems: client.catalog.items }));
    $('reopened').hidden = false;
    preparedBytes = Uint8Array.from(client.draft?.envelopeBytes ?? bytes);
    $('save-section').hidden = false;
    syncButtons();
    $('reopen-status').textContent = 'Reopened. Your choices are shown exactly as saved.';
  } catch (error) {
    $('reopen-status').textContent = `This setup could not be reopened: ${error.message}`;
  }
}

// The Catalog's own tool names, with the person's saved choice selected when the Catalog still declares it.
function fillCatalogTools(client) {
  const declared = declaredTargets(client.catalog.items), select = $('catalog-tool');
  select.replaceChildren(new Option('choose…', ''), ...declared.map(value => new Option(value, value)));
  select.value = defaultCatalogTool(declared, savedCatalogTool());
  checkStale();
}

function startGuided() {
  $('guided').hidden = false;
  $('start-guided').setAttribute('aria-expanded', 'true');
  if (started) return;
  started = true;
  renderDetections();
  loadClients();
  ensureClient().then(fillCatalogTools).catch(() => { /* reported when suggestions are requested */ });
  $('goal').focus();
}

$('start-guided').addEventListener('click', startGuided);
$('goal').addEventListener('input', () => { $('goal-count').textContent = String($('goal').value.length); checkStale(); });
$('folder').addEventListener('change', () => inspectFolder([...$('folder').files]));
$('add-stack-button').addEventListener('click', () => { if ($('add-stack').value) { detections = addDetection(detections, $('add-stack').value); renderDetections(); } });
$('detect-clients').addEventListener('click', detectClients);
$('suggest').addEventListener('click', suggest);
$('catalog-tool').addEventListener('change', () => { saveCatalogTool(catalogTool()); checkStale(); });
$('copy-prompt').addEventListener('click', copyPrompt);
$('save').addEventListener('click', save);
$('download').addEventListener('click', () => {
  if (!preparedBytes) return;
  download(preparedBytes);
  $('save-status').textContent = 'Download requested. Keep the downloaded setup file to reopen these choices; nothing was installed.';
});
$('continue-workbench').addEventListener('click', () => {
  if (!preparedBytes) return;
  try {
    if (!saveDraftHandoff(preparedBytes)) throw new Error('Browser session storage is full or unavailable.');
    window.location.assign('/');
  }
  catch (error) { $('save-status').textContent = `The draft could not be handed to Workbench: ${error.message} Download the setup file and open it in Workbench instead.`; }
});
$('reopen-file').addEventListener('change', () => reopen($('reopen-file').files[0]));


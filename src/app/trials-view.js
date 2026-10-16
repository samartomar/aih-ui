// Only the suggestion's portable record fields cross the recording boundary.
const SUGGESTION_FIELDS = ['id', 'revision', 'rulesVersion', 'scope', 'change', 'triggers', 'goal', 'references', 'facts', 'unknowns'];
const PLAN_FIELDS = ['scope', 'task', 'quality', 'conditions', 'bounds', 'unknowns'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export const proposeOperation = (suggestion, form) => ({ type: 'propose', suggestion: pick(suggestion, SUGGESTION_FIELDS), ...pick(form, PLAN_FIELDS) });
export const boundText = bound => `${bound.label}: ${bound.value} ${bound.unit} — ${bound.enforcement?.kind === 'enforced' ? `enforced by ${bound.enforcement.mechanism.label}` : 'advisory, not enforced'}`;
export function outcomeText(evaluation, record) {
  const outcome = record?.evidence?.outcome ?? evaluation?.outcome;
  return outcome === 'qualifying-improvement' ? 'The trial met the quality bar.' : outcome === 'no-qualifying-improvement' ? 'No demonstrated qualifying improvement: the trial did not meet the quality bar.' : "Inconclusive: the trial's quality is not known yet.";
}
export function stateText(record) {
  if (record.state === 'stopped') return 'Stopped. Evaluation ended. This does not mean anything was undone.';
  if (record.state === 'kept') return record.evidence?.outcome === 'qualifying-improvement' ? 'Kept. The trial met the quality bar.' : record.evidence?.outcome === 'no-qualifying-improvement' ? 'Kept without a demonstrated qualifying improvement.' : 'Kept. The evidence is inconclusive: this does not show an improvement.';
  return `${record.state[0].toUpperCase()}${record.state.slice(1)}.`;
}
export const restorationText = record => record.restoration ? `Restoration: ${record.restoration.status} (recorded by you)` : 'No restoration requested.';
const observedText = observation => observation?.value ? `${observation.value.amount} ${observation.value.unit}` : observation?.unknownReason ? `unknown (${observation.unknownReason})` : 'not observed';
export function overheadText(row) {
  if (row.status === 'not-observed') return 'not observed';
  if (row.status !== 'available') return `${row.baseline ? observedText(row.baseline) : row.before === undefined ? 'not observed' : `${row.before} ${row.unit ?? ''}`} → ${row.trial ? observedText(row.trial) : row.after === undefined ? 'not observed' : `${row.after} ${row.unit ?? ''}`} — not compared by Core (${row.reason})`;
  // Core owns comparison and percentage semantics, including the zero baseline.
  return `${row.before} → ${row.after} ${row.unit}, ${row.direction} of ${row.absoluteDifference} ${row.unit} (${row.percentage === null ? 'no percentage: zero baseline' : `${row.percentage}%`})`;
}
const DIMENSIONS = { setup: 'Setup', indexing: 'Indexing', 'runtime-context': 'Runtime/context (configured material size, not observed usage)', maintenance: 'Maintenance' };
const RESTORATION = ['proposed', 'pending', 'completed', 'partial', 'unsupported'];
const COST_UNKNOWN = 'Model or service spending: no cost source is connected, so it is unknown.';

export function createTrialsView({ client, el, button, showStatus }) {
  const node = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'policy-trials';
  const status = el('p', 'text-on-surface-variant'); status.setAttribute('role', 'status');
  const planning = el('div', 'space-y-2'), cards = el('div', 'space-y-2');
  node.append(el('h3', 'font-medium', 'Trials'), status, planning, cards);
  let value, checked, attempt = 0, pending = false, recording = false, changed = false, editor;
  const diagnostic = result => result?.diagnostics?.map(row => row.message).join(' ') || result?.error || 'The trials could not be read.';
  const safe = action => async () => { if (recording) return; try { await action(); } catch (error) { showStatus(error.message); } };
  const choice = (label, action) => { const control = button(label, safe(action)); control.disabled = recording; return control; };
  function field(parent, label, value = '', options) {
    const wrap = el('label', 'block text-on-surface-variant', label);
    const input = el(options ? 'select' : 'input', 'bg-wb-input border border-wb-border rounded p-1'); input.setAttribute('aria-label', label);
    if (options) for (const [key, text] of options) { const option = el('option', '', text); option.value = key; input.append(option); }
    else input.type = 'text';
    input.value = value; input.disabled = recording; wrap.append(input); parent.append(wrap); return input;
  }
  const lines = input => input.value.split('\n').map(text => text.trim()).filter(Boolean);
  function effectsField(parent, label, values = []) {
    const wrap = el('label', 'block text-on-surface-variant', `${label} (one per line)`);
    const input = el('textarea', 'w-full bg-wb-input border border-wb-border rounded p-1');
    input.value = values.join('\n'); input.setAttribute('aria-label', label); input.disabled = recording;
    wrap.append(input); parent.append(wrap); return input;
  }
  function plan(suggestion, previous) {
    if (recording || !(client.draft || client.intent)) return;
    checked = client.revision;
    editor = { suggestion, previous, form: previous ? pick(previous, PLAN_FIELDS) : { scope: suggestion.scope, task: '', quality: { outcome: '', checks: [{ id: 'check-1', text: '' }] }, conditions: '', bounds: [], unknowns: [COST_UNKNOWN] } };
    render();
    planning.scrollIntoView?.({ block: 'nearest' });
  }
  function renderPlan() {
    planning.replaceChildren(); if (!editor) return;
    const { suggestion, previous, form } = editor;
    planning.append(el('h4', 'font-medium', previous ? 'Revise trial' : 'Plan a trial'));
    const scope = field(planning, 'Trial scope', form.scope, [['project', 'Project'], ['user', 'User']]);
    const task = field(planning, 'Representative task', form.task);
    const outcome = field(planning, 'Acceptable outcome', form.quality.outcome);
    const checks = el('div', 'space-y-1'); planning.append(checks);
    let checkRows = form.quality.checks.map(check => ({ ...check })), nextCheck = checkRows.reduce((max, row) => Math.max(max, Number(row.id.split('-').pop()) || 0), 0);
    const conditions = field(planning, 'Comparison conditions', form.conditions);
    const bounds = el('div', 'space-y-1'); planning.append(bounds);
    let boundRows = form.bounds.map(bound => ({ ...bound })), nextBound = boundRows.reduce((max, row) => Math.max(max, Number(row.id.split('-').pop()) || 0), 0);
    const mechanisms = value?.mechanisms ?? [];
    if (!mechanisms.length) planning.append(el('p', 'text-outline', 'No enforcement mechanism is available here, so no bound is a cap.'));
    const unknowns = el('div', 'space-y-1'); planning.append(unknowns);
    let unknownRows = form.unknowns.map(text => ({ text }));
    const reason = previous ? field(planning, 'Revision reason') : undefined;
    function capture() {
      return { scope: scope.value, task: task.value.trim(), quality: { outcome: outcome.value.trim(), checks: checkRows.filter(row => row.input.value.trim()).map(row => ({ id: row.id, text: row.input.value.trim() })) }, conditions: conditions.value.trim(), bounds: boundRows.map(row => ({ id: row.id, label: row.labelInput.value.trim(), value: Number(row.valueInput.value), unit: row.unitInput.value.trim(), enforcement: row.enforcementInput.value === 'advisory' ? { kind: 'advisory' } : { kind: 'enforced', mechanism: mechanisms.find(mechanism => mechanism.id === row.enforcementInput.value) } })), unknowns: unknownRows.map(row => row.input.value.trim()).filter(Boolean) };
    }
    const submit = choice(previous ? 'Propose revision' : 'Propose trial', () => {
      const proposal = capture(); if (!proposal.quality.outcome || !proposal.quality.checks.length) return;
      return record(previous ? { type: 'revise', id: previous.id, proposal, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) } : proposeOperation(suggestion, proposal));
    });
    const validate = () => { submit.disabled = recording || !outcome.value.trim() || !checkRows.some(row => row.input.value.trim()); };
    // Preserve typed edits when an in-flight request makes every control inert.
    editor.capture = capture;
    function drawChecks() {
      checks.replaceChildren();
      checkRows.forEach((row, index) => { row.input = field(checks, `Quality check ${index + 1}`, row.input?.value ?? row.text); row.input.addEventListener('input', validate); checks.append(choice('Remove quality check', () => { checkRows = checkRows.filter(item => item !== row); drawChecks(); validate(); })); });
    }
    function drawBounds() {
      bounds.replaceChildren();
      boundRows.forEach((row, index) => {
        row.labelInput = field(bounds, `Bound ${index + 1} label`, row.labelInput?.value ?? row.label ?? '');
        row.valueInput = field(bounds, `Bound ${index + 1} value`, row.valueInput?.value ?? row.value ?? ''); row.valueInput.type = 'number'; row.valueInput.min = 0; row.valueInput.step = 'any';
        row.unitInput = field(bounds, `Bound ${index + 1} unit`, row.unitInput?.value ?? row.unit ?? '');
        row.enforcementInput = field(bounds, `Bound ${index + 1} enforcement`, row.enforcementInput?.value ?? row.enforcement?.mechanism?.id ?? 'advisory', [['advisory', 'Advisory (not enforced)'], ...mechanisms.map(m => [m.id, `Enforced by ${m.label}`])]);
        bounds.append(choice('Remove bound', () => { boundRows = boundRows.filter(item => item !== row); drawBounds(); }));
      });
    }
    function drawUnknowns() {
      unknowns.replaceChildren(); unknownRows.forEach((row, index) => { row.input = field(unknowns, `Unknown cost ${index + 1}`, row.input?.value ?? row.text); unknowns.append(choice('Remove unknown cost', () => { unknownRows = unknownRows.filter(item => item !== row); drawUnknowns(); })); });
    }
    drawChecks(); drawBounds(); drawUnknowns(); outcome.addEventListener('input', validate);
    planning.append(choice('Add quality check', () => { if (checkRows.length < 16) { checkRows.push({ id: `check-${++nextCheck}`, text: '' }); drawChecks(); validate(); } }), choice('Add bound', () => { if (boundRows.length < 16) { boundRows.push({ id: `bound-${++nextBound}` }); drawBounds(); } }), choice('Add unknown cost', () => { if (unknownRows.length < 16) { unknownRows.push({ text: '' }); drawUnknowns(); } }), submit, choice('Cancel plan', () => { editor = undefined; render(); })); validate();
  }
  function trialCard({ record: trial, evaluation, suggestion }) {
    const card = el('div', 'p-2 border border-wb-border rounded space-y-1'); card.dataset.trialId = trial.id;
    card.append(el('h4', 'font-medium', suggestion?.label ?? suggestion?.change?.itemId ?? trial.suggestion?.id), el('p', 'text-outline text-[11px]', `Scope: ${trial.scope}`), el('p', '', stateText(trial)), el('p', 'text-on-surface-variant', `Representative task: ${trial.task ?? ''}`), el('p', '', `Quality bar: ${trial.quality.outcome}`));
    for (const check of trial.quality.checks) card.append(el('p', 'text-on-surface-variant', check.text));
    card.append(el('p', 'text-on-surface-variant', `Comparison conditions: ${trial.conditions ?? ''}`));
    for (const bound of trial.bounds) card.append(el('p', 'text-on-surface-variant', boundText(bound)));
    card.append(el('h5', 'font-medium', 'Unknown costs'));
    for (const unknown of trial.unknowns) card.append(el('p', 'text-outline text-[11px]', unknown));
    card.append(el('h5', 'font-medium', 'Quality'));
    for (const option of ['baseline', 'trial']) {
      const q = evaluation?.quality?.options?.[option];
      card.append(el('p', 'text-on-surface-variant', `${option}: ${q?.state === 'not-met' ? 'not met' : q?.state ?? 'unknown'} (${q?.passed ?? 0} passed, ${q?.failed ?? 0} failed, ${q?.unknown ?? trial.quality.checks.length} unknown)`));
    }
    card.append(el('h5', 'font-medium', 'Overhead'));
    for (const [dimension, label] of Object.entries(DIMENSIONS)) card.append(el('p', 'text-on-surface-variant', `${label}: ${overheadText(evaluation?.overhead?.find(row => row.dimension === dimension) ?? { status: 'not-observed' })}`));
    card.append(el('p', '', outcomeText(evaluation, trial)));
    const narrower = trial.narrower ?? evaluation?.narrower;
    if (narrower) card.append(el('p', 'text-on-surface-variant', `Accepted a narrower outcome: ${narrower.qualification}`));
    if (trial.reason) card.append(el('p', 'text-on-surface-variant', `Decision reason: ${trial.reason}`));
    card.append(el('p', 'text-on-surface-variant', restorationText(trial)));
    for (const effect of trial.restoration?.effects ?? []) card.append(el('p', 'text-outline', effect));
    const action = (label, type, extra = () => ({})) => card.append(choice(label, () => record({ type, id: trial.id, ...extra() })));
    if (trial.state === 'proposed') action('Start', 'start');
    if (trial.state === 'started') {
      const observation = el('div', 'space-y-1'); card.append(observation);
      const option = field(observation, 'Observation option', 'baseline', [['baseline', 'Baseline'], ['trial', 'Trial']]);
      const target = field(observation, 'Observation target', 'setup', [...Object.entries(DIMENSIONS), ...trial.quality.checks.map(check => [`check:${check.id}`, check.text])]);
      const kind = field(observation, 'Observation kind', 'measured', ['measured', 'estimated', 'declared', 'unknown'].map(key => [key, key]));
      const numeric = field(observation, 'Observation amount'); numeric.type = 'number'; numeric.step = 'any';
      const result = field(observation, 'Quality result', 'passed', [['passed', 'Passed'], ['failed', 'Failed']]);
      const unit = field(observation, 'Observation unit');
      const methodId = field(observation, 'Method id'), methodVersion = field(observation, 'Method version'), unknownReason = field(observation, 'Unknown reason');
      const update = () => { const check = target.value.startsWith('check:'); numeric.hidden = unit.hidden = check || kind.value === 'unknown'; result.hidden = !check || kind.value === 'unknown'; methodId.hidden = methodVersion.hidden = kind.value !== 'estimated'; unknownReason.hidden = kind.value !== 'unknown'; };
      target.addEventListener('change', update); kind.addEventListener('change', update); update();
      action('Record observation', 'observe', () => ({ observation: { option: option.value, target: target.value.startsWith('check:') ? { check: target.value.slice(6) } : { dimension: target.value }, kind: kind.value, ...(kind.value === 'unknown' ? { unknownReason: unknownReason.value.trim() } : { value: target.value.startsWith('check:') ? { amount: result.value, unit: 'outcome' } : { amount: Number(numeric.value), unit: unit.value.trim() }, ...(kind.value === 'estimated' ? { method: { id: methodId.value.trim(), version: methodVersion.value.trim() } } : {}) }) } }));
      action('Measure configured context', 'measure-context');
    }
    if (['proposed', 'started'].includes(trial.state)) {
      const reason = field(card, 'Decision reason');
      const reasonValue = () => reason.value.trim() ? { reason: reason.value.trim() } : {};
      if (trial.state === 'started') action('Keep', 'keep', reasonValue);
      card.append(choice('Revise', () => plan(suggestion, trial)));
      const restoration = field(card, 'Request restoration', '', [['', 'None'], ...RESTORATION.map(status => [status, status])]);
      action('Stop', 'stop', () => ({ ...reasonValue(), ...(restoration.value ? { restoration: { status: restoration.value } } : {}) }));
    }
    if (trial.state === 'stopped') {
      const restoration = field(card, 'Restoration status', trial.restoration?.status ?? 'proposed', RESTORATION.map(status => [status, status]));
      const effects = effectsField(card, 'Restoration effects', trial.restoration?.effects);
      action('Record restoration', 'restoration', () => ({ status: restoration.value, effects: lines(effects) }));
    }
    if (['started', 'stopped'].includes(trial.state) && (trial.evidence?.outcome ?? evaluation?.outcome) !== 'qualifying-improvement') {
      const qualification = field(card, 'Narrower outcome qualification');
      action('Accept narrower outcome', 'accept-narrower', () => ({ qualification: qualification.value.trim() }));
    }
    return card;
  }
  function render() {
    node.hidden = !(client.draft || client.intent);
    if (!recording && checked !== undefined && checked !== client.revision) { value = undefined; editor = undefined; changed = true; }
    if (node.hidden) { attempt++; value = undefined; editor = undefined; pending = false; changed = false; }
    if (editor?.capture) editor.form = editor.capture();
    renderPlan(); cards.replaceChildren();
    status.textContent = pending ? 'Reading trials…' : changed ? 'The open policy or its inputs changed. Open trials again to refresh.' : 'Save the draft to keep trial records.';
    if (value && !node.hidden) for (const row of [...value.trials].sort((a, b) => b.record.proposedAt.localeCompare(a.record.proposedAt))) cards.append(trialCard(row));
  }
  async function read() {
    if (!(client.draft || client.intent)) return render();
    const current = ++attempt, revision = client.revision; pending = true; render();
    let result; try { result = await client.readTrials(); } catch (error) { result = { status: 'refused', error: error.message }; }
    if (current !== attempt) return;
    pending = false;
    if (revision !== client.revision || result?.status === 'superseded') return render();
    value = result.status === 'ok' ? result.value : undefined; checked = revision; changed = false;
    if (result.status !== 'ok') showStatus(diagnostic(result)); render();
  }
  async function record(operation) {
    if (recording) return;
    recording = true; render(); let result;
    try { result = await client.recordTrial(operation); }
    catch (error) { recording = false; checked = client.revision; render(); throw error; }
    recording = false;
    if (result.status === 'superseded') return render();
    if (result.status !== 'ok') { checked = client.revision; render(); return showStatus(diagnostic(result)); }
    value = undefined; editor = undefined; checked = client.revision;
    showStatus('Trial recorded. Save the draft to keep it.'); await read();
  }
  function open() { attempt++; value = undefined; editor = undefined; changed = false; checked = client.revision; return read(); }
  render(); return { node, render, open, plan };
}

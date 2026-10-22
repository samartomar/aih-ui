import { el } from './dom.js';

// One request at a time. Only the latest visible selection may start or paint.
// The timestamp is an explicit snapshot, renewed by Re-check sources.
export function createEvidenceLoader({ request, onState, delay = 250 }) {
  const cache = new Map();
  let visible = false, selection, timer, active, pending;
  let evaluationTime = new Date().toISOString();
  const keyOf = value => JSON.stringify([value?.target, value?.revision, evaluationTime]);
  const publish = (key, state) => { if (visible && selection && key === keyOf(selection)) onState(state); };
  async function run(job) {
    if (!visible || !selection || job.key !== keyOf(selection)) return;
    active = job;
    publish(job.key, { status: 'loading', evaluationTime: job.time });
    try {
      const result = await request({ target: job.target, evaluationTime: job.time, projection: 'inspector', policyBytes: undefined });
      if (job.time === evaluationTime && ['selected', 'unconfigured'].includes(result.status)) {
        cache.set(job.key, result);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      publish(job.key, result);
    } catch (error) { publish(job.key, { status: 'error', message: error.message }); }
    finally {
      active = undefined;
      const next = pending; pending = undefined;
      if (next) void run(next);
    }
  }
  function schedule() {
    clearTimeout(timer); pending = undefined;
    if (!visible || !selection) return;
    const key = keyOf(selection);
    if (cache.has(key)) { publish(key, cache.get(key)); return; }
    if (active?.key === key) { publish(key, { status: 'loading', evaluationTime }); return; }
    publish(key, { status: 'waiting', evaluationTime });
    timer = setTimeout(() => {
      const job = { key, target: selection.target, time: evaluationTime };
      if (active) pending = job; else void run(job);
    }, delay);
  }
  return {
    select(value) {
      const same = keyOf(selection) === keyOf(value);
      selection = value;
      if (!same) schedule();
    },
    setVisible(value) { if (visible === value) return; visible = value; schedule(); },
    recheck() {
      evaluationTime = new Date(Math.max(Date.now(), Date.parse(evaluationTime) + 1)).toISOString();
      cache.clear(); schedule();
    },
  };
}

const diagnostics = value => (value ?? []).map(item => item.detail ?? item.message ?? item.code).join(' ');
const capture = value => !value ? 'Unavailable' : value.status === 'matched'
  ? `Captured · ${value.observationCount} covering observations${value.observationCount ? '' : ' · no demonstrated detector coverage'}`
  : `${value.status}${value.unmatchedPathCount !== undefined ? ` · ${value.unmatchedPathCount} unmatched paths` : ''} · no demonstrated complete item coverage`;

export function createInspectorEvidence({ authoring, subscribeSecurity }) {
  const panel = el('section', 'inspector-evidence space-y-2');
  panel.setAttribute('aria-label', 'Selected item Scan evidence');
  const status = el('p', 'text-on-surface-variant'); status.setAttribute('role', 'status');
  const facts = el('div', 'space-y-2');
  const refresh = el('button', 'px-2 py-1 rounded border border-wb-control-border', 'Re-check sources'); refresh.type = 'button';
  panel.append(status, facts, refresh);
  let clock, visible = false, current;
  const stopClock = () => { clearInterval(clock); panel.removeAttribute('aria-busy'); };
  function render(result) {
    current = result; stopClock(); facts.replaceChildren();
    panel.dataset.state = result.status;
    if (result.status === 'loading' || result.status === 'waiting') {
      const start = Date.now(); panel.setAttribute('aria-busy', 'true');
      const update = () => { status.textContent = `${result.status === 'waiting' ? 'Waiting for selection' : 'Reading evidence'} · ${Math.floor((Date.now() - start) / 1000)}s. The first read of a large source can take longer.`; };
      update(); clock = setInterval(update, 1000); return;
    }
    if (result.status === 'error') { status.textContent = `Evidence could not be loaded. ${result.message} Use Re-check sources to retry.`; return; }
    if (result.status === 'unconfigured') { status.textContent = 'No evidence source configured or supplied for this release.'; return; }
    if (result.status !== 'selected') { status.textContent = `Evidence unavailable (${result.status}). ${diagnostics(result.diagnostics)}`; return; }
    status.textContent = `Evaluated ${result.evaluationTime} · ${result.freshness === 'last-known' ? 'Last known evidence; sources are incomplete or unavailable.' : 'Configured sources checked.'}`;
    let destination = facts;
    const row = (label, value) => destination.append(el('p', 'break-words', `${label}: ${value}`));
    row('This item — capture and coverage', capture(result.assessment?.coverage));
    if (result.baseline) {
      const baseline = result.baseline.evidence;
      row('Pinned release baseline', baseline ? `${baseline.eligibility} · inventory ${baseline.comparisonCoverage?.status ?? 'unavailable'}` : 'Unavailable');
      row('Baseline item capture', capture(baseline?.coverage));
      row('Baseline authenticity', baseline?.acquisitions.filter(value => value.sourceId === 'release-baseline').map(value => value.authentication.status).join(', ') || 'Not checked');
    } else row('Release baseline', 'Not published');
    const entry = result.assessment;
    if (entry) {
      const { summary } = entry;
      const source = el('details', 'inspector-source-evidence');
      source.append(el('summary', 'font-medium cursor-pointer', 'Whole scanned source — separate from this item'));
      facts.append(source); destination = source;
      row('Assessment', `${summary.completion} · ${summary.createdAt}`);
      row('Producer software', `${summary.producer.name} ${summary.producer.version}`);
      row('Finding records', `${summary.findings.records} · ${summary.findings.occurrences} occurrences across the source`);
      const severities = el('div', 'flex flex-wrap gap-1');
      for (const value of summary.findings.bySeverity) {
        const severity = value.severity;
        const chip = el('span', 'px-1.5 py-0.5 rounded border border-wb-border text-on-surface-variant', `${severity.state === 'present' ? severity.value.level : 'No severity'} ${value.records}`);
        chip.title = severity.state === 'present' ? severity.value.vendorSeverity ?? severity.value.level : severity.reason;
        severities.append(chip);
      }
      destination.append(severities);
      for (const acquisition of entry.acquisitions) row('Authentication', `${acquisition.sourceId} · ${acquisition.authentication.status}${acquisition.authentication.reason ? ` (${acquisition.authentication.reason})` : ''}`);
      for (const provider of summary.providers) row(provider.detectorId, `${provider.outcome}${provider.findings ? ` · ${provider.findings.records} source finding records` : ''}`);
    } else row('Latest matching assessment', 'None available; open Scan Review for eligibility and history.');
    destination = facts;
    for (const check of result.checks ?? []) if (check.status !== 'succeeded') row(`Source ${check.sourceId}`, `${check.status}${check.lastSuccessfulAt ? ` · last successful ${check.lastSuccessfulAt}` : ''}. ${diagnostics(check.diagnostics)}`);
    facts.append(el('p', 'text-outline', 'Source findings are not an item risk score. Baseline matching, authentication and item coverage are separate facts; none grants execution authority.'));
  }
  const loader = createEvidenceLoader({ request: body => authoring.request('scan-evidence', body), onState: render });
  refresh.addEventListener('click', () => loader.recheck());
  subscribeSecurity?.(value => {
    visible = value; if (!visible) stopClock();
    loader.setVisible(visible);
    if (visible && current && !['loading', 'waiting'].includes(current.status)) render(current);
  });
  return {
    panel,
    show(item) {
      panel.hidden = !item;
      loader.select(item ? { target: `${item.root.releaseSha256}/${item.id}`, revision: authoring.evidenceRevision } : undefined);
      if (!item) stopClock();
    },
  };
}

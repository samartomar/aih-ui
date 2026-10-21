import { el } from './dom.js';
import { evidenceView } from './evidence-view.js';

export function createScanEvidence(client, { onReview } = {}) {
  const panel = el('section', 'min-w-0 max-w-full space-y-2 border border-wb-border rounded p-3');
  panel.setAttribute('aria-label', 'Latest Scan evidence');
  panel.append(el('h3', 'font-medium', 'Latest, baseline and history'));
  panel.append(el('p', 'text-on-surface-variant', 'Evidence informs your choice. Authentication, content capture and detector coverage are separate facts. Viewing evidence keeps saved policies, reviews and prepared actions pinned.'));
  const target = el('select', 'w-full min-w-0 max-w-full bg-wb-input border border-wb-border rounded p-1'); target.setAttribute('aria-label', 'Scan content');
  const history = el('select', 'flex-1 min-w-0 max-w-full bg-wb-input border border-wb-border rounded p-1'); history.setAttribute('aria-label', 'Scan history');
  const scope = el('select', 'w-full min-w-0 max-w-full bg-wb-input border border-wb-border rounded p-1'); scope.setAttribute('aria-label', 'Scan requested scope');
  const supplied = el('input', 'min-w-0 max-w-full'); supplied.type = 'file'; supplied.multiple = true; supplied.setAttribute('aria-label', 'Evidence for latest view');
  const status = el('p', 'break-all'); status.setAttribute('role', 'status');
  const facts = el('div', 'space-y-2');
  let result, historicalId, attempt = 0, suppliedBytes = [], requestedScope;
  const button = (label, callback) => { const node = el('button', 'px-3 py-1 rounded border border-wb-border', label); node.type = 'button'; node.addEventListener('click', async () => { try { await callback(); } catch (error) { status.textContent = error.message; } }); return node; };
  function render() {
    facts.replaceChildren(); history.replaceChildren(new Option('Latest matching', ''));
    if (!result) { status.textContent = 'Check configured sources or supply evidence in this review.'; return; }
    if (result.status === 'unconfigured') {
      scope.replaceChildren(new Option('No assessment scope available', ''));
      status.textContent = 'No assessment available: no evidence source configured or supplied. Browsing, selection and saving remain available.';
      return;
    }
    if (result.status !== 'selected') { status.textContent = `Selection refused: ${JSON.stringify(result.diagnostics)}`; return; }
    const view = evidenceView(result, historicalId);
    const scopes = [result.context.selection, ...result.assessments.map(entry => entry.summary.selection)];
    scope.replaceChildren(...[...new Set(scopes.map(value => JSON.stringify(value)))].map((value, index) => {
      const selection = JSON.parse(value);
      const option = new Option(`Scope ${index + 1} · ${selection.paths.length} requested paths · ${selection.excludedPaths.length} excluded`, value);
      option.title = value;
      return option;
    }));
    scope.value = JSON.stringify(result.context.selection);
    scope.title = scope.value;
    for (const entry of result.assessments) {
      const option = new Option(`${entry.summary.createdAt} · ${entry.summary.completion} · ${entry.eligibility} · ${entry.summary.scanId.slice(-12)}`, entry.summary.scanId);
      option.title = entry.summary.scanId;
      history.append(option);
    }
    if (historicalId && !result.assessments.some(entry => entry.summary.scanId === historicalId)) {
      const option = new Option(`Unavailable · ${historicalId.slice(-12)}`, historicalId); option.title = historicalId; history.append(option);
    }
    history.value = historicalId ?? '';
    history.title = historicalId ?? result.selectedScanId ?? 'No matching evidence';
    status.textContent = `${view.mode === 'history' ? 'Historical selection' : 'Latest matching'}: ${view.scanId ?? 'No matching evidence'}. ${result.freshness === 'last-known' ? 'Last known: sources are incomplete or unavailable' : 'Configured sources checked'}. Evaluated ${result.evaluationTime}. ${view.newer ? 'Another latest result is available; choose Latest to return.' : ''} ${view.unavailable ? 'Historical artifact unavailable; its identity is retained.' : ''}`;
    const failed = result.checks.filter(check => check.status === 'failed');
    if (failed.length) status.textContent += ` Acquisition failed or evidence unreadable: ${failed.map(check => `${check.sourceId} (${check.diagnostics.map(value => value.code).join(', ')})`).join('; ')}.`;
    if (!view.scanId && result.assessments.length) status.textContent += ` Available assessments do not match: ${[...new Set(result.assessments.map(entry => entry.eligibility))].join(', ')}.`;
    const detail = (label, value) => { const node = el('details'); node.append(el('summary', 'cursor-pointer', label), el('pre', 'whitespace-pre-wrap break-all text-[10px]', JSON.stringify(value, null, 2))); facts.append(node); };
    const row = (label, value) => facts.append(el('p', 'text-on-surface-variant break-all', `${label}: ${value}`));
    const authentication = acquisitions => acquisitions.map(value => `${value.sourceId} (${value.location}) — ${value.authentication.status}${value.authentication.reason ? ` (${value.authentication.reason})` : ''}${value.authentication.producerIdentity ? ` · ${value.authentication.producerIdentity}` : ''}`).join('; ');
    const captureText = coverage => coverage?.status === 'matched' ? `captured; ${coverage.observations.length} covering observations${coverage.observations.length ? '' : ' — no demonstrated detector coverage'}` : `${coverage?.status ?? 'unavailable'} — no demonstrated complete item coverage`;
    if (result.baseline) {
      const baseline = result.baseline, evidence = baseline.evidence;
      const acquisition = evidence?.acquisitions.find(value => value.sourceId === 'release-baseline');
      const check = result.checks.find(value => value.sourceId === 'release-baseline');
      row('Release baseline', baseline.scanId);
      row('Baseline evidence check', acquisition ? `${check?.status ?? 'unknown'} check; ${evidence.comparisonCoverage.status} inventory; readable; ${authentication([acquisition])}` : 'Pinned artifact unavailable under current acquisition');
      row('Baseline item capture and coverage', captureText(evidence?.coverage));
    } else row('Release baseline', 'Not published for this release');
    detail('Release baseline — independent of latest and item coverage', result.baseline ?? 'No baseline published for this release');
    if (view.entry) {
      const { summary, acquisitions, coverage } = view.entry;
      facts.append(el('p', 'font-medium', `${summary.createdAt} · ${summary.completion} · ${summary.findings.records} finding records · ${summary.findings.occurrences} occurrences`));
      row('Producer software', `${summary.producer.name} ${summary.producer.version}`);
      row('Configured source and authentication', authentication(acquisitions));
      row('Requested scope', JSON.stringify(summary.selection));
      row('Current item capture and coverage', captureText(coverage));
      row('Reported severities', summary.findings.bySeverity.map(value => `${value.severity.state === 'present' ? `${value.severity.value.level}${value.severity.value.vendorSeverity ? ` (${value.severity.value.vendorSeverity})` : ''}` : `Unknown (${value.severity.reason})`}: ${value.records} records, ${value.occurrences} occurrences`).join('; ') || 'No finding records; this does not establish safety');
      detail('Content, requested scope and producer software', { scanId: summary.scanId, producer: summary.producer, source: summary.source, selection: summary.selection, context: result.context });
      detail('Configured acquisition sources and authentication', acquisitions);
      detail('Item capture and detector coverage — no safety determination', coverage);
      for (const provider of summary.providers) {
        row(provider.detectorId, `${provider.outcome}${provider.findings ? ` · ${provider.findings.records} finding records · ${provider.coverage.complete ? 'complete declared coverage' : 'incomplete coverage'}` : ''}`);
        for (const observation of provider.observations ?? []) row('Observation', `${observation.origin} · ${observation.startedAt} to ${observation.completedAt} · ${observation.gaps.length} explicit gaps`);
        detail(`${provider.detectorId}: provider detail`, provider);
      }
      detail('Report diagnostics and full detail references', { diagnostics: summary.diagnostics, annexes: summary.annexes, annexBytes: summary.annexBytes });
      if (onReview) facts.append(button('Use this exact assessment for a human review', () => onReview(summary.scanId)));
      facts.append(button('Download original Scan evidence', async () => {
        const detail = await client.request('scan-evidence-detail', { scanId: view.scanId, policyBytes: undefined });
        if (detail.status !== 'read') { status.textContent = `Original artifact unavailable: ${view.scanId}`; return; }
        const url = URL.createObjectURL(new Blob([Uint8Array.from(detail.bytes)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `${view.scanId.replaceAll(':', '-')}.json`; link.click(); URL.revokeObjectURL(url);
      }));
    }
    detail('Scope groups, eligibility and history', result.assessments.map(({ summary, eligibility }) => ({ scanId: summary.scanId, selection: summary.selection, eligibility })));
    detail('How this selection is ordered', 'Only readable, exact-content and equal-requested-scope assessments qualify. Newest creation time wins; equal times use the full Scan ID in ASCII order, not trust or arrival. Future-dated reports remain inspectable but ineligible until the explicit evaluation time. Identity conflicts and refused acquisitions stay in diagnostics.');
    detail('Source checks, refusals and conflicts', { checks: result.checks, failures: result.failures, conflicts: result.conflicts });
  }
  async function check() {
    const current = ++attempt;
    try { const next = await client.request('scan-evidence', { target: target.value, evaluationTime: new Date().toISOString(), policyBytes: undefined, reviewEvidenceIds: undefined,
      ...(suppliedBytes.length ? { reviewEvidence: suppliedBytes.map(bytes => [...bytes]) } : {}), ...(requestedScope ? { selection: requestedScope } : {}) }); if (current !== attempt) return;
      if (next.status !== 'selected' && result?.status === 'selected') { status.textContent = `Check refused; last known view retained. ${JSON.stringify(next.diagnostics)}`; return; }
      result = next; render(); }
    catch (error) { if (current === attempt) status.textContent = `Check failed; last known view retained. ${error.message}`; }
  }
  history.addEventListener('change', () => { historicalId = history.value || undefined; render(); });
  scope.addEventListener('change', () => { requestedScope = JSON.parse(scope.value); check(); });
  target.addEventListener('change', () => { requestedScope = undefined; historicalId = undefined; result = undefined; render(); check(); });
  supplied.addEventListener('change', async () => {
    const loading = ++attempt;
    try {
      const files = [...supplied.files];
      if (files.length > 32 || files.reduce((total, file) => total + file.size, 0) > 750_000) throw new Error('Choose at most 32 documents and 750 KB total.');
      const bytes = await Promise.all(files.map(async file => new Uint8Array(await file.arrayBuffer())));
      if (loading !== attempt) return;
      suppliedBytes = bytes;
      await check();
    } catch (error) { status.textContent = `Evidence not adopted: ${error.message}`; }
  });
  const acquisitionControls = el('div', 'flex flex-wrap items-center gap-2');
  acquisitionControls.append(supplied, button('Check Scan evidence', check));
  const historyControls = el('div', 'flex min-w-0 max-w-full flex-wrap items-center gap-2');
  historyControls.append(history, button('Latest', () => { historicalId = undefined; render(); }));
  panel.append(target, acquisitionControls, scope, historyControls, status, facts);
  document.addEventListener('aih:scan-content', event => {
    if (![...target.options].some(option => option.value === event.detail?.target)) return;
    target.value = event.detail.target;
    target.dispatchEvent(new Event('change'));
  });
  let catalog;
  client.subscribe(() => {
    if (catalog === client.catalog) return; catalog = client.catalog;
    target.replaceChildren(...(catalog?.items ?? []).map(item => new Option(`${item.family} · ${item.id}`, `${item.root.releaseSha256}/${item.id}`)));
    render();
  });
  render();
  return panel;
}

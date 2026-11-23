import { renderEvidenceMap } from './evidence-map.js';
import { action, facts, field, hint, node, section } from './dom.js';

function evidenceSummary(evidence) {
  const assessment = evidence?.assessment ?? evidence?.value?.assessment;
  return assessment?.summary;
}

export function evidenceDetails(evidence, { mapSignal } = {}) {
  const summary = evidenceSummary(evidence);
  if (!summary) return [hint(evidence?.reason ?? 'No recorded assessment available for this item.')];
  const authentication = typeof evidence.authentication === 'string' ? evidence.authentication : evidence.authentication?.status;
  const signer = evidence.verification?.signer;
  const publisher = typeof signer === 'string' ? signer : signer?.identity ?? signer?.subject;
  const output = [facts([
    ['Scan label', summary.label ?? summary.verdict],
    ['Coverage', typeof summary.coverage === 'string' ? summary.coverage : summary.completion],
    ['Artifact authentication', authentication === 'not-verified' ? 'Not verified' : authentication],
    ['Publisher', publisher],
    ['Verification details', evidence.verification?.reason],
    ['Scan date', summary.scannedAt ?? summary.createdAt],
    ['Scanner', summary.scanner ?? summary.producer?.name],
    ['Revision', summary.revision],
  ])];
  const reports = summary.tools ?? summary.providers ?? [];
  if (reports.length) {
    const table = node('table', null, 'ix-evidence-table');
    const heading = node('thead');
    const head = node('tr');
    for (const title of ['Detector', 'Outcome', 'Recorded counts']) head.append(node('th', title));
    heading.append(head);
    const rows = node('tbody');
    for (const report of reports) {
      const tr = node('tr');
      const counts = Object.entries(report.counts ?? {}).map(([severity, count]) => count + ' ' + severity);
      tr.append(node('th', report.tool ?? report.detectorId), node('td', report.result ?? report.outcome), node('td', counts.join(', ') || 'No counts supplied'));
      rows.append(tr);
    }
    table.append(heading, rows);
    output.push(table);
  }
  const assessment = evidence.assessment ?? evidence.value?.assessment;
  const findings = assessment?.findings;
  if (assessment?.findingsStatus === 'partial') output.push(hint('Some recorded SARIF findings could not be read.'));
  if (Array.isArray(findings) && findings.length) {
    if (mapSignal) output.unshift(renderEvidenceMap(findings, mapSignal));
    const list = node('ul', null, 'ix-evidence-files');
    for (const finding of findings) {
      const location = [finding.path ?? finding.file, finding.line ?? finding.startLine].filter(Boolean).join(':');
      const details = node('details');
      const heading = [finding.severity, finding.ruleId ?? finding.rule ?? finding.title, location].filter(Boolean).join(' · ');
      details.append(node('summary', heading || 'Recorded finding'));
      if (finding.message ?? finding.text) details.append(hint(finding.message ?? finding.text));
      const item = node('li');
      item.append(details);
      list.append(item);
    }
    output.push(node('h4', 'Recorded findings'), list);
  }
  if (summary.files?.length) {
    const details = node('details');
    const list = node('ul', null, 'ix-evidence-files');
    const exclusions = new Set((summary.notAnalysed ?? []).map(entry => entry.path));
    for (const file of summary.files) list.append(node('li', file.path + (exclusions.has(file.path) ? ' · not analysed' : '')));
    details.append(node('summary', 'Files in the recorded scope'), list);
    output.push(details);
  }
  return output;
}

export function renderScan(host, api) {
  if (!api.data.repositoryScanAvailable) {
    host.append(section('Repository Scan', hint(api.data.gaps.selfScan ?? 'Repository scanning is unavailable.')));
  }
  const output = section('Scan evidence');
  const select = node('select');
  const options = new Map(api.data.items.map(item => [item.id, item]));
  select.append(new Option('Choose a Catalog item', ''));
  for (const item of options.values()) select.append(new Option(item.title + ' · ' + item.frameworkName, item.id));
  const summary = node('div', null, 'ix-stack');
  summary.setAttribute('aria-live', 'polite');
  let pending = 0;
  let map;
  api.signal.addEventListener('abort', () => map?.abort(), { once: true });
  const inspect = action('Read Scan evidence', async () => {
    const attempt = ++pending;
    map?.abort();
    map = new AbortController();
    const item = options.get(select.value);
    if (!item) return;
    inspect.disabled = true;
    summary.replaceChildren(hint('Reading evidence…'));
    try {
      const { evidence, source } = await api.data.inspectItem(item);
      if (attempt !== pending || api.signal.aborted) return;
      summary.replaceChildren(node('h4', item.title), ...evidenceDetails(evidence, { mapSignal: map.signal }));
      if (source?.status === 'read' && typeof source.text === 'string') {
        const details = node('details');
        details.append(node('summary', 'Published source'), node('pre', source.text));
        summary.append(details);
      }
    } catch (error) {
      if (attempt === pending) summary.replaceChildren(hint(error.message));
    } finally {
      if (attempt === pending) inspect.disabled = !select.value;
    }
  }, true);
  select.addEventListener('change', () => {
    pending++;
    map?.abort();
    inspect.disabled = !select.value;
    summary.replaceChildren();
  });
  inspect.disabled = true;
  output.append(field('Evidence subject', select), inspect, summary);
  if (!options.size) output.append(hint(api.data.gaps.catalog ?? 'No evidence subjects are available.'));
  host.append(output);
}

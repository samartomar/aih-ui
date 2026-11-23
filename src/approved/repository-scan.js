import { renderEvidenceMap } from './evidence-map.js';
import { action, downloadJson, field, fileField, hint, input, node, section } from './dom.js';

const format = 'aih-workbench-repository-scan/1';

function openReport(value) {
  if (value?.format !== format || !Array.isArray(value.results) || value.results.length > 1000 ||
    value.results.some(item => !item || typeof item.name !== 'string' || typeof item.status !== 'string' ||
      (item.findings != null && (!Array.isArray(item.findings) || item.findings.length > 5000 ||
        item.findings.some(finding => !finding || typeof finding !== 'object'))))) {
    throw new Error('Choose a repository Scan export from this Workbench.');
  }
  return value;
}

export function repositoryScan(host, api) {
  const folder = input('', () => {});
  const output = section();
  const status = hint('');
  status.setAttribute('role', 'status');
  let results;
  api.signal.addEventListener('abort', () => results?.abort(), { once: true });

  function show(report, imported) {
    results?.abort();
    results = new AbortController();
    status.textContent = report.results.length + ' items reported' + (report.reason ? ' · ' + report.reason : '');
    output.replaceChildren(node('h3', 'Scan results'));
    if (imported === 'native') output.append(hint('Scan checked the saved summaries and matched the supplied SARIF. Publisher identity is unverified.'));
    else if (imported) output.append(hint('Imported Workbench export · original Scan artifacts were not verified.'));
    for (const item of report.results) {
      const details = node('details');
      details.append(node('summary', item.name + ' · ' + (item.label ?? item.status)));
      if (item.coverage || item.reason) details.append(hint(item.reason || item.coverage + ' coverage'));
      if (item.findings?.length) details.append(renderEvidenceMap(item.findings, results.signal));
      output.append(details);
    }
    output.append(action('Export scan results', () => downloadJson('repository-scan.json', { ...report, format })));
  }

  const submit = action('Scan repository', async () => {
    submit.disabled = true;
    submit.dataset.running = 'true';
    status.textContent = 'Scanning the selected folder…';
    try {
      const response = await fetch('/api/repository-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folder.value.trim() }),
        signal: api.signal,
      });
      const report = await response.json();
      if (api.signal.aborted) return;
      if (!response.ok || !Array.isArray(report.results)) throw new Error(report.reason || 'The scanner could not read this folder.');
      show(report, false);
    } catch (error) {
      if (!api.signal.aborted) status.textContent = error.message;
    } finally {
      delete submit.dataset.running;
      submit.disabled = !folder.value.trim();
    }
  }, true);
  submit.disabled = true;
  folder.addEventListener('input', () => { submit.disabled = !folder.value.trim() || submit.dataset.running === 'true'; });
  const picker = fileField('Open a saved Workbench Scan export', '.json,application/json', async file => {
    if (submit.dataset.running === 'true') throw new Error('Wait for the repository scan to finish before opening an export.');
    if (file.size > 16 * 1024 * 1024) throw new Error('Choose a Workbench Scan export smaller than 16 MB.');
    show(openReport(JSON.parse(await file.text())), true);
  }, message => { status.textContent = message; });
  const native = node('input');
  native.type = 'file';
  native.multiple = true;
  native.accept = '.json,.sarif,application/json';
  native.addEventListener('change', async () => {
    const files = Array.from(native.files);
    native.value = '';
    if (!files.length || submit.dataset.running === 'true') return;
    submit.dataset.running = 'true';
    submit.disabled = true;
    native.disabled = true;
    status.textContent = 'Checking saved Scan evidence…';
    try {
      if (files.reduce((total, file) => total + file.size, 0) > 16 * 1024 * 1024) {
        throw new Error('Choose a Scan archive or files totaling no more than 16 MB.');
      }
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      const documents = await Promise.all(files.map(async file => decoder.decode(await file.arrayBuffer())));
      const response = await fetch('/api/repository-scan-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: documents }), signal: api.signal,
      });
      const report = await response.json();
      if (!response.ok || !Array.isArray(report.results)) throw new Error(report.reason || 'Scan could not read this report.');
      if (!api.signal.aborted) show(report, 'native');
    } catch (error) {
      if (!api.signal.aborted) status.textContent = error.message;
    } finally {
      delete submit.dataset.running;
      submit.disabled = !folder.value.trim();
      native.disabled = false;
    }
  });
  host.append(section('Scan your repository', field('Local repository folder', folder), submit, picker,
    field('Open a Scan summary with SARIF or a Workbench archive', native), status, output));
}

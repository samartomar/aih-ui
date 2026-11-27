import { renderDesignSample, renderWorkbenchOverview } from '../report/render.js';
import { action, download, facts, fileField, hint, link, node, section } from './dom.js';

const themeStyles = Promise.all(['/styles/tokens.css', '/styles/approved-report.css'].map(path =>
  fetch(path).then(response => response.ok ? response.text() : '').catch(() => ''))).then(files => files.join('\n'));
const theme = () => document.documentElement.dataset.workbenchTheme === 'light' ? 'light' : 'dark';

async function themed(html) {
  const styles = await themeStyles;
  return html.replace('<html lang="en">', '<html lang="en" data-v9-report data-theme="' + theme() + '">')
    .replace('</head>', () => '<style>' + styles + '</style></head>');
}

export function renderReports(host, api) {
  const status = hint('Open a Core snapshot to show its saved evidence in the V9 report.');
  status.setAttribute('role', 'status');
  function reportFrame() {
    const element = node('iframe', null, 'ix-v9-frame');
    element.title = 'V9 report snapshot';
    element.setAttribute('sandbox', 'allow-scripts');
    return element;
  }
  let frame = reportFrame();
  let snapshot, saved, assessment, rendering = false, request = 0;
  const overview = () => {
    const data = api.currentData();
    return renderWorkbenchOverview({
      catalog: api.role !== 'enterprise' && data.gaps.catalog && !data.items.length ? null : data.items,
      clients: data.gaps.clients ? null : data.clients,
      tools: data.gaps.tools ? null : data.tools,
      packages: data.packages, assessment,
    }, 'V9 Developer Console');
  };
  let documentHtml = overview();
  let visible = false;
  window.addEventListener('aih-workbench-data', () => {
    if (!visible && !saved && !rendering) show(overview());
  }, { signal: api.signal });

  async function show(html) {
    documentHtml = html;
    const decorated = await themed(html);
    if (documentHtml === html && frame.isConnected) {
      const next = reportFrame();
      next.srcdoc = decorated;
      frame.replaceWith(next);
      frame = next;
    }
    return decorated;
  }

  function updateTheme() {
    if (frame.isConnected) show(documentHtml);
    else viewObserver.disconnect();
  }
  const viewObserver = new MutationObserver(updateTheme);
  viewObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workbench-theme'] });
  api.signal.addEventListener('abort', () => viewObserver.disconnect(), { once: true });
  const showcase = action('View labelled design sample', async () => {
    visible = !visible;
    showcase.textContent = visible ? 'Close design sample' : 'View labelled design sample';
    const html = visible ? renderDesignSample('V9 Developer Console') : saved ?? overview();
    await show(html);
  });
  const save = action('Save HTML', async () => download('workbench-report.html', await themed(saved), 'application/octet-stream'));
  const render = action('Render snapshot', async () => {
    const current = ++request;
    render.disabled = true;
    rendering = true;
    save.hidden = true;
    status.textContent = 'Validating snapshot with Core…';
    try {
      const response = await fetch('/api/report-render?mode=report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await snapshot.text(),
      });
      const result = await response.json();
      if (current !== request) return;
      if (!response.ok || result.status !== 'ok' || typeof result.html !== 'string') {
        throw new Error(result.diagnostics?.map(entry => entry.message).join(' ') || 'The snapshot could not be rendered.');
      }
      saved = result.html;
      visible = false;
      showcase.textContent = 'View labelled design sample';
      await show(saved);
      save.hidden = false;
      status.textContent = 'Saved snapshot · validated by Core ' + result.coreVersion;
    } catch (error) {
      if (current === request) status.textContent = error.message;
    } finally {
      if (current === request) { render.disabled = false; rendering = false; }
    }
  }, true);
  render.disabled = true;
  save.hidden = true;
  const toolbar = node('div', null, 'ix-v9-toolbar');
  const controls = node('details', null, 'ix-v9-file-controls');
  const body = node('div', null, 'ix-v9-file-body');
  body.append(fileField('Core report snapshot', '.json,application/json', file => {
    request++;
    rendering = false;
    snapshot = file;
    render.disabled = false;
    save.hidden = true;
    saved = null;
    visible = false;
    showcase.textContent = 'View labelled design sample';
    show(overview());
    status.textContent = file.name + ' is ready for validation.';
  }, api.status));
  const buttons = node('div', null, 'ix-buttons');
  buttons.append(render, save, showcase, link('Machine checks', api.route('diagnostics')));
  body.append(buttons);
  controls.append(node('summary', 'Report controls'), body);
  toolbar.append(controls);
  status.className = 'ix-hint ix-v9-status';
  host.append(toolbar, status, frame);
  show(documentHtml);
  fetch('/api/approved-assessments', { signal: api.signal })
    .then(response => response.ok ? response.json() : { status: 'unavailable', reason: 'No Catalog Scan assessment endpoint is available on this host.' })
    .then(value => {
      if (api.signal.aborted) return;
      assessment = value;
      if (!visible && !saved && !rendering) show(overview());
    }).catch(() => {
      if (api.signal.aborted) return;
      assessment = { status: 'unavailable', reason: 'The Catalog Scan assessment request failed.' };
      if (!visible && !saved && !rendering) show(overview());
    });
}

// Core leaves the PATH entry number as `?` when it cannot identify it. Show readable text only:
// a string, without that placeholder, and nothing for an object or an empty value.
const readable = value => typeof value === 'string' && /[\p{L}\p{N}]/u.test(value) ? value.trim()
  .replace(/\bPATH entry \?(?= for\b)/g, 'an unnumbered PATH entry').replace(/\bPATH entry \?/g, 'PATH') : null;

export function diagnosticLines(answer) {
  const lines = [...(answer?.observations ?? []).map(row => readable(row?.detail)),
    ...(answer?.diagnostics ?? []).map(row => readable(row?.message) ?? readable(row?.reason))];
  return [...new Set(lines.filter(Boolean))];
}

export function renderDiagnostics(host, api) {
  const result = node('div', null, 'ix-stack');
  result.setAttribute('aria-live', 'polite');
  const inspect = action('Inspect this machine', async () => {
    inspect.disabled = true;
    result.replaceChildren(hint('Running Core inspection…'));
    const answer = await api.data.inspectTools();
    if (api.signal.aborted) return;
    inspect.disabled = false;
    if (answer.state !== 'inspected') {
      result.replaceChildren(hint(answer.reason ?? 'Core inspection is unavailable.'));
      return;
    }
    result.replaceChildren(facts([
      ['Inspection result', answer.status],
      ['Core version', answer.package?.version ?? api.data.packages?.core?.version],
    ]));
    const tools = node('ul');
    for (const tool of answer.tools ?? []) {
      const label = tool.label ?? tool.id;
      const status = tool.state ?? tool.host?.status;
      const selection = tool.selection === 'requested' ? 'requested check' : undefined;
      const version = tool.host?.installedVersion?.version;
      tools.append(node('li', [label, status, selection, version].filter(Boolean).join(' · ')));
    }
    if (tools.childElementCount) result.append(node('h4', 'Tool states'), tools);
    const observations = diagnosticLines(answer);
    if (observations.length) {
      const list = node('ul');
      for (const observation of observations) list.append(node('li', observation));
      result.append(node('h4', 'Observations and diagnostics'), list);
    }
  }, true);
  inspect.disabled = !api.data.inspectTools;
  const scope = api.data.hostMode === 'read-only'
    ? 'Core checks Node and Git offline and reports the tool states it observes.'
    : 'Core reads the available host and tool observations.';
  const machine = section('Machine checks', hint(scope), inspect, result);
  host.append(machine, section('Reports', link('Open a saved V9 snapshot', api.route('reports'))));
  if (api.data.hostMode === 'legacy') {
    fetch('/api/readiness-report', { signal: api.signal }).then(response => {
      if (response.ok && !api.signal.aborted) machine.append(link('Open machine readiness', '/readiness.html'),
        link('Open machine readiness report', '/report.html'));
    }).catch(() => {});
  }
}

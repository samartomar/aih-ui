import { renderDesignSample, renderEmptyReport } from '../report/render.js';
import { action, download, fileField, hint, link, node, section } from './dom.js';

const themeStyles = fetch('/styles/approved-report.css').then(response => response.ok ? response.text() : '').catch(() => '');
const theme = () => document.documentElement.dataset.workbenchTheme === 'light' ? 'light' : 'dark';

async function themed(html) {
  const styles = await themeStyles;
  return html.replace('<html lang="en">', '<html lang="en" data-theme="' + theme() + '">')
    .replace('</head>', () => '<style>' + styles + '</style></head>');
}

export function renderReports(host, api) {
  const status = hint('Open a Core snapshot to show its saved evidence in the V9 report.');
  status.setAttribute('role', 'status');
  const frame = node('iframe', null, 'ix-v9-frame');
  frame.title = 'V9 report snapshot';
  frame.setAttribute('sandbox', 'allow-scripts');
  let snapshot, saved, request = 0;
  let documentHtml = renderEmptyReport('V9 Developer Console');

  async function show(html) {
    documentHtml = html;
    const decorated = await themed(html);
    if (documentHtml === html && frame.isConnected) {
      frame.srcdoc = decorated;
      frame.hidden = false;
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
  let visible = false;
  const showcase = action('View labelled design sample', async () => {
    visible = !visible;
    showcase.textContent = visible ? 'Close design sample' : 'View labelled design sample';
    const html = visible ? renderDesignSample('V9 Developer Console') : saved ?? renderEmptyReport('V9 Developer Console');
    await show(html);
  });
  const save = action('Save HTML', async () => download('workbench-report.html', await themed(saved), 'application/octet-stream'));
  const render = action('Render snapshot', async () => {
    const current = ++request;
    render.disabled = true;
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
      if (current === request) render.disabled = false;
    }
  }, true);
  render.disabled = true;
  save.hidden = true;
  const toolbar = node('div', null, 'ix-v9-toolbar');
  const controls = node('details', null, 'ix-v9-file-controls');
  const body = node('div', null, 'ix-v9-file-body');
  body.append(fileField('Core report snapshot', '.json,application/json', file => {
    request++;
    snapshot = file;
    render.disabled = false;
    save.hidden = true;
    saved = null;
    visible = false;
    showcase.textContent = 'View labelled design sample';
    show(renderEmptyReport('V9 Developer Console'));
    status.textContent = file.name + ' is ready for validation.';
  }, api.status));
  const buttons = node('div', null, 'ix-buttons');
  buttons.append(render, save, showcase, link('Machine readiness report', '/report.html'));
  body.append(buttons);
  controls.append(node('summary', 'Report controls'), body);
  toolbar.append(controls);
  status.className = 'ix-hint ix-v9-status';
  host.append(toolbar, status, frame);
  show(documentHtml);
}

export function renderDiagnostics(host, api) {
  host.append(section('Machine checks', hint('Check local tools and review the observations recorded by Core.'),
    link('Open machine readiness', '/readiness.html')),
    section('Reports', link('Open a saved V9 snapshot', api.route('reports'), 'ix-secondary')));
}

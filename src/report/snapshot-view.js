// The report page's saved-snapshot section. The chosen file goes to the host, which validates it with
// @aihq/core/report and renders it with src/report/render.js, the renderer tools/render-report.mjs uses.
// The page shows the returned document in a sandboxed frame and offers the same bytes to save. Messages
// go in with textContent only.
const $ = id => document.getElementById(id);
let saved = null;

function show(status, html, mode) {
  $('snapshot-status').textContent = status;
  if (saved) URL.revokeObjectURL(saved);
  saved = null;
  const frame = $('snapshot-frame'), link = $('snapshot-save');
  $('snapshot-demo-note').hidden = !(html && mode === 'demo');
  if (!html) {
    frame.hidden = true; frame.removeAttribute('srcdoc'); link.hidden = true; link.removeAttribute('href');
    return;
  }
  frame.srcdoc = html; frame.hidden = false;
  // Download only: an octet-stream blob is saved, never opened as a page in the Workbench origin.
  saved = URL.createObjectURL(new Blob([html], { type: 'application/octet-stream' }));
  link.href = saved; link.download = mode === 'demo' ? 'report-design-sample.html' : 'report.html'; link.hidden = false;
}

async function render() {
  const file = $('snapshot-file').files?.[0];
  const mode = $('snapshot-mode').value === 'demo' ? 'demo' : 'report';
  if (!file) { show('Choose a snapshot file first.', null); return; }
  $('snapshot-render').disabled = true;
  $('snapshot-status').textContent = 'Validating and rendering the snapshot.';
  try {
    const response = await fetch(`/api/report-render?mode=${mode}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text(), cache: 'no-store',
    });
    const payload = await response.json();
    if (response.ok && payload.status === 'ok' && typeof payload.html === 'string') {
      show(mode === 'demo'
        ? `The design sample is shown. Core ${payload.coreVersion} validated the snapshot, but none of its values is drawn.`
        : `Saved snapshot display, validated by Core ${payload.coreVersion}. It is not re-collected or refreshed.`, payload.html, mode);
    } else {
      const reasons = (payload.diagnostics ?? []).map(item => `${item.code}: ${item.message}`).join(' ') || `The host answered ${response.status}.`;
      show(`The snapshot was not rendered. ${reasons}`, null);
    }
  } catch (error) {
    show(`The snapshot could not be rendered: ${error.message}`, null);
  } finally {
    $('snapshot-render').disabled = !$('snapshot-file').files?.length;
  }
}

$('snapshot-file').addEventListener('change', () => {
  $('snapshot-render').disabled = !$('snapshot-file').files?.length;
  show($('snapshot-file').files?.length ? 'Snapshot chosen. Select Render to validate and show it.' : 'No snapshot opened.', null);
});
$('snapshot-render').addEventListener('click', render);

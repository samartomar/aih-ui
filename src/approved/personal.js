import { action, checkbox, facts, field, hint, node, section } from './dom.js';

export function personalPreparation(host, api, items, clients) {
  const session = crypto.randomUUID();
  const target = node('select');
  for (const tool of clients) target.append(new Option(tool.name, tool.id));
  const status = node('div', null, 'ix-stack');
  status.setAttribute('role', 'status');
  const output = node('div', null, 'ix-stack');
  let configured, chosen = false, busy = false;

  async function request(step, body) {
    const response = await fetch('/api/approved-personal' + step, {
      method: 'POST', signal: api.signal,
      headers: { 'content-type': 'application/json', 'x-aih-client': session },
      body: JSON.stringify(body),
    });
    return response.json();
  }
  const refresh = () => { prepare.disabled = busy || !chosen || !target.value || !items.length; };
  const project = checkbox('Use this project folder', false, value => {
    chosen = value;
    output.replaceChildren();
    refresh();
  });
  target.addEventListener('change', () => output.replaceChildren());
  const prepare = action('Prepare selected Catalog files', async () => {
    busy = true;
    refresh();
    target.disabled = true;
    project.querySelector('input').disabled = true;
    output.replaceChildren(hint('Preparing the selected files with Core…'));
    try {
      const result = await request('-prepare', { items: items.map(item => item.id), client: target.value, binding: configured });
      if (api.signal.aborted) return;
      if (result.status !== 'ready' || !result.review?.reviewDigest) {
        output.replaceChildren(hint(result.reason ?? result.status));
        for (const info of result.diagnostics ?? []) output.append(hint(info.message ?? info.code));
        return;
      }
      const digest = result.review.reviewDigest;
      const files = node('ul');
      for (const step of result.review.steps ?? []) {
        files.append(node('li', step.sentence ?? [step.op, step.path].filter(Boolean).join(' ')));
      }
      const details = node('details');
      details.append(node('summary', 'Open the full Core review'), node('pre', JSON.stringify(result.review, null, 2)));
      const apply = action('Apply reviewed project files', async () => {
        apply.disabled = true;
        approval.querySelector('input').disabled = true;
        confirmation.textContent = 'Applying the exact reviewed change…';
        try {
          const outcome = await request('-apply', { id: result.id, reviewDigest: digest, confirmed: true });
          if (outcome.status === 'applied') confirmation.textContent = outcome.fileState === 'match'
            ? 'Core applied the files and verified the file check matches.'
            : outcome.reason ?? 'Core applied the files. File check: ' + (outcome.fileState ?? 'unavailable') + '.';
          else confirmation.textContent = outcome.reason ?? outcome.status;
          for (const info of outcome.diagnostics ?? []) output.append(hint(info.message ?? info.code));
        } catch (error) {
          if (!api.signal.aborted) confirmation.textContent = error.message;
        }
      }, true);
      apply.disabled = true;
      const approval = checkbox('I reviewed this change and approve writing these project files', false, value => { apply.disabled = !value; });
      const confirmation = hint('');
      confirmation.setAttribute('aria-live', 'polite');
      output.replaceChildren(facts([['Project folder', result.project], ['Core review digest', digest]]));
      if (files.childElementCount) output.append(node('h4', 'Core reviewed changes'), files);
      output.append(details, approval, apply, confirmation);
    } catch (error) {
      if (!api.signal.aborted) output.replaceChildren(hint(error.message));
    } finally {
      busy = false;
      refresh();
      target.disabled = false;
      project.querySelector('input').disabled = false;
    }
  }, true);
  const panel = section('Prepare project files',
    hint('Prepare only the selected Catalog files for one CLI. Framework bases, guides, personal files, and Tool Setup are reviewed separately.'),
    status, field('CLI target', target), project, prepare, output);
  if (!items.length || !clients.length) panel.append(hint('Choose available Catalog items and a CLI target before preparing project files.'));
  host.append(panel);
  project.hidden = true;
  refresh();
  fetch('/api/approved-personal', { signal: api.signal }).then(response => response.json()).then(value => {
    if (api.signal.aborted) return;
    if (value.status === 'configured') {
      configured = value.project;
      status.replaceChildren(facts([['Host project folder', configured]]));
      project.hidden = false;
    } else status.replaceChildren(hint(value.reason));
  }).catch(() => {
    if (!api.signal.aborted) status.replaceChildren(hint('The project binding could not be read.'));
  });
}

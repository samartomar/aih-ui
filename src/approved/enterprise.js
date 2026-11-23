import { action, checkbox, facts, field, hint, node, section } from './dom.js';

export function enterprisePreparation(host, api, items, clients) {
  const source = api.published?.source;
  if (!source?.commitSha) {
    host.append(section('Apply organization setup', hint('Read the managed organization policy to prepare project changes.')));
    return;
  }
  const session = crypto.randomUUID();
  const endpoint = '/api/approved-enterprise';
  const target = node('select');
  for (const client of clients) target.append(new Option(client.name, client.id));
  const status = hint('');
  status.setAttribute('role', 'status');
  const projectInfo = node('div');
  const output = node('div', null, 'ix-stack');
  const eligibility = hint('');
  let project, confirmed = false, working = false;
  const files = api.published.selection.allowPersonal ? api.draft.files : [];
  const catalogSelected = items.length === api.draft.items.length && items.length > 0;
  const buttons = node('div', null, 'ix-buttons');

  async function post(path, body) {
    const response = await fetch(endpoint + path, {
      method:'POST', signal:api.signal, headers:{'content-type':'application/json','x-aih-client':session},
      body:JSON.stringify(body),
    });
    return response.json();
  }

  const diagnostics = result => (result.diagnostics ?? []).map(entry => hint(entry.message ?? entry.reason ?? entry.code));
  const confirmation = checkbox('Use this project folder', false, value => {
    confirmed = value;
    reset();
  });
  const projectInput = confirmation.querySelector('input');
  const catalog = action('Prepare Catalog selection', () => prepare(items.map(item => item.id), []), true);
  const personal = action('Prepare personal files', () => prepare([], files));
  const organization = action('Prepare organization files', () => prepare([], [], true));
  buttons.append(catalog);
  if (api.published.selection.files.length) buttons.append(organization);
  if (api.published.selection.allowPersonal) buttons.append(personal);

  function update() {
    const ready = Boolean(project && confirmed && target.value && !working);
    const eligible = api.published.selection;
    const itemUnavailable = target.value && items.some(item => !eligible.itemClients?.[item.id]?.includes(target.value));
    eligibility.textContent = itemUnavailable ? 'One or more selected Catalog items are unavailable for this CLI under the current policy.' : '';
    catalog.disabled = !ready || !catalogSelected || itemUnavailable;
    personal.disabled = !ready || !files.length || !eligible.personalClients?.includes(target.value);
    organization.disabled = !ready || !eligible.files.some(file => file.clients?.includes(target.value));
    target.disabled = working;
    projectInput.disabled = working;
  }

  function reset() {
    status.textContent = '';
    output.replaceChildren();
    update();
  }

  target.addEventListener('change', reset);
  async function prepare(ids, personalFiles, organizationFiles = false) {
    working = true;
    output.replaceChildren();
    status.textContent = '';
    update();
    try {
      const result = await post('-prepare', { items:ids, files:personalFiles, organizationFiles, client:target.value, binding:project, source });
      if (api.signal.aborted) return;
      if (result.status !== 'ready' || !result.review?.reviewDigest) {
        status.textContent = result.reason ?? result.status;
        output.append(...diagnostics(result));
        return;
      }
      const digest = result.review.reviewDigest;
      const summary = node('ul');
      for (const step of result.review.steps ?? []) summary.append(node('li', step.sentence ?? step.path ?? step.op));
      const details = node('details');
      details.append(node('summary', 'Open the full Core review'), node('pre', JSON.stringify(result.review, null, 2)));
      const apply = action('Apply reviewed Enterprise changes', async () => {
        working = true;
        apply.disabled = true;
        approve.querySelector('input').disabled = true;
        update();
        status.textContent = '';
        try {
          const outcome = await post('-apply', {id:result.id,reviewDigest:digest,confirmed:true});
          if (api.signal.aborted) return;
          if (outcome.status === 'applied') status.textContent = outcome.fileState === 'match' ||
            (outcome.members?.length && outcome.members.every(member => member.check === 'present-matching'))
            ? 'Core applied the changes and confirmed the files on disk.'
            : 'Core completed the reviewed change.';
          else status.textContent = outcome.reason ?? outcome.status;
          output.append(...diagnostics(outcome));
        } catch (error) {
          if (!api.signal.aborted) status.textContent = error.message;
        } finally {
          working = false;
          update();
        }
      }, true);
      apply.disabled = true;
      const approve = checkbox('I reviewed and approve these project changes', false, value => { apply.disabled = !value; });
      output.append(facts([
        ['Project folder', result.project],
        ['GitHub commit', result.source.commitSha],
        ['Core review digest', digest],
      ]), summary, details, approve, apply);
      status.textContent = 'Core prepared the changes for your review.';
    } catch (error) {
      if (!api.signal.aborted) status.textContent = error.message;
    } finally {
      working = false;
      update();
    }
  }

  confirmation.hidden = true;
  const panel = section('Apply organization setup',
    hint('Review project changes for one CLI. Catalog content, organization files, and personal files each have their own review.'),
    projectInfo, field('CLI target', target), eligibility, confirmation, buttons, status, output);
  if (!clients.length) panel.append(hint('Choose an allowed CLI target before preparing project changes.'));
  if (api.draft.files.length && !files.length) panel.append(hint('The current organization policy does not admit personal files.'));
  host.append(panel);
  update();
  fetch(endpoint, {signal:api.signal}).then(response => response.json()).then(result => {
    if (api.signal.aborted) return;
    if (result.status === 'configured') {
      project = result.project;
      projectInfo.append(facts([['Host project folder', project]]));
      confirmation.hidden = false;
      update();
    } else status.textContent = result.reason;
  }).catch(() => {
    if (!api.signal.aborted) status.textContent = 'The project binding could not be read.';
  });
}

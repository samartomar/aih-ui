import { action, checkbox, download, facts, hint, link, node } from './dom.js';
import { portableProfile, readTeamProfile } from './profile-model.js';

const gitHub = '/api/enterprise/github';
export const profileLimit = 1024 * 1024;

export async function teamProfileRequest(path, signal, body) {
  const response = await fetch(gitHub + path, {
    signal,
    ...(body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'The GitHub connection is unavailable.'), { recovery: result.recovery });
  return result;
}

export function renderGitHubRecovery(kind, signal, onReceipt) {
  const panel = node('details');
  const output = node('div', null, 'ix-stack');
  const notice = hint('');
  notice.setAttribute('role', 'status');
  const labels = {
    prepared: 'Commit prepared', 'branch-unknown': 'Branch outcome unknown',
    'branch-ready': 'Branch ready', 'branch-changed': 'Branch changed',
    'branch-missing': 'Branch missing', 'pull-request-ready': 'Pull request found',
  };
  async function load() {
    refresh.disabled = true;
    notice.textContent = 'Checking saved proposals…';
    try {
      const result = await teamProfileRequest('/recovery', signal);
      const proposals = result.proposals.filter(proposal => proposal.kind === kind);
      output.replaceChildren(...proposals.map(renderProposal));
      notice.textContent = proposals.length ? '' : 'No saved proposals for this account.';
    } catch (error) {
      if (!signal.aborted) notice.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }
  function renderProposal(proposal) {
    const { target, identity, digest, status, receipt } = proposal;
    const row = node('div', null, 'ix-stack');
    const message = hint('');
    message.setAttribute('role', 'status');
    const resume = action('Resume reviewed proposal', async () => {
      resume.disabled = true;
      try {
        const result = await teamProfileRequest('/propose', signal, { confirmationId: proposal.confirmationId, confirmed: true });
        onReceipt(result.receipt);
        await load();
      } catch (error) {
        if (signal.aborted) return;
        const current = error.recovery;
        if (current && current.status !== status) row.replaceWith(renderProposal(current));
        notice.textContent = error.message;
      } finally {
        resume.disabled = false;
      }
    });
    row.append(facts([
      ['State', labels[status] ?? status], ['GitHub account', identity.login], ['Repository', target.repository],
      ['Base branch', target.baseBranch], ['Base commit', target.baseSha], ['File', target.path], ['SHA-256', digest],
    ]));
    if (proposal.headCommitUrl) row.append(link('Open proposal commit', proposal.headCommitUrl));
    if (status === 'branch-ready' && proposal.branchUrl) row.append(link('Open proposal branch', proposal.branchUrl));
    if (receipt) row.append(action('Show pull request receipt', () => onReceipt(receipt)));
    else if (!['branch-changed', 'branch-missing'].includes(status)) row.append(resume, message);
    return row;
  }
  const refresh = action('Check saved GitHub proposals', load);
  panel.append(node('summary', 'Recover GitHub proposals'), refresh, notice, output);
  panel.addEventListener('toggle', () => { if (panel.open && !refresh.disabled) void load(); });
  return panel;
}

export function publicProfileSource(address) {
  let url;
  try { url = new URL(address); } catch { throw new Error('Enter a GitHub file link pinned to a commit.'); }
  const [, owner, repository, view, revision, ...segments] = url.pathname.split('/');
  if (url.origin !== 'https://github.com' || url.username || url.password ||
    !/^[\w.-]+$/.test(owner ?? '') || !/^[\w.-]+$/.test(repository ?? '') ||
    view !== 'blob' || !/^[0-9a-f]{40}$/i.test(revision ?? '') ||
    !segments.length || segments.some(segment => !segment || !/^[^/\\\x00-\x1f]+$/.test(decodeURIComponent(segment))) ||
    !/\.json$/i.test(decodeURIComponent(segments.at(-1)))) {
    throw new Error('Enter a public github.com Profile JSON file link pinned to a full commit SHA.');
  }
  const path = segments.map(decodeURIComponent).join('/');
  const raw = 'https://raw.githubusercontent.com/' + [owner, repository, revision, ...segments].join('/');
  return { repository: owner + '/' + repository, revision, path, raw };
}

export async function loadPublicProfile(address, signal) {
  const source = publicProfileSource(address);
  const response = await fetch(source.raw, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw new Error('The public Profile could not be read. You can also import its JSON file.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let content = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > profileLimit) throw new Error('Choose a Profile smaller than 1 MB.');
      content += decoder.decode(value, { stream: true });
    }
    return { profile: readTeamProfile(JSON.parse(content + decoder.decode())), source };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function profileText(label, content) {
  const details = node('details');
  details.append(node('summary', label), node('pre', content));
  return details;
}

export function renderProfileSharing(host, { profile, choices, destination, signal, back, publish, onTeamProposal }) {
  const headings = {
    export: 'Preview Profile export',
    public: 'Preview public Profile',
    local: 'Preview Profile for this browser',
    team: 'Preview team Profile',
  };
  const heading = node('h3', headings[destination]);
  heading.tabIndex = -1;
  const inclusion = { files: new Set() };
  const fields = node('fieldset', null, 'ix-section ix-stack');
  fields.append(node('legend', 'Include optional content'));
  for (const [key, label] of [['firstTask', 'First task'], ['instructions', 'Supporting instructions']]) {
    if (!profile[key]) continue;
    fields.append(checkbox('Include ' + label.toLowerCase(), false, checked => {
      inclusion[key] = checked;
      renderPayload();
    }), profileText(label, profile[key]));
  }
  for (const [index, file] of (profile.files ?? []).entries()) {
    fields.append(checkbox('Include ' + file.name, false, checked => {
      if (checked) inclusion.files.add(index);
      else inclusion.files.delete(index);
      renderPayload();
    }), profileText(file.name, file.text));
  }
  const exact = node('pre');
  exact.tabIndex = 0;
  const output = hint('');
  output.setAttribute('role', 'status');
  const confirmation = node('div', null, 'ix-stack');
  const buttons = node('div', null, 'ix-buttons');
  const labels = { export: 'Download Profile', public: 'Download public Profile', local: 'Share in this browser', team: 'Review GitHub destination' };
  let payload, bytes, busy = false, proposalOpened = false, retrying = false;
  const forward = action(labels[destination], async () => {
    if (busy || proposalOpened || retrying || !bytes) return;
    if (destination === 'local') return publish(payload);
    if (destination !== 'team') {
      download('workbench-profile.json', bytes);
      return;
    }
    const reviewedBytes = bytes;
    busy = true;
    forward.disabled = true;
    confirmation.replaceChildren();
    output.textContent = 'Checking the GitHub destination…';
    try {
      const preview = await teamProfileRequest('/preview', signal, { kind: 'profile', content: reviewedBytes });
      if (!host.contains(heading) || bytes !== reviewedBytes) return;
      if (preview.status !== 'ready') throw new Error(preview.error || 'The GitHub destination is unavailable.');
      const account = typeof preview.identity === 'string' ? preview.identity : preview.identity?.login;
      const confirm = action('Open pull request', async () => {
        if (busy || proposalOpened || bytes !== reviewedBytes) return;
        busy = true;
        confirm.disabled = true;
        forward.disabled = true;
        fields.disabled = true;
        output.textContent = 'Opening the pull request…';
        try {
          const { receipt } = await teamProfileRequest('/propose', signal, { confirmationId: preview.confirmationId, confirmed: true });
          if (!host.contains(heading)) return;
          proposalOpened = true;
          confirmation.replaceChildren(link('Open GitHub pull request #' + receipt.number, receipt.url));
          output.textContent = 'Pull request opened. The team can browse this revision after it merges.';
          onTeamProposal(receipt);
        } catch (error) {
          if (!signal.aborted) {
            output.textContent = error.message;
            retrying = !['branch-changed', 'branch-missing'].includes(error.recovery?.status);
            confirm.disabled = !retrying;
            confirm.textContent = 'Retry this pull request';
          }
        } finally {
          busy = false;
          fields.disabled = proposalOpened || retrying;
          forward.disabled = proposalOpened || retrying;
        }
      }, true);
      confirmation.append(facts([
        ['Signed in as', account], ['Organization repository', preview.target.repository],
        ['Base branch', preview.target.baseBranch], ['Base revision', preview.target.baseSha],
        ['Profile file', preview.target.path], ['SHA-256', preview.digest],
      ]), confirm);
      output.textContent = 'Review the destination, then open a pull request for these exact bytes.';
    } catch (error) {
      if (!signal.aborted) output.textContent = error.message;
    } finally {
      busy = false;
      forward.disabled = !bytes;
    }
  }, true);
  buttons.append(action('Back to Profile', back), forward);
  const available = [...choices.items, ...choices.clients];
  const excluded = available.filter(choice => !choice.value);
  const listing = node('ul');
  for (const { id, value } of available) {
    listing.append(node('li', value ? value.title ?? value.name ?? id : id + ' · excluded'));
  }
  host.replaceChildren(heading, hint('This preview starts with Catalog choices and CLI targets. Choose any text or files you intend to share.'),
    facts([['Name', profile.name], ['Description', profile.description || 'None']]),
    ...(excluded.length ? [hint('Unavailable Catalog choices and CLI targets are excluded.')] : []),
    ...(available.length ? [listing] : []),
    ...(fields.children.length > 1 ? [fields] : []),
    ...(destination === 'public' ? [hint('After downloading, upload the reviewed file to a public GitHub repository. Share its file link pinned to the commit that contains it.')] : []),
    node('h4', 'Exact Profile JSON'), exact, buttons, confirmation, output);
  renderPayload();
  heading.focus();

  function renderPayload() {
    confirmation.replaceChildren();
    output.textContent = '';
    bytes = '';
    try {
      payload = portableProfile(profile, choices, inclusion);
      const content = JSON.stringify(payload, null, 2) + '\n';
      if (new TextEncoder().encode(content).byteLength > profileLimit) throw new Error('Remove optional content to keep the Profile under 1 MB.');
      bytes = content;
    } catch (error) {
      output.textContent = error.message;
    }
    exact.textContent = bytes;
    forward.disabled = busy || !bytes;
  }
}

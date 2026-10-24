import { el } from './dom.js';
import { artifactDiff, readArtifact } from './proposal-diff.js';

/** One review surface shared by every catalog page, independent of the policy screen. */
export function createPolicyReview({ client, accept, proposed, status }) {
  const trigger = document.getElementById('review-project-changes');
  const node = el('aside', 'policy-review-panel'); node.id = 'policy-review-panel'; node.hidden = true;
  node.setAttribute('aria-labelledby', 'policy-review-panel-title');
  const title = el('h2', 'font-semibold', 'Review policy changes'); title.id = 'policy-review-panel-title'; title.tabIndex = -1;
  const context = el('p', 'text-on-surface-variant');
  const changes = el('div', 'space-y-2');
  const close = el('button', 'policy-review-close', 'Close'); close.type = 'button';
  const discard = el('button', 'px-3 py-1.5 rounded border border-wb-border', 'Discard proposed changes'); discard.type = 'button'; discard.id = 'policy-discard';
  const actions = el('div', 'flex flex-wrap gap-2'); actions.append(accept, discard);
  actions.id = 'policy-proposal-actions';
  node.append(title, close, context, status, changes, proposed, actions);
  document.body.append(node);
  trigger.setAttribute('aria-controls', node.id); trigger.setAttribute('aria-expanded', 'false');
  const mobile = window.matchMedia('(max-width: 700px)');
  const main = document.getElementById('main-content'), navigation = document.getElementById('nav-rail');
  const header = document.querySelector('body > header');
  const pageContext = document.getElementById('policy-context-disclosure') ?? document.getElementById('policy-current-context');
  const metricStrip = document.getElementById('framework-matrix-tabs');
  const covered = [main, navigation, metricStrip?.closest('details') ?? metricStrip, document.getElementById('catalog-scopes-section')].filter(Boolean);
  const inAllowedSurface = target => node.contains(target) || header?.contains(target) || pageContext?.contains(target);
  function syncOverlay() {
    const modal = !node.hidden && mobile.matches;
    for (const surface of covered) surface.inert = modal;
  }
  function show(open) {
    node.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    if (open) document.dispatchEvent(new CustomEvent('aih:policy-review-open'));
    syncOverlay();
    if (open) { render(); title.focus({ preventScroll: true }); }
  }
  trigger.addEventListener('click', () => show(node.hidden)); close.addEventListener('click', () => { show(false); trigger.focus(); });
  discard.addEventListener('click', () => { client.discard(); status.textContent = 'Proposal discarded. Accepted choices are unchanged.'; title.focus({ preventScroll: true }); });
  accept.addEventListener('click', () => title.focus({ preventScroll: true }));
  document.addEventListener('aih:inspector-open', () => show(false));
  mobile.addEventListener('change', () => {
    if (node.hidden) return;
    syncOverlay();
    if (!node.hidden && mobile.matches && !inAllowedSurface(document.activeElement)) title.focus({ preventScroll: true });
  });
  document.addEventListener('focusin', event => {
    if (!node.hidden && mobile.matches && !inAllowedSurface(event.target) && !document.querySelector('dialog[open]')) title.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (!node.hidden && event.key === 'Escape' && !document.querySelector('dialog[open]')) { show(false); trigger.focus(); return; }
    if (node.hidden || !mobile.matches || event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const surfaces = [header, pageContext, node].filter(Boolean);
    const controls = surfaces.flatMap(surface => [...surface.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')])
      .filter(control => !control.disabled && !control.inert && control.tabIndex >= 0 && control.getClientRects().length && !control.closest('[hidden], [inert]'));
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
    else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  });
  node.addEventListener('keydown', event => { if (event.key === 'Escape') { show(false); trigger.focus(); } });
  function render() {
    const current = client.draft?.roots ?? client.intent?.roots ?? [];
    const next = client.candidate?.roots ?? client.candidate?.intent?.roots;
    context.textContent = `${client.draft ? 'Working draft' : 'Project policy'} · ${current.length} accepted choices${client.dirty ? ' · Changes not downloaded' : ''}${client.startupSource === 'recovery' ? ' · Recovered from this browser session' : ''}${client.recoveryAvailable === false ? ' · Session recovery unavailable: download before leaving.' : ''}`;
    changes.replaceChildren(); actions.hidden = !client.candidate; discard.disabled = !client.candidate; accept.disabled = !client.candidate;
    if (!next) { changes.append(el('p', '', 'No proposed changes. Choose a catalog item to review its exact selection and dependencies.')); return; }
    const key = root => JSON.stringify([root.releaseSha256, root.itemId, root.scope]);
    const prior = new Map(current.map(root => [key(root), root])), after = new Map(next.map(root => [key(root), root]));
    for (const root of current) if (!after.has(key(root))) changes.append(el('p', '', `Remove: ${root.itemId} · ${root.scope}`));
    for (const root of next) {
      const before = prior.get(key(root));
      if (!before) changes.append(el('p', '', `Add: ${root.itemId} · ${root.scope}`));
      else if (JSON.stringify(before.configuration) !== JSON.stringify(root.configuration)) {
        changes.append(el('p', '', `Configure: ${root.itemId}`), el('pre', 'whitespace-pre-wrap break-all', `Before: ${JSON.stringify(before.configuration)}\nAfter: ${JSON.stringify(root.configuration)}`));
      }
    }
    if (!changes.childNodes.length) changes.append(el('p', '', 'Review the proposed metadata, source or optional dependency choices below.'));
    const before = readArtifact(client.draft?.envelopeBytes ?? client.bytes);
    const nextArtifact = readArtifact(client.candidate?.envelopeBytes ?? client.candidate?.policyBytes ?? []);
    const details = el('details', 'space-y-2');
    details.append(el('summary', 'cursor-pointer font-medium', 'Exact artifact changes — configuration, sources and metadata'));
    const diffs = before && nextArtifact ? artifactDiff(before, nextArtifact) : artifactDiff(client.draft?.intent ?? client.intent, client.candidate?.intent);
    for (const diff of diffs) {
      const row = el('div', 'rounded border border-wb-border p-2 space-y-1');
      row.append(el('p', 'font-mono break-all', diff.path),
        el('pre', 'whitespace-pre-wrap break-all', `Before: ${diff.before === undefined ? '(absent)' : JSON.stringify(diff.before, null, 2)}\nAfter: ${diff.after === undefined ? '(absent)' : JSON.stringify(diff.after, null, 2)}`));
      details.append(row);
    }
    if (!diffs.length) details.append(el('p', '', 'No artifact values changed.'));
    changes.append(details);
  }
  client.subscribe(render);
  return { node, open: () => show(true), render };
}

import { el } from './dom.js';
import { artifactDiff, readArtifact } from './proposal-diff.js';
import { setupEntry } from './setup-entry.js';

/**
 * One review surface shared by every catalog page, independent of the policy screen. The header's "Your setup" is
 * its one entry (Review Changes is merged into it): it opens at the pending addition when one waits, otherwise at
 * `setupHeading()` (the Install or Installed heading, when shown). The old Review Changes id stays on a hidden alias
 * that opens the drawer at the top. Back to catalog (which the Close button merged into) closes it and calls `onBack`;
 * Escape still closes it where it was opened from.
 */
export function createPolicyReview({ client, accept, proposed, status, setupHeading = () => null, onBack = () => {} }) {
  const trigger = document.getElementById('review-project-changes');
  const entry = document.getElementById('your-setup');
  let opener = entry ?? trigger;
  const node = el('aside', 'policy-review-panel'); node.id = 'policy-review-panel'; node.hidden = true;
  node.setAttribute('aria-labelledby', 'policy-review-panel-title');
  const title = el('h2', 'font-semibold', 'Your setup'); title.id = 'policy-review-panel-title'; title.tabIndex = -1;
  const context = el('p', 'text-on-surface-variant policy-review-context');
  const changes = el('div', 'space-y-2');
  const back = el('button', 'policy-review-back px-3 py-1.5 rounded border border-wb-border text-on-surface hover:bg-surface-container', 'Back to catalog'); back.type = 'button'; back.id = 'policy-back-to-catalog';
  back.title = 'Close Your setup and return to the catalog to choose more content. Escape also closes it.';
  const discard = el('button', 'px-3 py-1.5 rounded border border-wb-border', 'Cancel'); discard.type = 'button'; discard.id = 'policy-discard';
  const actions = el('div', 'flex flex-wrap gap-2'); actions.append(accept, discard);
  actions.id = 'policy-proposal-actions';
  // Title and Back to catalog share one sticky row (#137).
  const head = el('div', 'policy-review-head flex items-start justify-between gap-2'), heading = el('div', 'min-w-0');
  heading.append(title, context); head.append(heading, back);
  node.append(head, status, changes, proposed, actions);
  document.body.append(node);
  const triggers = [trigger, entry].filter(Boolean);
  for (const control of triggers) { control.setAttribute('aria-controls', node.id); control.setAttribute('aria-expanded', 'false'); }
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
    node.hidden = !open; for (const control of triggers) control.setAttribute('aria-expanded', String(open));
    if (open) document.dispatchEvent(new CustomEvent('aih:policy-review-open'));
    syncOverlay();
    if (open) { render(); title.focus({ preventScroll: true }); }
  }
  const dismiss = () => { show(false); opener.focus(); };
  // The hidden alias has no place on screen, so closing returns focus to Your setup.
  trigger?.addEventListener('click', () => { if (node.hidden) opener = entry ?? trigger; show(node.hidden); });
  // "Your setup" lands on a pending addition, else on Install / Installed; while open it goes back there rather than closing.
  entry?.addEventListener('click', () => { if (node.hidden) { opener = entry; show(true); } if (client.candidate) title.focus({ preventScroll: true }); else atSetup(); });
  back.addEventListener('click', () => { show(false); onBack(); });
  function atSetup() {
    const heading = setupHeading();
    if (!heading) { title.focus({ preventScroll: true }); return; }
    heading.tabIndex = -1; heading.scrollIntoView({ block: 'start' }); heading.focus({ preventScroll: true });
  }
  function syncEntry() {
    if (!entry) return;
    const words = setupEntry(client);
    entry.textContent = words.label; entry.title = words.title; entry.setAttribute('aria-label', words.accessibleName);
  }
  discard.addEventListener('click', () => { client.discard(); status.textContent = 'Cancelled. Your setup is unchanged.'; title.focus({ preventScroll: true }); });
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
    if (!node.hidden && event.key === 'Escape' && !document.querySelector('dialog[open]')) { dismiss(); return; }
    if (node.hidden || !mobile.matches || event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const surfaces = [header, pageContext, node].filter(Boolean);
    const controls = surfaces.flatMap(surface => [...surface.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')])
      .filter(control => !control.disabled && !control.inert && control.tabIndex >= 0 && control.getClientRects().length && !control.closest('[hidden], [inert]'));
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
    else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  });
  node.addEventListener('keydown', event => { if (event.key === 'Escape' && !node.hidden) dismiss(); });
  function render() {
    const current = client.draft?.roots ?? client.intent?.roots ?? [];
    const next = client.candidate?.roots ?? client.candidate?.intent?.roots;
    context.textContent = `${client.draft ? 'Working draft' : 'Setup'} · ${current.length} chosen ${current.length === 1 ? 'item' : 'items'}${client.dirty ? ' · Changes not downloaded' : ''}${client.startupSource === 'recovery' ? ' · Recovered from this browser session' : ''}${client.recoveryAvailable === false ? ' · Session recovery unavailable: download before leaving.' : ''}`;
    changes.replaceChildren(); actions.hidden = !client.candidate; discard.disabled = !client.candidate; accept.disabled = !client.candidate;
    // Only a change waiting to be added shows here; with none, Your choices below says what is in the setup (#137).
    changes.hidden = !next;
    if (!next) { accept.textContent = 'Add to setup'; changes.append(el('p', '', 'Nothing is waiting to be added. Add content from the catalog.')); return; }
    const key = root => JSON.stringify([root.releaseSha256, root.itemId, root.scope]);
    const prior = new Map(current.map(root => [key(root), root])), after = new Map(next.map(root => [key(root), root]));
    // Only additions read "Add to setup"; a removal or a configuration change updates the setup instead.
    const addsOnly = current.every(root => after.has(key(root)) && JSON.stringify(after.get(key(root)).configuration) === JSON.stringify(root.configuration));
    accept.textContent = addsOnly && next.length > current.length ? 'Add to setup' : 'Update setup';
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
    details.append(el('summary', 'cursor-pointer font-medium', 'Exact changes — configuration, sources and metadata'));
    const diffs = before && nextArtifact ? artifactDiff(before, nextArtifact) : artifactDiff(client.draft?.intent ?? client.intent, client.candidate?.intent);
    for (const diff of diffs) {
      const row = el('div', 'rounded border border-wb-border p-2 space-y-1');
      row.append(el('p', 'font-mono break-all', diff.path),
        el('pre', 'whitespace-pre-wrap break-all', `Before: ${diff.before === undefined ? '(absent)' : JSON.stringify(diff.before, null, 2)}\nAfter: ${diff.after === undefined ? '(absent)' : JSON.stringify(diff.after, null, 2)}`));
      details.append(row);
    }
    if (!diffs.length) details.append(el('p', '', 'No saved values changed.'));
    changes.append(details);
  }
  client.subscribe(() => { render(); syncEntry(); });
  syncEntry();
  return { node, open: () => { if (node.hidden) opener = entry ?? trigger; show(true); }, render };
}

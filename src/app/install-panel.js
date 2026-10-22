// One plain install step for the accepted policy: preview the files Core will write into the project,
// then one Install button that prepares again, checks the review is unchanged and applies it. The
// advanced Prepare and Apply buttons stay where they are; this reuses the same host operations.

import { applyIfUnchanged, diagnosticWords, effectsFingerprint, fileCount, installFiles, IN_PLACE } from './host-review.js';

export { relativeTarget } from './host-review.js';

export function projectName(project) {
  return project?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'your project';
}

/**
 * The heading and status line for a preview: files already in place are not counted as changes. Matching bytes
 * do not show that Core manages them, so "installed" is said only when Core lists the whole setup (`managed`).
 */
export function installSummary(rows, { managed = false } = {}) {
  const inPlace = rows.filter(row => row.action === IN_PLACE).length, changed = rows.length - inPlace;
  if (!rows.length) return { heading: 'Nothing to change', message: 'Nothing has been installed yet.' };
  if (!changed) return { heading: `All ${fileCount(rows.length)} are already in place`,
    message: `${managed ? `Already installed: all ${fileCount(rows.length)} are in place.` : `All ${fileCount(rows.length)} are already in place.`} Install checks them again.` };
  return { heading: `${fileCount(changed)} will be changed${inPlace ? ` (${inPlace} already in place)` : ''}`,
    message: inPlace ? `Not fully installed: ${inPlace} of ${fileCount(rows.length)} are already in place.` : 'Nothing has been installed yet.' };
}

/** Skill folders the install writes, so the success message can say what to try. */
export function skillHints(files) {
  const names = files.map(file => /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file.path)?.[1]).filter(Boolean);
  return [...new Set(names)];
}

/** The outcome of an Apply, in words. Only a complete run with every operation applied and verified is a success. */
export function installOutcome(run, files, project) {
  if (!run) return { ok: false, message: 'Install did not return a result. Check the files below before trying again.' };
  // The page moved on after sending Apply; the host may already have written files.
  if (run.status === 'superseded') return { ok: false, message: 'The page changed while Install was running, so it cannot tell whether any files were written. Check what is installed in this project before installing again.' };
  const operations = run.operations ?? [];
  const applied = operations.filter(operation => operation.application === 'applied').length;
  // Core found these files already holding the expected bytes; they are verified like any other.
  const inPlace = operations.filter(operation => operation.application === 'already-satisfied').length;
  const verified = operations.filter(operation => operation.verification?.status === 'passed').length;
  // Every reviewed file must be accounted for, not just the operations the run happened to report.
  const total = Math.max(operations.length, files.length);
  if (run.completion === 'complete' && total && applied + inPlace === total && verified === total) {
    const skills = skillHints(files);
    const tryLine = skills.length ? ` Open Claude Code in this folder and type ${skills.map(name => `/${name}`).join(' or ')}.` : ' Open your AI tool in this folder to use them.';
    const already = inPlace ? ` (${inPlace} ${inPlace === 1 ? 'was' : 'were'} already in place)` : '';
    return { ok: true, message: `Installed ${total} ${total === 1 ? 'file' : 'files'} into ${projectName(project)}${already}.${tryLine}` };
  }
  // Everything was written and every supplied check passed, but Core had no check for some changes (the Catalog declared
  // none, e.g. a marked section merged into AGENTS.md): Core reports them unverified. Named, never called verified.
  const unchecked = operations.filter(operation => operation.verification?.status === 'unverified' && operation.verification?.reason === 'no-supplied-check');
  if (run.completion === 'complete' && total && operations.length === files.length && applied + inPlace === total && unchecked.length && verified + unchecked.length === total) {
    const names = unchecked.map(operation => files[operations.indexOf(operation)]?.path ?? operation.id);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return { ok: false, state: 'unchecked', message: `Installed ${total} ${total === 1 ? 'file' : 'files'} into ${projectName(project)}. ${verified} ${verified === 1 ? 'was' : 'were'} checked; ${list} ${names.length === 1 ? 'was' : 'were'} written but ${names.length === 1 ? 'has' : 'have'} no check from the Catalog, so ${names.length === 1 ? 'it is' : 'they are'} not verified. Open ${names.length === 1 ? 'it' : 'them'} to confirm.` };
  }
  const reason = [...(run.diagnostics ?? [])].map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
  return { ok: false, message: `Install did not finish: ${applied} of ${total} applied,${inPlace ? ` ${inPlace} already in place,` : ''} ${verified} verified.${reason ? ` ${reason}` : ''} Nothing else was changed by this page.` };
}

const readyPreparation = result => { const preparation = result?.preparation ?? result; return preparation?.status === 'ready' && preparation.sessionId && preparation.review ? preparation : undefined; };

function refusal(result) {
  const preparation = result?.preparation ?? result;
  return diagnosticWords(preparation, result) || result?.error || preparation?.status || 'The host did not return a review.';
}

export function createInstallPanel({ client, el, button, onInstalled = () => {} }) {
  const node = el('section', 'p-4 rounded border-2 border-primary space-y-3'); node.id = 'install-panel'; node.hidden = true;
  const title = el('h3', 'text-base font-semibold text-on-surface', 'Install your setup into your project');
  const where = el('p', 'font-mono text-[11px] text-outline break-all');
  const items = el('ul', 'list-disc pl-5 space-y-0.5');
  const filesHeading = el('p', 'font-medium', 'Files that will be added');
  const files = el('ul', 'space-y-0.5 font-mono text-[11px]'); files.id = 'install-files';
  const message = el('p', 'text-on-surface'); message.id = 'install-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const install = button('Install', () => run(), true); install.id = 'install-button'; install.disabled = true;
  node.append(title, where, items, filesHeading, files, install, message);

  let preview, previewing = false, installing = false, shownFor, managed = false, again = false;
  const itemOf = ref => client.catalog?.items.find(item => item.id === ref.itemId && item.root.releaseSha256 === ref.releaseSha256);
  const label = ref => { const item = itemOf(ref); return item ? item.label ?? item.id : ref.itemId; };
  const ready = () => Boolean(client.catalog && client.intent && !client.candidate && !(client.draft && !client.compiled));

  function show(review) {
    const rows = installFiles(review), project = review?.target?.project;
    title.textContent = `Install your setup into ${projectName(project)}`;
    where.textContent = project ?? '';
    filesHeading.textContent = installSummary(rows, { managed }).heading;
    files.replaceChildren(...rows.map(row => el('li', '', `${row.action}  ${row.path}`)));
    return rows;
  }
  async function loadPreview() {
    if (previewing || installing) return;
    previewing = true; preview = undefined; install.disabled = true; message.textContent = 'Checking which files will be added…';
    try {
      const result = await client.requestHost('prepare');
      if (result.status === 'superseded') { message.textContent = ''; return; }
      const preparation = readyPreparation(result);
      if (preparation) {
        preview = preparation; const rows = show(preparation.review);
        install.disabled = false; message.textContent = installSummary(rows, { managed }).message;
      } else { files.replaceChildren(); message.textContent = `Can't install yet: ${refusal(result)}`; }
    } catch (error) { message.textContent = `Can't install yet: ${error.message}`; }
    finally {
      previewing = false;
      // The project folder changed while this preview was out; check the new one.
      if (again) { again = false; shownFor = undefined; render(); }
    }
  }
  async function run() {
    if (!preview || installing) return;
    const shown = effectsFingerprint(preview.review);
    let sent = false;
    installing = true; install.disabled = true; install.setAttribute('aria-busy', 'true'); message.textContent = 'Installing…';
    try {
      // Prepare again so the approval is for what is on disk now; refuse if its effects differ from the list shown.
      // Apply is bound to this fresh review's own digest, exactly as the advanced Apply button does.
      const attemptResult = await applyIfUnchanged({ prepare: () => client.requestHost('prepare'), readyPreparation, shown,
        apply: approval => { sent = true; return client.requestHost('apply', approval); } });
      if (attemptResult.state === 'not-ready') { message.textContent = `Install did not start: ${refusal(attemptResult.result)}`; return; }
      const { preparation } = attemptResult;
      if (attemptResult.state === 'changed') {
        preview = preparation; const rows = show(preparation.review); install.disabled = false;
        message.textContent = `The files changed since this list was shown (${rows.length} now). Check the list and click Install again.`; return;
      }
      const outcome = installOutcome(attemptResult.run, installFiles(preparation.review), preparation.review.target?.project);
      message.textContent = outcome.message; message.dataset.outcome = outcome.ok ? 'installed' : outcome.state ?? 'failed';
      preview = undefined;
    } catch (error) { message.textContent = `Install did not finish: ${error.message}`; message.dataset.outcome = 'failed'; }
    finally { installing = false; install.removeAttribute('aria-busy'); if (sent) onInstalled(); }
  }
  function render() {
    node.hidden = !ready();
    const refs = client.intent?.pins ?? client.intent?.roots ?? [];
    items.replaceChildren(...refs.map(ref => el('li', '', label(ref))));
    if (node.hidden) { shownFor = undefined; preview = undefined; return; }
    // No project folder: there is nothing to preview until one is chosen above.
    if (!client.catalog.executionAvailable) {
      shownFor = undefined; preview = undefined; install.disabled = true; delete message.dataset.outcome;
      title.textContent = 'Install your setup into your project'; where.textContent = ''; filesHeading.textContent = 'Files that will be added'; files.replaceChildren();
      message.textContent = 'Choose a project folder above to install your setup.'; return;
    }
    const key = client.bytes.join(',');
    if (key === shownFor) return;
    shownFor = key; delete message.dataset.outcome; void loadPreview();
  }
  // After a removal elsewhere or a change of project folder: the earlier preview and outcome no longer describe the
  // folder, so they are dropped and it is checked again (once the preview already out has come back).
  function recheck() {
    message.textContent = ''; delete message.dataset.outcome; shownFor = undefined; preview = undefined; install.disabled = true;
    files.replaceChildren(); where.textContent = ''; title.textContent = 'Install your setup into your project';
    if (previewing) { again = true; return; }
    render();
  }
  // Whether Core's managed inventory lists every selection of this setup; read by the installed list.
  function setManaged(value) {
    managed = Boolean(value);
    if (!preview || previewing || installing || message.dataset.outcome) return;
    const rows = installFiles(preview.review), summary = installSummary(rows, { managed });
    filesHeading.textContent = summary.heading; message.textContent = summary.message;
  }
  return { node, heading: title, render, recheck, setManaged, get busy() { return installing; } };
}

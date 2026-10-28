// One plain install step for the accepted policy: preview the files Core will write into the project,
// then one Install button that prepares again, checks the review is unchanged and applies it. The
// advanced Prepare and Apply buttons stay where they are; this reuses the same host operations.

import { applyIfUnchanged, diagnosticWords, fileCount, installFiles, IN_PLACE, listNames, relativeTarget, staleReason } from './host-review.js';

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
  return { heading: `${fileCount(changed)} will change${inPlace ? ` (${inPlace} already in place)` : ''}`,
    message: inPlace ? `Not fully installed: ${inPlace} of ${fileCount(rows.length)} are already in place.` : 'Nothing has been installed yet.' };
}

/**
 * Why Install is not offered for a review (#144), or '' when it is: with nothing chosen, or a review that writes no
 * file, there is nothing for it to change. Files already in place still count: Install checks them again.
 */
export function nothingToInstall({ roots = [], rows = [] }) {
  if (rows.length) return '';
  return roots.length ? 'Nothing to change: your setup writes no files into this project.' : 'Nothing to change yet — add something from the catalog first.';
}

/** Skill folders the install writes, so the success message can say what to try. */
export function skillHints(files) {
  const names = files.map(file => /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file.path)?.[1]).filter(Boolean);
  return [...new Set(names)];
}

/** The outcome of an Apply, in words. Only run result 1.4's own member checks can establish "confirmed on disk". */
export function installOutcome(run, files, project) {
  if (!run) return { ok: false, message: 'Install did not return a result. Check the files below before trying again.' };
  // The page moved on after sending Apply; the host may already have written files.
  if (run.status === 'superseded') return { ok: false, message: 'The page changed while Install was running, so it cannot tell whether any files were written. Check what is installed in this project before installing again.' };
  // Run result 1.4: Core checked each touched member directly on disk. Only a complete run whose every intended
  // write member was written and found present-matching is confirmed; kept, restored, unchecked, absent or
  // present-different members never are, and no other shape of result makes that claim.
  if (Array.isArray(run.members)) {
    const intended = run.members.filter(member => member.intent === 'write');
    const failed = intended.filter(member => member.outcome !== 'written' || member.check !== 'present-matching');
    if (run.completion === 'complete' && intended.length > 0 && failed.length === 0) {
      const skills = skillHints(files);
      const tryLine = skills.length ? ` Open Claude Code in this folder and type ${skills.map(name => `/${name}`).join(' or ')}.` : ' Open your AI tool in this folder to use them.';
      return { ok: true, state: 'confirmed', message: `Confirmed on disk: all ${fileCount(intended.length)} written into ${projectName(project)} checked present-matching.${tryLine}` };
    }
    const words = member => `${relativeTarget(member.path, project)} (${member.outcome === 'written' ? `written, check ${member.check}` : `${member.outcome}, check ${member.check}`})`;
    const reason = [...(run.diagnostics ?? [])].map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
    return { ok: false, state: run.completion === 'complete' ? 'failed' : 'partial',
      message: `Install is not confirmed on disk${run.completion === 'complete' ? '' : ` (run ${run.completion})`}: ${listNames(failed.length ? failed.map(words) : ['no intended file was written'])}.${reason ? ` ${reason}` : ''} Check what is installed in this project before installing again.` };
  }
  // No run-result 1.4 member projection: the page cannot claim installed-and-checked, whatever the operations say.
  const reason = [...(run.diagnostics ?? [])].map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
  return { ok: false, message: `Install did not finish${reason ? `: ${reason}` : '. Nothing else was changed by this page.'} Check what is installed in this project before installing again.` };
}

const readyPreparation = result => { const preparation = result?.preparation ?? result; return preparation?.status === 'ready' && preparation.sessionId && preparation.review ? preparation : undefined; };

function refusal(result) {
  const preparation = result?.preparation ?? result;
  return diagnosticWords(preparation, result) || result?.error || preparation?.status || 'The host did not return a review.';
}

export function createInstallPanel({ client, el, button, onInstalled = () => {} }) {
  const node = el('section', 'p-3 rounded border-2 border-primary space-y-2'); node.id = 'install-panel'; node.hidden = true;
  const title = el('h3', 'text-sm font-semibold text-on-surface', 'Install your setup into your project');
  const where = el('p', 'font-mono text-[11px] text-outline break-all'); where.id = 'install-where';
  const items = el('ul', 'list-disc pl-5 space-y-0.5'); items.id = 'install-items';
  const filesHeading = el('span', 'font-medium', 'What will be installed'); filesHeading.id = 'install-summary';
  const files = el('ul', 'space-y-0.5 font-mono text-[11px]'); files.id = 'install-files';
  const message = el('p', 'wb-status-area text-on-surface'); message.id = 'install-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const install = button('Install', () => run(), true); install.id = 'install-button'; install.disabled = true;
  // A disabled Install says why in the status line beside it.
  install.setAttribute('aria-describedby', message.id);
  // One button and "N files will change", which opens what will be installed and every file (#137).
  const details = el('details', 'install-details text-on-surface-variant'); details.id = 'install-details';
  const detailsSummary = el('summary', 'cursor-pointer'); detailsSummary.append(filesHeading);
  details.append(detailsSummary, where, items, files);
  const action = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1'); action.append(install, details);
  node.append(title, action, message);

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
        const reason = nothingToInstall({ roots: client.intent?.roots ?? [], rows });
        install.disabled = Boolean(reason); message.textContent = reason || installSummary(rows, { managed }).message;
        install.title = reason || 'Install your setup into this project folder.';
      } else { files.replaceChildren(); filesHeading.textContent = 'What will be installed'; message.textContent = `Can't install yet: ${refusal(result)}`; }
    } catch (error) { message.textContent = `Can't install yet: ${error.message}`; }
    finally {
      previewing = false;
      // The project folder changed while this preview was out; check the new one.
      if (again) { again = false; shownFor = undefined; render(); }
    }
  }
  async function run() {
    if (!preview || installing || install.disabled) return;
    let sent = false;
    installing = true; install.disabled = true; install.setAttribute('aria-busy', 'true'); message.textContent = 'Installing…';
    try {
      // Prepare again so the approval is for what is on disk now; Apply is bound to this fresh review's own
      // digest. What is stale is Core's call: a REVIEW_STALE diagnostic shows its reason and asks to prepare again.
      const attemptResult = await applyIfUnchanged({ prepare: () => client.requestHost('prepare'), readyPreparation,
        apply: approval => { sent = true; return client.requestHost('apply', approval); } });
      if (attemptResult.state === 'not-ready') { message.textContent = `Install did not start: ${refusal(attemptResult.result)}`; return; }
      const { preparation } = attemptResult;
      if (attemptResult.state === 'stale') {
        preview = preparation; const rows = show(preparation.review); install.disabled = Boolean(nothingToInstall({ roots: client.intent?.roots ?? [], rows }));
        message.textContent = `The reviewed setup changed: ${attemptResult.reason} The list now shows what would happen — check it and click Install again.`; return;
      }
      const outcome = installOutcome(attemptResult.run, installFiles(preparation.review), preparation.review.target?.project);
      message.textContent = outcome.message; message.dataset.outcome = outcome.ok ? 'installed' : outcome.state ?? 'failed';
      // The count said what would change; once written, the same list is what was installed.
      if (outcome.ok) filesHeading.textContent = 'What was installed';
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
      title.textContent = 'Install your setup into your project'; where.textContent = ''; filesHeading.textContent = 'What will be installed'; files.replaceChildren();
      message.textContent = 'Choose a project folder above to install your setup.'; return;
    }
    const key = client.bytes.join(',');
    if (key === shownFor) return;
    // Nothing chosen: there is nothing to prepare, and Install says so (#144).
    if (!client.intent.roots.length) {
      shownFor = key; preview = undefined; install.disabled = true; delete message.dataset.outcome;
      title.textContent = 'Install your setup into your project'; filesHeading.textContent = installSummary([]).heading; files.replaceChildren();
      message.textContent = install.title = nothingToInstall({ roots: [], rows: [] }); return;
    }
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
    filesHeading.textContent = summary.heading; message.textContent = nothingToInstall({ roots: client.intent?.roots ?? [], rows }) || summary.message;
  }
  return { node, heading: title, render, recheck, setManaged, get busy() { return installing; } };
}

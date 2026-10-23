// One plain install step for the accepted policy: preview the files Core will write into the project,
// then one Install button that prepares again, checks the review is unchanged and applies it. The
// advanced Prepare and Apply buttons stay where they are; this reuses the same host operations.

const effectVerb ={ 'create-file': 'Add', 'replace-file': 'Replace', 'update-file': 'Update', 'remove-file': 'Remove' };

export function relativeTarget(target, project) {
  if (!target) return '';
  const lower = target.toLowerCase(), base = project?.toLowerCase();
  const inside = base && lower.startsWith(base) ? target.slice(project.length).replace(/^[\\/]+/, '') : target;
  return inside.replace(/\\/g, '/');
}

export function projectName(project) {
  return project?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'your project';
}

/** Readable rows for every operation in a prepared review. */
export function installFiles(review) {
  const project = review?.target?.project;
  return (review?.operations ?? []).map(operation => ({
    action: effectVerb[operation.effects] ?? operation.purpose ?? operation.kind,
    path: relativeTarget(operation.details?.target, project) || operation.purpose || operation.id,
  }));
}

/**
 * What the person agreed to: each operation's kind, effect, target and expected content. Core's
 * review digest differs on every Prepare even for identical effects, so it cannot be compared across two.
 */
export function effectsFingerprint(review) {
  return JSON.stringify((review?.operations ?? []).map(operation => [operation.kind, operation.effects, operation.details?.target ?? null,
    (operation.checks ?? []).map(check => check.details?.content ?? null)]));
}

/** Skill folders the install writes, so the success message can say what to try. */
export function skillHints(files) {
  const names = files.map(file => /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file.path)?.[1]).filter(Boolean);
  return [...new Set(names)];
}

/** The outcome of an Apply, in words. Only a complete run with every operation applied and verified is a success. */
export function installOutcome(run, files, project) {
  if (!run || run.status === 'superseded') return { ok: false, message: 'Install was interrupted by a newer change. Nothing is reported as installed; check the files below and try again.' };
  const operations = run.operations ?? [];
  const applied = operations.filter(operation => operation.application === 'applied').length;
  const verified = operations.filter(operation => operation.verification?.status === 'passed').length;
  if (run.completion === 'complete' && operations.length && applied === operations.length && verified === operations.length) {
    const skills = skillHints(files);
    const tryLine = skills.length ? ` Open Claude Code in this folder and type ${skills.map(name => `/${name}`).join(' or ')}.` : ' Open your AI tool in this folder to use them.';
    return { ok: true, message: `Installed ${applied} ${applied === 1 ? 'file' : 'files'} into ${projectName(project)}.${tryLine}` };
  }
  const reason = [...(run.diagnostics ?? [])].map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean).join(' ');
  return { ok: false, message: `Install did not finish: ${applied} of ${operations.length} applied, ${verified} verified.${reason ? ` ${reason}` : ''} Nothing else was changed by this page.` };
}

function refusal(result) {
  const preparation = result?.preparation ?? result;
  const reasons = [...(preparation?.diagnostics ?? []), ...(result?.diagnostics ?? [])].map(diagnostic => diagnostic.message ?? diagnostic.code).filter(Boolean);
  return [...new Set(reasons)].join(' ') || result?.error || preparation?.status || 'The host did not return a review.';
}

export function createInstallPanel({ client, el, button }) {
  const node = el('section', 'p-4 rounded border-2 border-primary space-y-3'); node.id = 'install-panel'; node.hidden = true;
  const title = el('h3', 'text-base font-semibold text-on-surface', 'Install these items into your project');
  const where = el('p', 'font-mono text-[11px] text-outline break-all');
  const items = el('ul', 'list-disc pl-5 space-y-0.5');
  const filesHeading = el('p', 'font-medium', 'Files that will be added');
  const files = el('ul', 'space-y-0.5 font-mono text-[11px]'); files.id = 'install-files';
  const message = el('p', 'text-on-surface'); message.id = 'install-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const install = button('Install', () => run(), true); install.id = 'install-button'; install.disabled = true;
  node.append(title, where, items, filesHeading, files, install, message);

  let preview, previewing = false, installing = false, shownFor;
  const itemOf = ref => client.catalog?.items.find(item => item.id === ref.itemId && item.root.releaseSha256 === ref.releaseSha256);
  const label = ref => { const item = itemOf(ref); return item ? item.label ?? item.id : ref.itemId; };
  const available = () => Boolean(client.catalog?.executionAvailable && client.intent && !client.candidate && !(client.draft && !client.compiled));

  function show(review) {
    const rows = installFiles(review), project = review?.target?.project;
    title.textContent = `Install these items into ${projectName(project)}`;
    where.textContent = project ?? '';
    filesHeading.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'file' : 'files'} will be changed` : 'Nothing to change';
    files.replaceChildren(...rows.map(row => el('li', '', `${row.action}  ${row.path}`)));
    return rows;
  }
  async function loadPreview() {
    if (previewing || installing) return;
    previewing = true; preview = undefined; install.disabled = true; message.textContent = 'Checking which files will be added…';
    try {
      const result = await client.requestHost('prepare');
      if (result.status === 'superseded') { message.textContent = ''; return; }
      const preparation = result.preparation ?? result;
      if (preparation.status === 'ready' && preparation.sessionId && preparation.review) {
        preview = preparation; show(preparation.review);
        install.disabled = false; message.textContent = 'Nothing has been installed yet.';
      } else { files.replaceChildren(); message.textContent = `Can't install yet: ${refusal(result)}`; }
    } catch (error) { message.textContent = `Can't install yet: ${error.message}`; }
    finally { previewing = false; }
  }
  async function run() {
    if (!preview || installing) return;
    const shown = effectsFingerprint(preview.review);
    installing = true; install.disabled = true; install.setAttribute('aria-busy', 'true'); message.textContent = 'Installing…';
    try {
      // Prepare again so the approval is for what is on disk now; refuse if its effects differ from the list shown.
      const fresh = await client.requestHost('prepare');
      const preparation = fresh.preparation ?? fresh;
      if (preparation.status !== 'ready' || !preparation.sessionId) { message.textContent = `Install did not start: ${refusal(fresh)}`; return; }
      if (effectsFingerprint(preparation.review) !== shown) {
        preview = preparation; const rows = show(preparation.review); install.disabled = false;
        message.textContent = `The files changed since this list was shown (${rows.length} now). Check the list and click Install again.`; return;
      }
      // Apply is bound to this fresh review's own digest, exactly as the advanced Apply button does.
      const applied = await client.requestHost('apply', { sessionId: preparation.sessionId, reviewDigest: preparation.review.reviewDigest });
      const outcome = installOutcome(applied, installFiles(preparation.review), preparation.review.target?.project);
      message.textContent = outcome.message; message.dataset.outcome = outcome.ok ? 'installed' : 'failed';
      preview = undefined;
    } catch (error) { message.textContent = `Install did not finish: ${error.message}`; message.dataset.outcome = 'failed'; }
    finally { installing = false; install.removeAttribute('aria-busy'); }
  }
  function render() {
    node.hidden = !available();
    const refs = client.intent?.pins ?? client.intent?.roots ?? [];
    items.replaceChildren(...refs.map(ref => el('li', '', label(ref))));
    if (node.hidden) { shownFor = undefined; preview = undefined; return; }
    const key = client.bytes.join(',');
    if (key === shownFor) return;
    shownFor = key; delete message.dataset.outcome; void loadPreview();
  }
  return { node, render };
}

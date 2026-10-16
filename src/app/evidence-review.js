import { el } from './dom.js';

const reasonText = {
  'subject-not-selected': 'the reviewed item is no longer selected',
  'subject-changed': 'the reviewed item itself changed',
  'evidence-changed': 'the supplied evidence no longer contains the recorded finding and evidence',
  'evidence-not-supplied': 'no matching evidence was supplied',
  'source-unavailable': "the reviewed item's exact source is not available here",
};
const applicabilityText = judgment => ({
  applies: 'Applies to the supplied evidence',
  changed: `Applicability changed since this judgment — kept as recorded, bound to its original evidence (${reasonText[judgment.applicabilityReason] ?? judgment.applicabilityReason})`,
  unverified: `Applicability not checked — ${reasonText[judgment.applicabilityReason] ?? judgment.applicabilityReason}`,
  'reconsideration-requested': 'Reconsideration requested',
})[judgment.applicability] ?? judgment.applicability;
const originText = judgment => judgment.origin === 'recipient' ? 'Your decision'
  : `Imported — recorded by ${judgment.owner.kind} ${judgment.owner.id}; not counted as your decision`;

// Human evidence decisions remain distinct from producer authentication and
// organization authority. The existing headless contracts own every binding.
export function createEvidenceReview(client, onProposal) {
  const panel = el('details', 'p-4 border border-wb-border rounded bg-surface-container-lowest space-y-2');
  panel.append(el('summary', 'cursor-pointer font-medium', 'Evidence review and reconsideration'));
  panel.append(el('p', 'text-on-surface-variant', 'Optional: supply exact evidence bytes, inspect their subject binding, and record a portable human review. A checked binding does not authenticate a producer or authorize execution.'));
  panel.append(el('p', 'text-on-surface-variant', 'Recording a new judgment is optional; changed evidence never blocks editing.'));
  const form = el('div', 'space-y-2'), status = el('p', 'text-on-surface-variant'); status.setAttribute('role', 'status');
  const file = el('input'); file.type = 'file'; file.multiple = true; file.setAttribute('aria-label', 'Review evidence files');
  const evidence = el('select', 'bg-wb-input border border-wb-border rounded p-1'); evidence.setAttribute('aria-label', 'Evidence document');
  const target = el('select', 'bg-wb-input border border-wb-border rounded p-1'); target.setAttribute('aria-label', 'Evidence review subject');
  const finding = el('select', 'bg-wb-input border border-wb-border rounded p-1'); finding.setAttribute('aria-label', 'Checked finding');
  const controls = el('div', 'flex flex-wrap gap-2'); form.append(file, evidence, target, controls, status, finding);
  let inspected, revision = 0;
  const action = (label, callback) => {
    const node = el('button', 'px-3 py-1.5 rounded bg-surface-container border border-wb-border', label); node.type = 'button';
    node.addEventListener('click', async () => { try { await callback(); } catch (error) { status.textContent = error.message; } }); return node;
  };
  const invalidate = () => { revision++; inspected = undefined; record.disabled = true; finding.replaceChildren(); };
  const subject = () => { const [releaseSha256, itemId] = target.value.split('/'); return { releaseSha256, itemId }; };
  const details = el('details'); details.append(el('summary', 'cursor-pointer text-outline', 'Checked evidence diagnostics'));
  const diagnostic = el('pre', 'whitespace-pre-wrap break-all text-[10px]'); details.append(diagnostic);
  controls.append(action('Inspect evidence', async () => {
    invalidate(); const attempt = revision;
    const result = await client.request('inspect-review', { evidenceIndex: Number(evidence.value), target: subject() });
    if (attempt !== revision) return;
    diagnostic.textContent = JSON.stringify(result, null, 2);
    if (result.status !== 'ok') { status.textContent = result.diagnostics?.map(value => value.message).join(' ') ?? result.status; return; }
    inspected = { ...result.value, target: subject() };
    status.textContent = `${inspected.bindings.length} findings bound to the checked subject. Producer authentication is separate; inspect diagnostics for authentication and report support.`;
    for (const [index, binding] of inspected.bindings.entries()) finding.append(new Option(`${binding.finding.detectorId} · ${binding.finding.ruleId} · ${binding.finding.findingId}`, index));
    record.disabled = !inspected.bindings.length;
  }), action('Forget supplied evidence', async () => { invalidate(); file.value = ''; evidence.replaceChildren(); client.setReviewEvidence([]); if (await refresh()) status.textContent = 'Supplied evidence forgotten. Saved review history remains in the original artifact.'; }),
  action('Reconsider saved reviews (optional)', async () => onProposal(await client.proposeRequest('reconsider-reviews'))));
  // Applicability is derived from the supplied evidence and identity, so either change re-reads the saved judgments.
  const refresh = async () => {
    const result = await client.refreshJudgments();
    if (result.status === 'superseded') return false;
    if (result.status === 'refused') { status.textContent = result.diagnostics?.map(value => value.message).join(' ') ?? result.status; return false; }
    return true;
  };
  const inputs = {};
  for (const [key, label, value] of [['id', 'Review decision ID', ''], ['owner', 'Review owner', ''], ['actor', 'Reviewer', ''], ['reason', 'Review reason', '']]) {
    const field = el('input', 'bg-wb-input border border-wb-border rounded p-1'); field.setAttribute('aria-label', label); field.placeholder = label; field.value = value; inputs[key] = field; form.append(field);
  }
  const ownerKind = el('select', 'bg-wb-input border border-wb-border rounded p-1'); ownerKind.setAttribute('aria-label', 'Review owner kind');
  for (const value of ['individual', 'organization']) ownerKind.append(new Option(value, value));
  const disposition = el('select', 'bg-wb-input border border-wb-border rounded p-1'); disposition.setAttribute('aria-label', 'Review disposition');
  for (const value of ['false-alarm', 'accepted-risk']) disposition.append(new Option(value, value));
  const record = action('Propose human review', async () => {
    const binding = inspected?.bindings[Number(finding.value)]; if (!binding) return;
    const decision = { id: inputs.id.value, owner: { kind: ownerKind.value, id: inputs.owner.value }, actor: inputs.actor.value, recordedAt: new Date().toISOString(), disposition: disposition.value, reason: inputs.reason.value };
    onProposal(await client.proposeRequest('record-review', { evidenceIndex: Number(evidence.value), target: inspected.target, finding: binding.finding, decision }));
  }); record.disabled = true;
  form.append(ownerKind, disposition, record, details); panel.append(form);
  const as = el('div', 'flex flex-wrap gap-2 items-center'), asKind = el('select', 'bg-wb-input border border-wb-border rounded p-1'), asId = el('input', 'bg-wb-input border border-wb-border rounded p-1');
  asKind.setAttribute('aria-label', 'Your reviewer kind'); asId.setAttribute('aria-label', 'Your reviewer identity'); asId.placeholder = 'Reviewing as (identity)';
  for (const value of ['individual', 'organization']) asKind.append(new Option(value, value));
  // Only labels saved judgments as yours or imported; it never changes what is recorded.
  as.append(el('span', 'text-on-surface-variant', 'Reviewing as'), asKind, asId, action('Use identity', async () => {
    const id = asId.value.trim();
    client.setRecipient(id ? { kind: asKind.value, id } : undefined);
    if (!await refresh()) return;
    status.textContent = id ? `Saved judgments are labelled for ${asKind.value} ${id}.` : 'No identity set: every saved judgment is shown as imported.';
  }));
  panel.append(as);
  const summary = el('p', 'font-medium text-on-surface'); summary.id = 'review-judgments-summary'; panel.append(summary);
  const history = el('ul', 'space-y-2 text-on-surface-variant'); history.id = 'review-judgments'; panel.append(history);
  file.addEventListener('change', async () => {
    invalidate(); const attempt = revision;
    try {
      const files = [...file.files];
      if (files.length > 32 || files.reduce((total, file) => total + file.size, 0) > 750_000) throw new Error('Choose up to 32 evidence documents with 750 KB total bytes. Use the headless reader for larger bounded artifacts.');
      const loaded = await Promise.all(files.map(async file => new Uint8Array(await file.arrayBuffer())));
      if (attempt !== revision) return;
      client.setReviewEvidence(loaded); evidence.replaceChildren(...files.map((file, index) => new Option(file.name, index)));
      if (await refresh()) status.textContent = 'Original evidence bytes loaded. Saved judgments show their applicability to it; inspect for the selected policy subject to record a new one.';
    } catch (error) { status.textContent = error.message; }
  });
  for (const node of [evidence, target]) node.addEventListener('change', invalidate);
  client.subscribe(() => {
    invalidate(); const selected = target.value; target.replaceChildren();
    for (const pin of client.intent?.pins ?? []) target.append(new Option(pin.itemId, `${pin.releaseSha256}/${pin.itemId}`));
    if ([...target.options].some(option => option.value === selected)) target.value = selected;
    history.replaceChildren();
    const judgments = client.reviewJudgments;
    for (const judgment of judgments) {
      const row = el('li', 'border border-wb-border rounded p-2 space-y-1'); row.dataset.applicability = judgment.applicability; row.dataset.origin = judgment.origin; row.dataset.recordId = judgment.recordId;
      row.append(el('p', 'font-medium text-on-surface', `${judgment.recordId}: ${judgment.disposition} · ${judgment.subject.itemId} · ${judgment.state}`),
        el('p', '', `Recorded by ${judgment.actor} for ${judgment.owner.kind} ${judgment.owner.id} at ${judgment.recordedAt}`),
        el('p', '', `Reason: ${judgment.reason}`), el('p', '', applicabilityText(judgment)), el('p', judgment.origin === 'recipient' ? 'text-primary' : 'text-outline', originText(judgment)));
      history.append(row);
    }
    const counts = client.reviewSummary;
    summary.textContent = judgments.length && counts ? `${counts.recipientDecisions} of your decisions; ${counts.importedDecisions} imported (not counted as yours)` : '';
    if (!judgments.length) history.append(el('li', '', 'No human review decisions recorded. Supply evidence to review a pinned selection.'));
  });
  document.querySelector('#policy-workspace > .p-4').append(panel);
}

import { takeDraftHandoff, recoverDraftSession, saveDraftSession } from './draft-session.js';
// Mirrors JOURNEY_SCHEMA_PREFIX and the byte bounds in tools/consumer/journey.mjs, the source of truth; the page cannot import it.
const JOURNEY_PREFIX = 'urn:aihq:workbench:journey-envelope:';
const IMPORT_LIMITS = { policy: 1_000_000, envelope: 2_000_000 };
/** True when the bytes are a journey envelope (any version) rather than an execution policy. */
export function isJourneyEnvelope(bytes) {
  try {
    const schema = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))?.schema;
    return typeof schema === 'string' && schema.startsWith(JOURNEY_PREFIX);
  } catch { return false; }
}
/** Why a file of `size` bytes may not be imported, or undefined. Pass the bytes once they are read to apply the policy bound. */
export function importLimitError(size, bytes) {
  if (size > IMPORT_LIMITS.envelope) return 'File exceeds the public byte limit: 1 MB for a policy, 2 MB for a journey envelope.';
  if (bytes && size > IMPORT_LIMITS.policy && !isJourneyEnvelope(bytes)) return 'Policy exceeds the public byte limit of 1 MB.';
  return undefined;
}
// Pending owner approval as contract amendment 3.2.3 row 18.
export const ENTERPRISE_SETUP_NOTICE = "These choices were made outside your organisation's policy. Start a new Enterprise setup to install them under it.";
const refusal = (code, message) => ({ status: 'refused', diagnostics: [{ code, message }] });
const APPLY_POLL_MS = 1000, APPLY_LOST_POLLS = 60;
const applyUnknown = message => ({ status: 'unknown', diagnostics: [{ code: 'APPLY_UNKNOWN', message }] });
const asDraft = ({ originalBytes: _kept, ...value }) => ({ ...value,
  envelopeBytes: Uint8Array.from(value.envelopeBytes), savedIntentBytes: Uint8Array.from(value.savedIntentBytes) });

// One ephemeral page identity shared by catalog, inspector and policy workspace.
// Neither the identity nor folder grants are persisted in saved policy bytes.
// `bytes` is always a policy: the imported or original one, or the compiled one.
// An open draft is separate state and never becomes the executable policy itself.
export function createAuthoringClient({ sessionRecovery = true } = {}) {
  const headers = { 'x-aih-client': crypto.randomUUID() };
  const listeners = new Set();
  let catalog, bytes = new Uint8Array(), intent, candidate, draftValue, compiled, revision = 0, catalogRevision = 0, hostRevision = 0, folderRevision = 0, reviewEvidence = [], evidenceRevision = 0, recipient, judgments = [], judgmentSummary;
  let dirty = false, checkpoint, recoveryAvailable, startupSource, selectedTool, selectedToolLabel;
  // The saved setup's execution mode: an Enterprise Developer's setup is an Enterprise policy, so the host applies and
  // re-checks the organisation source for it. New policies start in it; `ready` settles once start-up and any mode change are done.
  let setupMode, ready = Promise.resolve(), modeChanges = 0, modeFailure;
  const policyMode = () => { try { return JSON.parse(new TextDecoder().decode(bytes)).mode; } catch { return undefined; } };
  // An Enterprise setup whose open policy is not an Enterprise policy: the organisation source would not be applied,
  // so nothing is proposed, prepared or installed from it until a new Enterprise setup is started.
  const outsideOrganisation = () => setupMode === 'enterprise' && policyMode() !== 'enterprise';
  const refuseOutside = () => refusal('ENTERPRISE_SETUP_REQUIRED', ENTERPRISE_SETUP_NOTICE);
  const HOST_WRITES = new Set(['prepare', 'finish', 'apply']);
  // The header's canonical tool as ephemeral page context: it rides composing/editing/compiling requests,
  // never the saved policy bytes, and never rebinding a recorded selection's own tool identity. The header
  // hands over the registry entry; requests carry its canonical id string (Core's selectTool names ids only).
  // Tool changes participate in every surface's snapshot (Q6-R2): subscribers (drawer host facts,
  // catalog re-read) must see the new tool, so setTool notifies like any other identity change.
  const setTool = tool => { selectedTool = typeof tool === 'string' ? tool : tool?.id ?? null; selectedToolLabel = typeof tool === 'string' ? null : tool?.label ?? null; notify(); };
  const artifactBytes = () => draftValue?.envelopeBytes ?? bytes;
  const notify = () => {
    const current = artifactBytes();
    if (checkpoint && (current.length !== checkpoint.length || current.some((byte, index) => byte !== checkpoint[index]))) dirty = true;
    if (current.length) { checkpoint = current.slice(); if (sessionRecovery) recoveryAvailable = saveDraftSession(current, dirty); }
    for (const listener of listeners) listener();
  };
  let reviewEvidenceIds = [];
  // Saved judgments are a derived display of the latest read, publish or accept; they never gate editing.
  const keepJudgments = value => { judgments = value?.reviewJudgments ?? []; judgmentSummary = value?.reviewSummary; };
  // Choices are recorded strictly one after another, each from the envelope the previous one produced.
  // `artifact` changes whenever a different policy or draft is opened, so a queued choice never reaches it.
  let recording, artifact = 0;
  // What a maintenance or improvement check or record reads: the open draft's envelope, else the ordinary policy that is open.
  const maintenanceInput = () => draftValue ? { envelopeBytes: [...draftValue.envelopeBytes] } : intent ? { bytes: [...bytes] } : undefined;
  async function request(operation, body = {}) {
    if (operation === 'apply') return applyInBackground(body);
    return send(operation, body);
  }
  async function send(operation, body) {
    const response = await fetch(`/api/authoring-${operation}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ policyBytes: [...bytes], reviewEvidence: reviewEvidence.map(value => [...value]), ...(reviewEvidenceIds.length ? { reviewEvidenceIds } : {}), ...(recipient ? { recipient } : {}), ...(selectedTool ? { tool: selectedTool } : {}), ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? JSON.stringify(result));
    return result;
  }
  // Apply runs as a host job (a large setup takes Core minutes, beyond what one request may wait). The page asks for its
  // result until Core has returned one, so what it reports is what Core returned. A host that no longer holds the job, or
  // one the page cannot reach for APPLY_LOST_POLLS polls in a row, is an unknown outcome, never a failure or a success.
  async function applyInBackground(body) {
    const started = await send('apply', { ...body, background: true });
    // Refused before Core started (or an older host that answers at once): that answer is the result.
    if (started?.status !== 'running' || typeof started.applyId !== 'string') return started;
    for (let lost = 0; ;) {
      await new Promise(done => setTimeout(done, APPLY_POLL_MS));
      const result = await fetch('/api/authoring-apply-status', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ applyId: started.applyId }) }).then(response => response.ok ? response.json() : undefined).catch(() => undefined);
      if (!result) { if (++lost >= APPLY_LOST_POLLS) return applyUnknown('This page lost contact with the Workbench while Install was running.'); continue; }
      lost = 0;
      if (result.status !== 'running') return result;
    }
  }
  // Adopts an opened draft: the policy becomes its original bytes, never the envelope.
  // Draft requests carry the envelope alone: it already holds the saved policy bytes, and sending them
  // twice would count against the request body bound for a large envelope.
  async function openAttempt(attempt, input) {
    const result = await request('draft-open', { bytes: [...input], policyBytes: undefined });
    if (attempt !== revision) return { status: 'superseded' };
    if (result.status === 'ok') { draftValue = { ...asDraft(result.value), fromPolicy: !isJourneyEnvelope(input) }; bytes = draftValue.savedIntentBytes.slice(); intent = undefined; compiled = undefined; keepJudgments(result.value); }
    notify(); return result;
  }
  function recordChoice(endpoint, operation, message, extraBody = {}) {
    const target = artifact;
    const run = async () => {
      if (target !== artifact) return { status: 'superseded' };
      const input = maintenanceInput(), current = draftValue;
      if (!input) return refusal('INPUT_INVALID', message);
      const attempt = ++revision; candidate = undefined; notify();
      let result;
      try { result = await request(endpoint, { ...input, operation, ...extraBody, policyBytes: undefined }); }
      catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') {
        revision++;
        draftValue = result.value.draft ? { ...asDraft(result.value.draft), fromPolicy: false }
          : asDraft({ ...current, ...result.value, savedIntentBytes: current.savedIntentBytes });
        compiled = undefined; intent = undefined; bytes = draftValue.savedIntentBytes.slice(); keepJudgments(result.value.draft ?? draftValue);
      }
      notify(); return result;
    };
    const next = recording ? recording.then(run, run) : run();
    const settled = next.then(() => {}, () => {}).then(() => { if (recording === settled) recording = undefined; });
    recording = settled;
    return next;
  }
  // Workspace inspection and export read the same artifact as improvement checks, without adopting it.
  async function workspaceRequest(endpoint, body = {}) {
    const input = maintenanceInput();
    if (!input) return refusal('INPUT_INVALID', 'Open a draft or a saved policy before working with a workspace.');
    const attempt = revision;
    try {
      const result = await request(endpoint, { ...input, ...body, policyBytes: undefined });
      return attempt === revision ? result : { status: 'superseded' };
    } catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
  }
  return {
    get dirty() { return dirty; }, get recoveryAvailable() { return recoveryAvailable; }, get startupSource() { return startupSource; },
    get folderRevision() { return folderRevision; },
    setTool, get tool() { return selectedTool; }, get toolLabel() { return selectedToolLabel; },
    markDownloaded(downloaded = bytes) { const current = artifactBytes(); if (current.length !== downloaded.length || current.some((byte, index) => byte !== downloaded[index])) return; dirty = false; checkpoint = current.slice(); notify(); },
    discard() { revision++; candidate = undefined; notify(); },
    get catalog() { return catalog; }, get intent() { return intent; },
    get bytes() { return bytes.slice(); }, get candidate() { return candidate; },
    get revision() { return revision; },
    get draft() { return draftValue; }, get compiled() { return compiled; },
    get reviewJudgments() { return judgments; }, get reviewSummary() { return judgmentSummary; }, get recipient() { return recipient; },
    invalidate() { revision++; candidate = undefined; notify(); return revision; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request,
    // Host results still out (an Install preview, an installed list) were for the previous project folder; they come back superseded.
    discardHostWork() { hostRevision++; folderRevision++; notify(); },
    async requestHost(operation, body = {}) {
      if (HOST_WRITES.has(operation) && outsideOrganisation()) return refuseOutside();
      const attempt = ++hostRevision, draft = revision, folder = folderRevision;
      const result = await request(operation, body);
      return attempt === hostRevision && draft === revision && folder === folderRevision ? result : { status: 'superseded' };
    },
    // A read of the current project folder (the installed list): superseded only by a folder change, so it never supersedes Install.
    async requestCurrent(operation, body = {}) {
      const folder = folderRevision, result = await request(operation, body);
      return folder === folderRevision ? result : { status: 'superseded' };
    },
    setReviewEvidence(values) { revision++; evidenceRevision++; candidate = undefined; reviewEvidenceIds = []; reviewEvidence = values.map(value => value.slice()); notify(); },
    setConfiguredReviewEvidence(scanId) { revision++; evidenceRevision++; candidate = undefined; reviewEvidence = []; reviewEvidenceIds = [scanId]; notify(); },
    get reviewEvidenceCount() { return reviewEvidence.length + reviewEvidenceIds.length; }, get evidenceRevision() { return evidenceRevision; },
    // Each exact item's state against the supplied evidence, read by the host through Scan; it changes nothing.
    evidenceStates(subjects) { return request('evidence-states', { subjects, policyBytes: undefined }); },
    // Only labels saved judgments as yours or imported; it never changes what is recorded.
    setRecipient(value) { revision++; candidate = undefined; recipient = value ? { kind: value.kind, id: value.id } : undefined; notify(); },
    async loadCatalog({ expectedRevision } = {}) {
      const attempt = ++catalogRevision;
      const response = await fetch('/api/authoring-catalog', { headers });
      if (!response.ok) throw new Error(`Installed catalog unavailable (${response.status}).`);
      const value = await response.json();
      if (attempt !== catalogRevision || (expectedRevision !== undefined && expectedRevision !== revision)) return undefined;
      catalog = value; notify(); return catalog;
    },
    start() { const run = this.startNow(); ready = run.then(() => {}, () => {}); return run; },
    // A policy with nothing chosen yet is remade in the setup's mode; recorded or pending choices are never moved.
    // Choices made meanwhile wait for it, so none lands on the policy it replaces.
    setMode(mode) {
      if (mode !== 'vibe' && mode !== 'enterprise') return ready;
      setupMode = mode; modeChanges++;
      ready = ready.then(async () => {
        if (setupMode !== mode || draftValue || candidate || !intent || intent.roots?.length || policyMode() === mode) return;
        await this.startSetupPolicy();
      }).catch(() => {}).finally(() => { modeChanges--; notify(); });
      return ready;
    },
    // True while the setup is Enterprise but the open policy is not, outside a mode change still in progress.
    get modeMismatch() { return !modeChanges && outsideOrganisation(); },
    // The last refused or failed request for a new policy in the setup's mode, until one succeeds.
    get modeFailure() { return modeFailure; },
    // A new, empty policy in the setup's mode. The previous policy's choices are not carried over.
    async startSetupPolicy() {
      let result;
      try { result = await this.newDraft(setupMode); }
      catch (error) { result = refusal('SOURCE_UNAVAILABLE', error?.message ?? String(error)); }
      if (result.status === 'ok') { modeFailure = undefined; dirty = false; }
      else if (result.status !== 'superseded') modeFailure = result;
      notify(); return result;
    },
    async startNow() {
      await this.loadCatalog();
      const handoff = sessionRecovery ? takeDraftHandoff() : undefined, recovery = sessionRecovery && !handoff ? recoverDraftSession() : undefined;
      if (handoff || recovery) {
        const input = handoff ?? recovery.bytes;
        if (!importLimitError(input.length, input)) {
          this.importBytes(input); dirty = handoff ? true : recovery.dirty;
          await this.reopen(); startupSource = handoff ? 'handoff' : 'recovery'; notify(); return;
        }
      }
      const result = await this.newDraft();
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
      dirty = false; notify();
    },
    async newDraft(mode = setupMode) {
      // A new policy is a different artifact from the moment it is requested, so queued choices stop here.
      artifact++;
      const attempt = this.invalidate(), result = await request('new', { mode });
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') this.publish(result.value);
      return result;
    },
    publish(value) {
      artifact++; revision++; candidate = undefined; draftValue = undefined; compiled = undefined;
      bytes = Uint8Array.from(value.policyBytes); intent = value.intent; keepJudgments(value); notify();
    },
    importBytes(value) { artifact++; revision++; bytes = value.slice(); dirty = false; checkpoint = bytes.slice(); intent = undefined; keepJudgments(); candidate = undefined; draftValue = undefined; compiled = undefined; notify(); },
    // While a draft is open every edit goes through the draft operations: the recorded
    // choices are never composed as an executable policy until an explicit compile.
    async propose(operation) { if (modeChanges) await ready; if (outsideOrganisation()) return refuseOutside(); return draftValue ? this.proposeDraft(operation) : this.proposeRequest('edit', { operation }); },
    async proposeDraft(operation) {
      if (outsideOrganisation()) return refuseOutside();
      if (!draftValue) return refusal('INPUT_INVALID', 'Open a draft before editing it.');
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request('draft-edit', { envelopeBytes: [...draftValue.envelopeBytes], operation, policyBytes: undefined });
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') candidate = asDraft(result.value);
      notify(); return result;
    },
    async openDraft(input = bytes) {
      artifact++;
      const attempt = ++revision; candidate = undefined; notify();
      return openAttempt(attempt, input);
    },
    async checkMaintenance(categories) {
      const input = maintenanceInput();
      if (!input) return refusal('INPUT_INVALID', 'Open a draft or a saved policy before checking available updates.');
      const attempt = revision;
      try {
        const result = await request('maintenance-check', { ...input, categories, policyBytes: undefined });
        return attempt === revision ? result : { status: 'superseded' };
      } catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
    },
    // Also records the note of a successful check. A choice on an ordinary policy turns it into a saved draft.
    recordDisposition(operation) {
      return recordChoice('maintenance-record', operation, 'Open a draft or a saved policy before recording an update choice.');
    },
    async checkImprovements({ clients = [], labels, goal } = {}) {
      const input = maintenanceInput();
      if (!input) return refusal('INPUT_INVALID', 'Open a draft or a saved policy before checking improvements.');
      const attempt = revision;
      try {
        const result = await request('improvements-check', { ...input, clients, labels, goal, policyBytes: undefined });
        return attempt === revision ? result : { status: 'superseded' };
      } catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
    },
    async readTrials() {
      const input = maintenanceInput();
      if (!input) return refusal('INPUT_INVALID', 'Open a draft or a saved policy before reading trials.');
      const attempt = revision;
      try {
        const result = await request('trials-read', { ...input, policyBytes: undefined });
        return attempt === revision ? result : { status: 'superseded' };
      } catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
    },
    recordTrial(operation) {
      return recordChoice('trials-record', operation, 'Open a draft or a saved policy before recording a trial.');
    },
    recordImprovement(operation) {
      return recordChoice('improvements-record', operation, 'Open a draft or a saved policy before recording an improvement choice.');
    },
    // The one-server MCP approval (#162), guarded like a recorded choice: serialized with other recordings,
    // artifact/revision-guarded so a late reply returns superseded and is never adopted. The ordinary edit
    // endpoint carries mcp-approval for a plain policy; an open draft takes the draft-edit route, whose
    // mcp-approval branch recomposes the draft's LIVE intent (its pending choices, not the stale saved
    // base) and rewrites the envelope with every recorded choice preserved — the draft is never replaced
    // by its saved base, compiled away, or discarded.
    recordApproval(operation, message = 'Open a draft or a saved policy before recording the approval.') {
      const target = artifact;
      const run = async () => {
        if (target !== artifact) return { status: 'superseded' };
        if (!bytes.length && !draftValue) return refusal('INPUT_INVALID', message);
        const attempt = ++revision; candidate = undefined; notify();
        let result;
        // The edit contract reads body.policyBytes, which request() supplies from the open artifact;
        // body.bytes is not the service contract, and policyBytes is only suppressed for draft envelopes.
        try { result = await request(draftValue ? 'draft-edit' : 'edit', { ...(draftValue ? { envelopeBytes: [...draftValue.envelopeBytes], policyBytes: undefined } : {}), operation }); }
        catch (error) { if (attempt !== revision) return { status: 'superseded' }; throw error; }
        if (attempt !== revision) return { status: 'superseded' };
        if (result.status === 'ok') {
          revision++;
          if (draftValue) {
            draftValue = { ...asDraft(result.value), fromPolicy: false };
            compiled = undefined; intent = undefined;
            bytes = draftValue.savedIntentBytes.slice();
            keepJudgments(draftValue);
          } else {
            draftValue = undefined; compiled = undefined;
            bytes = Uint8Array.from(result.value.policyBytes); intent = result.value.intent;
            keepJudgments(result.value);
          }
          notify();
        }
        return result;
      };
      const next = recording ? recording.then(run, run) : run();
      const settled = next.then(() => {}, () => {}).then(() => { if (recording === settled) recording = undefined; });
      recording = settled;
      return next;
    },
    readWorkspace() { return workspaceRequest('workspace-read'); },
    planBinding({ memberId, root, replaces } = {}) { return workspaceRequest('workspace-plan', { memberId, root, replaces }); },
    verifyWorkspace() { return workspaceRequest('workspace-verify'); },
    exportWorkspace() { return workspaceRequest('workspace-export'); },
    editWorkspace(operation) {
      return recordChoice('workspace-edit', operation, 'Open a draft or a saved policy before declaring a workspace.');
    },
    bindCheckout({ memberId, root, replaces, confirmation } = {}) {
      return recordChoice('workspace-bind', undefined, 'Open a draft or a saved policy before binding a checkout.', { memberId, root, replaces, confirmation });
    },
    unbindCheckout(bindingId) {
      return recordChoice('workspace-unbind', undefined, 'Open a draft or a saved policy before removing a binding.', { bindingId });
    },
    async compileDraft(roots) {
      if (!draftValue) return refusal('INPUT_INVALID', 'Open a draft before compiling it.');
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request('draft-compile', { envelopeBytes: [...draftValue.envelopeBytes], policyBytes: undefined, ...(roots ? { roots } : {}) });
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') {
        bytes = Uint8Array.from(result.value.policyBytes); intent = result.value.intent;
        compiled = { scope: result.value.scope, whole: result.value.scope.length === draftValue.intent.roots.length };
        keepJudgments(result.value);
      }
      notify(); return result;
    },
    async proposeRequest(operation, body = {}) {
      if (modeChanges) await ready;
      if (outsideOrganisation()) return refuseOutside();
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request(operation, body);
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') candidate = result.value;
      notify(); return result;
    },
    accept() {
      if (!candidate) return;
      // A choice proposed before the setup became Enterprise stays pending; it is not added to a non-Enterprise policy.
      if (outsideOrganisation()) return refuseOutside();
      if (!candidate.envelopeBytes) return this.publish(candidate);
      revision++; draftValue = candidate; candidate = undefined; compiled = undefined; intent = undefined; keepJudgments(draftValue);
      bytes = draftValue.savedIntentBytes.slice(); notify();
    },
    // Re-derives saved judgments for the current evidence and identity without touching the
    // policy, draft or compiled bytes; a compiled policy is read as itself.
    async refreshJudgments() {
      const attempt = revision, result = draftValue && !intent
        ? await request('draft-open', { bytes: [...draftValue.envelopeBytes], policyBytes: undefined }) : bytes.length ? await request('read') : undefined;
      if (!result) return { status: 'ok' };
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') { keepJudgments(result.value); notify(); }
      return result;
    },
    // An edited draft or imported envelope revalidates itself, so edits are never replaced by the
    // original policy. An untouched draft of a plain policy is just that policy: it revalidates as
    // one, and becomes ordinary editing again once every recorded source resolves.
    async reopen() {
      const attempt = ++revision; candidate = undefined;
      if (draftValue && !(draftValue.fromPolicy && draftValue.projection.revision.sequence === 1)) { notify(); return openAttempt(attempt, draftValue.envelopeBytes); }
      if (draftValue) { bytes = draftValue.savedIntentBytes.slice(); draftValue = undefined; compiled = undefined; }
      intent = undefined; notify();
      if (isJourneyEnvelope(bytes)) return openAttempt(attempt, bytes);
      const result = await request('read');
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok' && result.value.editing === 'unresolved') return openAttempt(attempt, bytes);
      if (result.status === 'ok') keepJudgments(result.value);
      if (result.status === 'ok' && result.value.editing === 'available') intent = result.value.intent;
      notify(); return result;
    },
  };
}

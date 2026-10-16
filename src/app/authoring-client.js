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
const refusal = (code, message) => ({ status: 'refused', diagnostics: [{ code, message }] });
const asDraft = ({ originalBytes: _kept, ...value }) => ({ ...value,
  envelopeBytes: Uint8Array.from(value.envelopeBytes), savedIntentBytes: Uint8Array.from(value.savedIntentBytes) });

// One ephemeral page identity shared by catalog, inspector and policy workspace.
// Neither the identity nor folder grants are persisted in saved policy bytes.
// `bytes` is always a policy: the imported or original one, or the compiled one.
// An open draft is separate state and never becomes the executable policy itself.
export function createAuthoringClient() {
  const headers = { 'x-aih-client': crypto.randomUUID() };
  const listeners = new Set();
  let catalog, bytes = new Uint8Array(), intent, candidate, draftValue, compiled, revision = 0, catalogRevision = 0, hostRevision = 0, reviewEvidence = [], recipient, judgments = [], judgmentSummary;
  const notify = () => { for (const listener of listeners) listener(); };
  // Saved judgments are a derived display of the latest read, publish or accept; they never gate editing.
  const keepJudgments = value => { judgments = value?.reviewJudgments ?? []; judgmentSummary = value?.reviewSummary; };
  async function request(operation, body = {}) {
    const response = await fetch(`/api/authoring-${operation}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ policyBytes: [...bytes], reviewEvidence: reviewEvidence.map(value => [...value]), ...(recipient ? { recipient } : {}), ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? JSON.stringify(result));
    return result;
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
  return {
    get catalog() { return catalog; }, get intent() { return intent; },
    get bytes() { return bytes.slice(); }, get candidate() { return candidate; },
    get revision() { return revision; },
    get draft() { return draftValue; }, get compiled() { return compiled; },
    get reviewJudgments() { return judgments; }, get reviewSummary() { return judgmentSummary; }, get recipient() { return recipient; },
    invalidate() { revision++; candidate = undefined; notify(); return revision; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request,
    async requestHost(operation, body = {}) {
      const attempt = ++hostRevision, draft = revision;
      const result = await request(operation, body);
      return attempt === hostRevision && draft === revision ? result : { status: 'superseded' };
    },
    setReviewEvidence(values) { revision++; candidate = undefined; reviewEvidence = values.map(value => value.slice()); notify(); },
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
    async start() {
      await this.loadCatalog();
      const result = await this.newDraft();
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
    },
    async newDraft(mode) {
      const attempt = this.invalidate(), result = await request('new', { mode });
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') this.publish(result.value);
      return result;
    },
    publish(value) {
      revision++; candidate = undefined; draftValue = undefined; compiled = undefined;
      bytes = Uint8Array.from(value.policyBytes); intent = value.intent; keepJudgments(value); notify();
    },
    importBytes(value) { revision++; bytes = value.slice(); intent = undefined; keepJudgments(); candidate = undefined; draftValue = undefined; compiled = undefined; notify(); },
    // While a draft is open every edit goes through the draft operations: the recorded
    // choices are never composed as an executable policy until an explicit compile.
    async propose(operation) { return draftValue ? this.proposeDraft(operation) : this.proposeRequest('edit', { operation }); },
    async proposeDraft(operation) {
      if (!draftValue) return refusal('INPUT_INVALID', 'Open a draft before editing it.');
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request('draft-edit', { envelopeBytes: [...draftValue.envelopeBytes], operation, policyBytes: undefined });
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') candidate = asDraft(result.value);
      notify(); return result;
    },
    async openDraft(input = bytes) {
      const attempt = ++revision; candidate = undefined; notify();
      return openAttempt(attempt, input);
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
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request(operation, body);
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') candidate = result.value;
      notify(); return result;
    },
    accept() {
      if (!candidate) return;
      if (!candidate.envelopeBytes) return this.publish(candidate);
      revision++; draftValue = candidate; candidate = undefined; compiled = undefined; intent = undefined; keepJudgments(draftValue);
      bytes = draftValue.savedIntentBytes.slice(); notify();
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

// One ephemeral page identity shared by catalog, inspector and policy workspace.
// Neither the identity nor folder grants are persisted in saved policy bytes.
export function createAuthoringClient() {
  const headers = { 'x-aih-client': crypto.randomUUID() };
  const listeners = new Set();
  let catalog, bytes = new Uint8Array(), intent, candidate, revision = 0, catalogRevision = 0, hostRevision = 0, reviewEvidence = [];
  const notify = () => { for (const listener of listeners) listener(); };
  async function request(operation, body = {}) {
    const response = await fetch(`/api/authoring-${operation}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ policyBytes: [...bytes], reviewEvidence: reviewEvidence.map(value => [...value]), ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? JSON.stringify(result));
    return result;
  }
  return {
    get catalog() { return catalog; }, get intent() { return intent; },
    get bytes() { return bytes.slice(); }, get candidate() { return candidate; },
    get revision() { return revision; },
    invalidate() { revision++; candidate = undefined; notify(); return revision; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request,
    async requestHost(operation, body = {}) {
      const attempt = ++hostRevision, draft = revision;
      const result = await request(operation, body);
      return attempt === hostRevision && draft === revision ? result : { status: 'superseded' };
    },
    setReviewEvidence(values) { revision++; candidate = undefined; reviewEvidence = values.map(value => value.slice()); notify(); },
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
      revision++; candidate = undefined;
      bytes = Uint8Array.from(value.policyBytes); intent = value.intent; notify();
    },
    importBytes(value) { revision++; bytes = value.slice(); intent = undefined; candidate = undefined; notify(); },
    async propose(operation) { return this.proposeRequest('edit', { operation }); },
    async proposeRequest(operation, body = {}) {
      const attempt = ++revision; candidate = undefined; notify();
      const result = await request(operation, body);
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok') candidate = result.value;
      notify(); return result;
    },
    accept() { if (candidate) this.publish(candidate); },
    async reopen() {
      const attempt = ++revision; candidate = undefined; intent = undefined; notify();
      const result = await request('read');
      if (attempt !== revision) return { status: 'superseded' };
      if (result.status === 'ok' && result.value.editing === 'available') intent = result.value.intent;
      notify(); return result;
    },
  };
}

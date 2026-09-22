/*
 * The Governance workflow.
 *
 * One vertical slice through the Core contract:
 *
 *   catalog selection -> inspect published information -> import evidence ->
 *   operator decision/target/effect -> prepare through Core -> save exact bytes
 *   -> reopen -> consume independently -> display six separate statuses.
 *
 * This file holds the workflow state and nothing else. It holds no policy,
 * digest or compile logic: every derivation happens in @aihq/core behind
 * /api/*, and the components only render what came back.
 *
 * It never manufactures a decision, an approval, verifier trust or a signing
 * key. The one exception is the explicitly labelled validation fixture, which
 * has to be asked for by name and which says what it is everywhere it appears.
 *
 * ONE RULE RUNS THROUGH THE WHOLE FILE: a verdict is only ever shown for the
 * inputs the session actually holds. Files are read asynchronously and requests
 * answer in any order, so every input change takes a revision token first
 * (revisions.js), and an answer that arrives for a token that is no longer
 * current changes nothing at all - no state, no session id, no render. The
 * previous verdict is cleared the moment any verification input changes, and
 * Consume is offered only when nothing is in flight and every input the
 * operator supplied is stored for the revision it is on now.
 */

import { governanceElements } from "./elements.js";
import { createDetector } from "./detector.js";
import { createInputs } from "./inputs.js";
import { createObservation } from "./observation.js";
import { createOperatorFiles } from "./operator-files.js";
import { createPrepared } from "./prepared.js";
import { createReopen } from "./reopen.js";
import { createRevisionTracker } from "./revisions.js";
import { createStatuses } from "./statuses.js";
import { createVerdict } from "./verdict.js";
import { bytesToBase64, downloadBase64 } from "./bytes.js";
import {
  consume,
  fetchCatalogIntegrity,
  fetchSaved,
  fetchSubject,
  loadValidationFixture,
  parseEvidence,
  prepare,
  reopenFromFiles,
  storeObservation,
  storeOperatorFile,
} from "./transport.js";

/** No manifest, no root, no folder: what a session starts with. */
function noObservation() {
  return { manifest: null, installRoot: "", files: null, stored: null };
}

/**
 * The relative path a folder selection carried, without the selected folder's
 * own name: the operator picked that folder BECAUSE it is the install root, so
 * its name is the root, not part of the paths inside it.
 *
 * This reads the browser's own record of what was selected. Nothing is derived
 * from any file's contents, and the backend validates every path it is given.
 */
function relativePathOf(file) {
  const parts = String(file.webkitRelativePath ?? "").split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("/") : file.name;
}

export function createGovernance() {
  const elements = governanceElements();
  const state = {
    entry: null,
    subject: null,
    // Catalog's own answer about Catalog's own bytes. It arrives separately
    // from the Core-derived identity and is never folded into it.
    catalog: null,
    evidenceBase64: null,
    evidenceFacts: null,
    sessionId: null,
    prepared: null,
    fixture: null,
    bindingClaim: null,
    // What the operator supplied themselves, by kind. Never generated.
    operatorFiles: {},
    // The operator's own installation location and the files that are there,
    // plus what the backend reported storing. Optional: without it Core simply
    // reports that no observation was made.
    observation: noObservation(),
    reopened: null,
  };

  // Which input every answer belongs to. Nothing is applied under a token this
  // tracker no longer calls current.
  const revisions = createRevisionTracker();
  // How many verification inputs are between the operator changing them and
  // their answer being applied or discarded. While any is in flight the session
  // does not hold what the pane shows, so there is nothing consistent to
  // consume.
  let inFlight = 0;

  // Uploads that may OPEN the session run one after another, so the first
  // response's session id is what every later upload is sent to. Once the
  // session exists there is nothing left to serialize: each upload carries the
  // revision its input is on, the page applies only the newest answer, and the
  // session refuses to store anything older for that input.
  let uploadChain = Promise.resolve();
  const enqueueUpload = (work) => {
    const next = uploadChain.then(work, work);
    uploadChain = next.catch(() => undefined);
    return next;
  };
  const sendUpload = (work) => (state.sessionId === null ? enqueueUpload(work) : work());

  const inputs = createInputs({
    elements: elements.inputs,
    onEvidenceFile: (file) => void onEvidenceFile(file),
    onInput: () => refreshEnabled(),
  });
  const preparedView = createPrepared({
    elements: elements.prepared,
    onPrepare: () => void onPrepare(),
    onDownload: (which) => void onDownload(which),
  });
  const operatorFiles = createOperatorFiles({
    elements: elements.operatorFiles,
    onFile: ({ kind, file }) => void onOperatorFile(kind, file),
  });
  const observation = createObservation({
    elements: elements.observation,
    onManifest: (file) => void onObservationPart({ manifest: file }),
    onRoot: (value) => void onObservationPart({ installRoot: value.trim() }),
    onFiles: (files) => void onObservationPart({ files: [...files] }),
  });
  const statuses = createStatuses({ elements: elements.statuses });
  const reopen = createReopen({
    elements: elements.reopen,
    onFiles: (files) => {
      state.reopenFiles = files;
    },
    onReopen: () => void onReopen(),
  });
  const verdict = createVerdict({ elements: elements.verdict, onConsume: () => void onConsume() });
  const detector = createDetector({ elements: elements.detector, onFixture: () => void onFixture() });

  function refreshEnabled() {
    preparedView.setCanPrepare(
      state.subject !== null && state.evidenceFacts?.parsed === true && inputs.complete(),
    );
    detector.setAvailable(state.subject !== null && state.subject.contentAvailable === true);
    preparedView.setSaved(state.prepared?.prepared === true);
    verdict.setSaved(canConsume());
  }

  /**
   * Whether consuming right now would answer for what the pane is showing.
   *
   * Consumption reads what the SESSION holds, so it is offered only when there
   * are bytes to read - this session prepared them, or the operator reopened
   * them here - and when what the session holds is what the operator supplied:
   * nothing in flight, and every supplied input stored for its current
   * revision. Anything else would put a verdict beside inputs it did not answer
   * for.
   */
  function canConsume() {
    const savedBytes = state.prepared?.prepared === true || state.reopened !== null;
    return savedBytes && inFlight === 0 && storedForCurrentInputs();
  }

  /** Every input the operator supplied, stored for the revision it is on now. */
  function storedForCurrentInputs() {
    for (const kind of ["authority", "trust", "material"]) {
      const stored = state.operatorFiles[kind];
      // Not supplied is not out of date: the consumption refuses on that basis
      // and says which input was missing.
      if (stored === undefined) continue;
      if (stored.ok !== true || stored.revision !== revisions.revisionOf(kind)) return false;
    }
    const observed = state.observation;
    const supplied = observed.manifest !== null || observed.files !== null || observed.installRoot !== "";
    if (!supplied) return true;
    return observed.stored?.ok === true && observed.stored.revision === revisions.revisionOf("observation");
  }

  /** Everything downstream of the evidence, cleared together. */
  function clearResults() {
    preparedView.render(state.prepared);
    clearVerdict();
  }

  /**
   * The verdict, cleared.
   *
   * A verdict answers for the inputs it was derived from. The moment one of
   * them changes it answers for nothing on screen, so it goes rather than sits
   * there looking current.
   */
  function clearVerdict() {
    statuses.render(null);
    verdict.render(null);
    detector.render(null, state.fixture);
  }

  /**
   * One verification input, from the operator changing it to its answer being
   * applied or discarded.
   *
   * The token is taken FIRST, before a single byte is read: what matters is
   * which input they had supplied when they supplied it, not which one they
   * have by the time a folder has been read into memory.
   */
  async function supplying(slot, work) {
    const token = revisions.begin(slot);
    inFlight += 1;
    clearVerdict();
    refreshEnabled();
    try {
      await work(token);
    } finally {
      inFlight -= 1;
      refreshEnabled();
    }
  }

  /**
   * The session an answer came back in.
   *
   * A session the page did not have yet is the one the uploads already in
   * flight are filling, so they keep their tokens. Any other change of session
   * is a DIFFERENT session, and every input captured for the previous one is
   * staled so it can never attach to this one.
   */
  function adoptSession(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === state.sessionId) return;
    revisions.sessionChanged(sessionId, { opened: state.sessionId === null });
    state.sessionId = sessionId;
  }

  /** One operator-supplied configuration file, stored server-side by kind. */
  function onOperatorFile(kind, file) {
    return supplying(kind, async (token) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await sendUpload(async () => {
        // Superseded before it was ever sent. Nothing is reported: the input
        // that replaced this one has its own send, and that one answers.
        if (!revisions.isCurrent(token, state.sessionId)) return;
        const stored = await storeOperatorFile({
          sessionId: state.sessionId,
          kind,
          revision: token.revision,
          base64: bytesToBase64(bytes),
        });
        // An answer about an input the operator has since replaced, or about a
        // session this page has left, is not an answer about anything on
        // screen: no state, no session id, no render.
        if (!revisions.isCurrent(token, state.sessionId)) return;
        state.operatorFiles = {
          ...state.operatorFiles,
          [kind]: { ...stored, revision: token.revision },
        };
        // The first operator file opens the session these inputs belong to, so
        // everything that follows lands in the same one.
        adoptSession(stored.sessionId);
        operatorFiles.render(state.operatorFiles);
      });
    });
  }

  /**
   * One part of the observation: the manifest, the install root or the folder.
   *
   * Each part is remembered as it arrives and the three are sent together, so
   * changing any one of them re-sends the whole set and the session holds
   * exactly what the operator last chose. Until all three are there, nothing is
   * sent and the missing parts read "Not supplied".
   */
  function onObservationPart(part) {
    return supplying("observation", async (token) => {
      const pending = { ...state.observation, ...part, stored: null };
      state.observation = pending;
      observation.render(state.observation);
      const { manifest, installRoot, files } = pending;
      if (manifest === null || files === null || installRoot === "") return;

      const manifestBytes = new Uint8Array(await manifest.arrayBuffer());
      const uploaded = await Promise.all(
        files.map(async (file) => ({
          relativePath: relativePathOf(file),
          base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
        })),
      );
      await sendUpload(async () => {
        // A part that changed while these bytes were being read is a different
        // observation, and its own send is the one that answers for it.
        if (!revisions.isCurrent(token, state.sessionId)) return;
        const stored = await storeObservation({
          sessionId: state.sessionId,
          installRoot,
          revision: token.revision,
          manifestBase64: bytesToBase64(manifestBytes),
          files: uploaded,
        });
        if (!revisions.isCurrent(token, state.sessionId)) return;
        state.observation = { ...pending, stored: { ...stored, revision: token.revision } };
        // Like the operator files, the first thing supplied opens the session these
        // inputs belong to, so everything that follows lands in the same one.
        adoptSession(stored.sessionId);
        observation.render(state.observation);
      });
    });
  }

  /**
   * A fresh session holding exactly the bytes the operator handed back.
   *
   * Everything this pane believed is dropped: the verdict that follows comes
   * from those bytes and the operator configuration alone.
   */
  function onReopen() {
    const files = state.reopenFiles;
    if (files === undefined || files.input === null || files.evidence === null) return Promise.resolve();
    return supplying("reopen", async (token) => {
      const [inputBytes, evidenceBytes] = await Promise.all([
        files.input.arrayBuffer(),
        files.evidence.arrayBuffer(),
      ]);
      const opened = await reopenFromFiles({
        inputBase64: bytesToBase64(new Uint8Array(inputBytes)),
        evidenceBase64: bytesToBase64(new Uint8Array(evidenceBytes)),
      });
      if (!revisions.isCurrent(token, state.sessionId)) return;
      if (opened.ok === false) {
        reopen.renderError(opened.error);
        return;
      }
      state.reopened = opened;
      // A different session entirely. Every input captured for the one before
      // it is staled here, so an upload still in flight can never attach to
      // this session or bring its session id back.
      revisions.sessionChanged(opened.sessionId);
      state.sessionId = opened.sessionId;
      // The new session has no operator configuration of its own yet. Say so
      // rather than letting the previous session's files appear to carry over.
      state.operatorFiles = {};
      state.prepared = null;
      // The observation belongs to the session it was uploaded into. A fresh one
      // has none, so the inputs are cleared rather than left looking carried over.
      state.observation = noObservation();
      operatorFiles.reset();
      operatorFiles.render(state.operatorFiles);
      observation.reset();
      observation.render(state.observation);
      reopen.render(opened);
      clearVerdict();
    });
  }

  function onEvidenceFile(file) {
    return supplying("evidence", async (token) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      // Core's own parser decides whether these bytes are acceptable. The page
      // never normalises, reformats or repairs them.
      const facts = await parseEvidence(base64);
      // An answer about evidence the operator has since replaced would leave
      // the bytes and the facts describing two different files.
      if (!revisions.isCurrent(token, state.sessionId)) return;
      state.evidenceBase64 = base64;
      state.evidenceFacts = facts;
      inputs.renderEvidence(state.evidenceFacts);
    });
  }

  async function onPrepare() {
    const values = inputs.values();
    // Preparing can open the session too, so before there is one it takes its
    // turn with the uploads rather than opening a second session beside them
    // and leaving the operator's inputs split across two.
    const answer = await sendUpload(() =>
      prepare({
        sessionId: state.sessionId,
        entryId: state.entry.entryId,
        route: values.route,
        target: values.target,
        effect: values.effect,
        decisionId: values.decisionId,
        decisionDigest: values.decisionDigest,
        evidenceBase64: state.evidenceBase64,
        bindingClaim: state.bindingClaim,
      }),
    );
    if (answer.ok === false) {
      preparedView.renderError(answer.error);
      return;
    }
    state.prepared = answer;
    adoptSession(answer.sessionId);
    preparedView.render(state.prepared);
    clearVerdict();
    refreshEnabled();
  }

  async function onConsume() {
    // The button is disabled when this does not hold; a click that reaches here
    // anyway is not a reason to consume a session that does not match the pane.
    if (!canConsume()) return;
    const asked = { sessionId: state.sessionId, inputs: revisions.inputsRevision() };
    const view = await consume(asked.sessionId);
    // A verdict about a session the page has left, or about inputs the operator
    // changed while it was being derived, answers for nothing on screen.
    if (asked.sessionId !== state.sessionId || asked.inputs !== revisions.inputsRevision()) return;
    if (view.ok === false) {
      verdict.renderError(view.error);
      return;
    }
    // Six fields, or none. A refusal that happened BEFORE Core evaluated
    // anything - the document did not reopen, the material carried its own
    // trust, no verifier trust was supplied - has no axis values at all, and
    // six empty cells would read as six axes that were evaluated and came back
    // blank. The verdict below says what was refused and why.
    const evaluated = typeof view.structure === "string";
    statuses.render(evaluated ? view : null);
    verdict.render(view);
    detector.render(view, state.fixture);
  }

  async function onFixture() {
    const values = inputs.values();
    const built = await loadValidationFixture({
      entryId: state.entry.entryId,
      target: values.target || "claude",
      effect: values.effect,
    });
    if (built.ok === false) {
      detector.renderError(built.error);
      return;
    }
    state.fixture = built;
    // Its own session, and not the one any pending upload was supplied for:
    // every open token is staled so an operator file still in flight cannot
    // land on top of the fixture's own.
    revisions.sessionChanged(built.sessionId);
    state.sessionId = built.sessionId;
    // The fixture writes its own operator files into its own session. Show what
    // it wrote, labelled as the fixture's, rather than leaving the rows empty.
    const generated = "generated by validation mode, not supplied by you";
    const wrote = (storedAs, kind) => ({
      ok: true,
      storedAs,
      note: generated,
      revision: revisions.revisionOf(kind),
    });
    state.operatorFiles = {
      authority: wrote("operator/authority-bundle.json", "authority"),
      trust: wrote("operator/operator-trust.json", "trust"),
      material: wrote("attestation-material.json", "material"),
    };
    operatorFiles.render(state.operatorFiles);
    // The fixture opens its own session, which holds no observation.
    state.observation = noObservation();
    observation.reset();
    observation.render(state.observation);
    // The fixture supplies the evidence too, so it takes the evidence input the
    // same way an operator does: an evidence file chosen while this is being
    // parsed is the current one, and the fixture's answer is then discarded.
    const evidenceToken = revisions.begin("evidence");
    state.evidenceBase64 = built.evidenceBase64;
    state.bindingClaim = built.bindingClaim;
    inputs.setDecision({ decisionId: built.decisionId, decisionDigest: built.decisionDigest });
    const facts = await parseEvidence(built.evidenceBase64);
    if (!revisions.isCurrent(evidenceToken, state.sessionId)) return;
    state.evidenceFacts = facts;
    inputs.renderEvidence(state.evidenceFacts);
    // Nothing has been consumed yet, so there is no attestation verdict to
    // show - but the fixture's own declaration is available and is shown now.
    detector.render(null, state.fixture);
    refreshEnabled();
  }

  async function onDownload(which) {
    const saved = await fetchSaved(state.sessionId, which);
    if (saved.ok === false) return;
    downloadBase64(saved.name, saved.base64);
  }

  return {
    /** Renders the pane's resting state. Called once, at mount. */
    mount() {
      inputs.renderSubject(null, null);
      inputs.renderEvidence(null);
      operatorFiles.render(state.operatorFiles);
      observation.render(state.observation);
      reopen.render(null);
      clearResults();
      refreshEnabled();
    },

    /** Called whenever the catalog selection changes. Every step resets with it. */
    async select(entry) {
      const selected = entry ?? null;
      state.entry = selected;
      state.subject = null;
      state.catalog = null;
      state.evidenceBase64 = null;
      state.evidenceFacts = null;
      // A new selection is a new workflow. Everything still in flight for the
      // previous one is staled here, so nothing it was carrying can open or
      // fill a session under this selection.
      revisions.sessionChanged(null);
      state.sessionId = null;
      state.prepared = null;
      state.fixture = null;
      state.bindingClaim = null;
      state.operatorFiles = {};
      state.observation = noObservation();
      state.reopened = null;
      state.reopenFiles = undefined;
      inputs.clearDecision();
      inputs.renderEvidence(null);
      operatorFiles.reset();
      operatorFiles.render(state.operatorFiles);
      observation.reset();
      observation.render(state.observation);
      reopen.render(null);
      clearResults();

      if (selected === null) {
        inputs.renderSubject(null, null);
        refreshEnabled();
        return;
      }

      // Two answers from two owners, asked for at the same time. Catalog reads
      // and hashes every declared artifact in the index, so it takes about a
      // second; the identity is not made to wait for it.
      state.catalog = "pending";
      const integrity = fetchCatalogIntegrity(selected.entryId);
      const subject = await fetchSubject(selected.entryId);
      // A selection that changed while this was in flight is not this one.
      if (state.entry !== selected) return;
      state.subject = subject.ok === false ? null : subject;
      if (subject.ok === false) {
        inputs.renderSubjectError(subject.error);
        refreshEnabled();
        return;
      }
      inputs.renderSubject(state.subject, state.catalog);
      refreshEnabled();

      const catalog = await integrity;
      if (state.entry !== selected) return;
      state.catalog = catalog;
      inputs.renderSubject(state.subject, state.catalog);
    },
  };
}

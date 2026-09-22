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
 */

import { governanceElements } from "./elements.js";
import { createDetector } from "./detector.js";
import { createInputs } from "./inputs.js";
import { createObservation } from "./observation.js";
import { createOperatorFiles } from "./operator-files.js";
import { createPrepared } from "./prepared.js";
import { createReopen } from "./reopen.js";
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
    const saved = state.prepared?.prepared === true;
    preparedView.setSaved(saved);
    // Consumption reads bytes off disk, so it is available either because this
    // session just prepared them or because the operator reopened them here.
    verdict.setSaved(saved || state.reopened !== null);
  }

  /** Everything downstream of the evidence, cleared together. */
  function clearResults() {
    preparedView.render(state.prepared);
    statuses.render(null);
    verdict.render(null);
    detector.render(null, state.fixture);
  }

  /** One operator-supplied configuration file, stored server-side by kind. */
  async function onOperatorFile(kind, file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeOperatorFile({
      sessionId: state.sessionId,
      kind,
      base64: bytesToBase64(bytes),
    });
    state.operatorFiles = { ...state.operatorFiles, [kind]: stored };
    // The first operator file opens the session these inputs belong to, so
    // everything that follows lands in the same one.
    if (stored.sessionId !== undefined) state.sessionId = stored.sessionId;
    operatorFiles.render(state.operatorFiles);
    refreshEnabled();
  }

  /**
   * One part of the observation: the manifest, the install root or the folder.
   *
   * Each part is remembered as it arrives and the three are sent together, so
   * changing any one of them re-sends the whole set and the session holds
   * exactly what the operator last chose. Until all three are there, nothing is
   * sent and the missing parts read "Not supplied".
   */
  async function onObservationPart(part) {
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
    const stored = await storeObservation({
      sessionId: state.sessionId,
      installRoot,
      manifestBase64: bytesToBase64(manifestBytes),
      files: uploaded,
    });
    // A part that changed while this was in flight is a different observation,
    // and its own send is the one that answers for it.
    if (state.observation !== pending) return;
    state.observation = { ...pending, stored };
    // Like the operator files, the first thing supplied opens the session these
    // inputs belong to, so everything that follows lands in the same one.
    if (stored.sessionId !== undefined) state.sessionId = stored.sessionId;
    observation.render(state.observation);
  }

  /**
   * A fresh session holding exactly the bytes the operator handed back.
   *
   * Everything this pane believed is dropped: the verdict that follows comes
   * from those bytes and the operator configuration alone.
   */
  async function onReopen() {
    const files = state.reopenFiles;
    if (files === undefined || files.input === null || files.evidence === null) return;
    const [inputBytes, evidenceBytes] = await Promise.all([
      files.input.arrayBuffer(),
      files.evidence.arrayBuffer(),
    ]);
    const opened = await reopenFromFiles({
      inputBase64: bytesToBase64(new Uint8Array(inputBytes)),
      evidenceBase64: bytesToBase64(new Uint8Array(evidenceBytes)),
    });
    if (opened.ok === false) {
      reopen.renderError(opened.error);
      return;
    }
    state.reopened = opened;
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
    statuses.render(null);
    verdict.render(null);
    detector.render(null, state.fixture);
    // Consumption is what reads these bytes, so it is available immediately.
    verdict.setSaved(true);
    preparedView.setSaved(false);
  }

  async function onEvidenceFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.evidenceBase64 = bytesToBase64(bytes);
    // Core's own parser decides whether these bytes are acceptable. The page
    // never normalises, reformats or repairs them.
    state.evidenceFacts = await parseEvidence(state.evidenceBase64);
    inputs.renderEvidence(state.evidenceFacts);
    refreshEnabled();
  }

  async function onPrepare() {
    const values = inputs.values();
    const answer = await prepare({
      sessionId: state.sessionId,
      entryId: state.entry.entryId,
      route: values.route,
      target: values.target,
      effect: values.effect,
      decisionId: values.decisionId,
      decisionDigest: values.decisionDigest,
      evidenceBase64: state.evidenceBase64,
      bindingClaim: state.bindingClaim,
    });
    if (answer.ok === false) {
      preparedView.renderError(answer.error);
      return;
    }
    state.prepared = answer;
    state.sessionId = answer.sessionId ?? state.sessionId;
    preparedView.render(state.prepared);
    statuses.render(null);
    verdict.render(null);
    detector.render(null, state.fixture);
    refreshEnabled();
  }

  async function onConsume() {
    const view = await consume(state.sessionId);
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
    state.sessionId = built.sessionId;
    // The fixture writes its own operator files into its own session. Show what
    // it wrote, labelled as the fixture's, rather than leaving the rows empty.
    const generated = "generated by validation mode, not supplied by you";
    state.operatorFiles = {
      authority: { ok: true, storedAs: "operator/authority-bundle.json", note: generated },
      trust: { ok: true, storedAs: "operator/operator-trust.json", note: generated },
      material: { ok: true, storedAs: "attestation-material.json", note: generated },
    };
    operatorFiles.render(state.operatorFiles);
    // The fixture opens its own session, which holds no observation.
    state.observation = noObservation();
    observation.reset();
    observation.render(state.observation);
    state.evidenceBase64 = built.evidenceBase64;
    state.bindingClaim = built.bindingClaim;
    inputs.setDecision({ decisionId: built.decisionId, decisionDigest: built.decisionDigest });
    state.evidenceFacts = await parseEvidence(built.evidenceBase64);
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

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
import { createPrepared } from "./prepared.js";
import { createStatuses } from "./statuses.js";
import { createVerdict } from "./verdict.js";
import { bytesToBase64, downloadBase64 } from "./bytes.js";
import { consume, fetchSaved, fetchSubject, loadValidationFixture, parseEvidence, prepare } from "./transport.js";

export function createGovernance() {
  const elements = governanceElements();
  const state = {
    entry: null,
    subject: null,
    evidenceBase64: null,
    evidenceFacts: null,
    sessionId: null,
    prepared: null,
    fixture: null,
    bindingClaim: null,
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
  const statuses = createStatuses({ elements: elements.statuses });
  const verdict = createVerdict({ elements: elements.verdict, onConsume: () => void onConsume() });
  const detector = createDetector({ elements: elements.detector, onFixture: () => void onFixture() });

  function refreshEnabled() {
    preparedView.setCanPrepare(
      state.subject !== null && state.evidenceFacts?.parsed === true && inputs.complete(),
    );
    detector.setAvailable(state.subject !== null && state.subject.contentAvailable === true);
    const saved = state.prepared?.prepared === true;
    preparedView.setSaved(saved);
    verdict.setSaved(saved);
  }

  /** Everything downstream of the evidence, cleared together. */
  function clearResults() {
    preparedView.render(state.prepared);
    statuses.render(null);
    verdict.render(null);
    detector.render(null, state.fixture);
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
    statuses.render(view.reopened === false ? null : view);
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
      inputs.renderSubject(null);
      inputs.renderEvidence(null);
      clearResults();
      refreshEnabled();
    },

    /** Called whenever the catalog selection changes. Every step resets with it. */
    async select(entry) {
      state.entry = entry ?? null;
      state.subject = null;
      state.evidenceBase64 = null;
      state.evidenceFacts = null;
      state.sessionId = null;
      state.prepared = null;
      state.fixture = null;
      state.bindingClaim = null;
      inputs.clearDecision();
      inputs.renderEvidence(null);
      clearResults();

      if (state.entry !== null) {
        const subject = await fetchSubject(state.entry.entryId);
        state.subject = subject.ok === false ? null : subject;
        if (subject.ok === false) {
          inputs.renderSubjectError(subject.error);
          refreshEnabled();
          return;
        }
      }
      inputs.renderSubject(state.subject);
      refreshEnabled();
    },
  };
}

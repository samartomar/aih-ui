/* Read-only local Decision V2 inspection. Core owns the structural parser. */
import { collectIds, el } from "./dom.js";

const MAX_FILE_BYTES = 1024 * 1024;

function base64Of(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createDecisionImport() {
  const elements = collectIds([
    "open-decision-btn", "decision-dialog", "decision-file", "decision-status",
    "decision-summary", "decision-source-wrap", "decision-source", "close-decision-btn",
  ]);
  let sequence = 0;

  function clear() {
    elements.decisionSummary.replaceChildren();
    elements.decisionSummary.hidden = true;
    elements.decisionSource.textContent = "";
    elements.decisionSourceWrap.hidden = true;
  }

  elements.openDecisionBtn.addEventListener("click", () => {
    elements.decisionDialog.showModal();
    elements.decisionFile.focus();
  });
  elements.closeDecisionBtn.addEventListener("click", () => elements.decisionDialog.close());
  elements.decisionDialog.addEventListener("close", () => {
    sequence += 1;
    elements.decisionFile.value = "";
    elements.decisionFile.disabled = false;
    elements.decisionStatus.textContent = "Choose a file to begin.";
    clear();
  });

  elements.decisionFile.addEventListener("change", async () => {
    const file = elements.decisionFile.files?.[0];
    if (!file) return;
    const current = ++sequence;
    clear();
    if (file.size > MAX_FILE_BYTES) {
      elements.decisionStatus.textContent = "File is over the 1 MiB review limit.";
      return;
    }
    elements.decisionFile.disabled = true;
    elements.decisionStatus.textContent = `Checking ${file.name} with Core…`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (current !== sequence) return;
      elements.decisionSource.textContent = source;
      elements.decisionSourceWrap.hidden = false;
      const response = await fetch("/api/decision-structure", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base64: base64Of(bytes) }),
      });
      const result = await response.json();
      if (current !== sequence) return;
      if (!response.ok || result.ok !== true) throw new Error(result.error ?? `Decision review request failed (${response.status}).`);
      if (!result.parsed) {
        elements.decisionStatus.textContent = `Decision structure refused: ${result.reason}`;
        return;
      }
      elements.decisionStatus.textContent = `Core accepted the decoded Decision V2 structure of ${file.name}. Signature and authority are not verified.`;
      for (const [label, value] of [
        ["Decision", result.id], ["Disposition", result.disposition],
        ["Qualification basis", result.qualificationBasis],
        ["Subject", `${result.subjectKind} · ${result.subjectId}`],
        ["Source type", result.sourceType], ["Targets", result.targets.join(", ")],
        ["Allowed effects", result.allowedEffects.join(", ")],
        ["Issuer", result.issuer], ["Actor", result.actor],
        ["Issued", result.issuedAt], ["Expires", result.expiresAt],
      ]) {
        const row = el("div");
        row.append(el("dt", "text-on-surface-variant", label), el("dd", "font-mono text-on-surface break-all", String(value)));
        elements.decisionSummary.append(row);
      }
      elements.decisionSummary.hidden = false;
    } catch (error) {
      if (current === sequence) elements.decisionStatus.textContent = error?.message ?? String(error);
    } finally {
      if (current === sequence) elements.decisionFile.disabled = false;
    }
  });

  return {
    setSettings(settings) {
      const enterprise = settings.experience === "enterprise";
      elements.openDecisionBtn.hidden = !enterprise;
      if (!enterprise && elements.decisionDialog.open) elements.decisionDialog.close();
    },
  };
}

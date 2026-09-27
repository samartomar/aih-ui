/* Local organization PolicyBundle opening. Core owns the structural decision. */
import { collectIds, el } from "./dom.js";

const MAX_FILE_BYTES = 1024 * 1024;

function base64Of(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function review(bytes) {
  const response = await fetch("/api/policy-bundle-structure", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base64: base64Of(bytes) }),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result.error ?? `Policy review request failed (${response.status}).`);
  return result;
}

export function createPolicyImport({ onReview = () => {} } = {}) {
  const elements = collectIds([
    "open-org-policy-btn", "org-policy-dialog", "org-policy-file", "org-policy-status",
    "org-policy-summary", "org-policy-source-wrap", "org-policy-source", "close-org-policy-btn",
    "org-policy-context", "org-policy-title", "org-policy-description",
  ]);
  let sequence = 0;

  function clear() {
    elements.orgPolicySummary.replaceChildren();
    elements.orgPolicySummary.hidden = true;
    elements.orgPolicySource.textContent = "";
    elements.orgPolicySourceWrap.hidden = true;
  }

  elements.openOrgPolicyBtn.addEventListener("click", () => {
    elements.orgPolicyDialog.showModal();
    elements.orgPolicyFile.focus();
  });
  elements.closeOrgPolicyBtn.addEventListener("click", () => elements.orgPolicyDialog.close());
  elements.orgPolicyDialog.addEventListener("close", () => {
    sequence += 1;
    elements.orgPolicyFile.value = "";
    elements.orgPolicyFile.disabled = false;
    elements.orgPolicyStatus.textContent = "Choose a file to begin.";
    clear();
  });

  elements.orgPolicyFile.addEventListener("change", async () => {
    const file = elements.orgPolicyFile.files?.[0];
    if (!file) return;
    const current = ++sequence;
    clear();
    onReview(null);
    if (file.size > MAX_FILE_BYTES) {
      elements.orgPolicyStatus.textContent = "File is over the 1 MiB review limit.";
      onReview({ name: file.name, state: "error" });
      return;
    }
    elements.orgPolicyFile.disabled = true;
    elements.orgPolicyStatus.textContent = `Checking ${file.name} with Core…`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (current !== sequence) return;
      elements.orgPolicySource.textContent = source;
      elements.orgPolicySourceWrap.hidden = false;
      const result = await review(bytes);
      if (current !== sequence) return;
      if (!result.parsed) {
        elements.orgPolicyStatus.textContent = `File review refused: ${result.reason}`;
        onReview({ name: file.name, state: "refused" });
        return;
      }
      elements.orgPolicyStatus.textContent = `Core accepted the decoded bundle structure of ${file.name}. This is not full CLI file validation.`;
      onReview({ name: file.name, state: "accepted" });
      for (const [label, value] of [
        ["Bundle schema", result.schemaVersion], ["Bundle version", result.bundleVersion],
        ["Issuer", result.issuer], ["Issued at", result.issuedAt],
        ["Policy schema", result.policySchemaVersion], ["Minimum posture", result.minimumPosture],
      ]) {
        const row = el("div");
        row.append(el("dt", "text-on-surface-variant", label), el("dd", "font-mono text-on-surface break-all", String(value)));
        elements.orgPolicySummary.append(row);
      }
      elements.orgPolicySummary.hidden = false;
    } catch (error) {
      if (current === sequence) {
        elements.orgPolicyStatus.textContent = error?.message ?? String(error);
        onReview({ name: file.name, state: "error" });
      }
    } finally {
      if (current === sequence) elements.orgPolicyFile.disabled = false;
    }
  });

  return {
    setSettings(settings) {
      const admin = settings.experience === "enterprise" && settings.role === "admin";
      const developer = settings.experience === "enterprise" && settings.role === "developer";
      elements.openOrgPolicyBtn.hidden = !admin && !developer;
      elements.openOrgPolicyBtn.textContent = developer ? "Open admin-supplied local policy" : "Open local PolicyBundle";
      elements.orgPolicyContext.textContent = developer ? "Enterprise Developer · Admin-supplied policy" : "Enterprise Admin · Local policy";
      elements.orgPolicyTitle.textContent = developer ? "Open admin-supplied PolicyBundle" : "Open organization PolicyBundle";
      elements.orgPolicyDescription.textContent = developer
        ? "Choose the local organization PolicyBundle supplied by your admin. Core checks its decoded structure; this does not verify approval, policy authority or CLI file handling. The file stays read-only here."
        : "Choose a local JSON file to review its original text and check its decoded structure with Core. This does not validate CLI file handling or establish policy authority.";
      if (!admin && !developer && elements.orgPolicyDialog.open) elements.orgPolicyDialog.close();
    },
  };
}

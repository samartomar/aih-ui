/*
 * The start-up contract-check message.
 *
 * The host runs Core's `checkContracts` once at start-up over the installed
 * packages' package-support declarations (tools/service/contract-check.mjs) and
 * answers GET /api/contract-check. This module words that answer:
 *
 *   loading      the answer has not arrived
 *   empty        the check ran and no contract one package reads from another applies
 *   unavailable  Core has no contract check ("This Core can't check contracts yet."),
 *                some required checks could not run (no reader, no fixture), or an
 *                installed package's declaration is missing or unreadable
 *   cant-read    a package refused a fixture it should read:
 *                "{package} {version} can't read {contract}; update {package}."
 *   failed       the check itself could not run
 *   passed       every required check passed; nothing is shown
 *
 * The message is information: it blocks nothing.
 */
import { el } from "./dom.js";
import { iconSpan } from "./icons.js";
import { attachTooltip } from "./tooltip.js";

export const CONTRACT_CHECK_ABSENT = "This Core can't check contracts yet.";
export const CONTRACT_CHECK_LOADING = "Checking contracts…";
const NOTHING_BLOCKED = "Nothing is blocked; everything keeps working as before.";

const REASONS = {
  "reader-missing": "the Workbench has no reader it can run for it",
  "fixture-unavailable": "its fixture could not be loaded",
  "fixtures-missing": "the other package lists no fixture for it",
};
const reasonText = row => REASONS[row.reason] ?? (row.reason ? `the check reports ${row.reason}` : "the check could not run");
const versionOf = (answer, name) => answer.versions?.[name] ?? "";
const named = (answer, name) => [name, versionOf(answer, name)].filter(Boolean).join(" ");

/** The words for one refused contract: the package Core's check names to update. */
export function cantReadWords(answer, row) {
  const reader = row.updatePackage ?? row.readerPackage;
  return `${named(answer, reader)} can't read ${row.contractId}; update ${reader}.`;
}
const unavailableWords = (answer, row) => `Can't check that ${named(answer, row.readerPackage)} reads ${row.contractId} from ${row.fixturePackage}: ${reasonText(row)}.`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The message for one answer (undefined while loading).
 * @returns {{ state: string, words: string, detail: string[], tone: string, icon: [string, string] } | null}
 */
export function contractCheckView(answer) {
  if (answer === undefined) return { state: "loading", words: CONTRACT_CHECK_LOADING, tone: "text-outline", icon: ["state", "info"],
    detail: ["The Workbench is asking Core's contract check whether each installed package can read the contracts the others write."] };
  if (!answer || answer.ok === false || answer.state === "unknown" || answer.state === "invalid") {
    const reason = answer?.error ?? answer?.reason ?? (answer?.diagnostics ?? []).map(item => [item.code, item.path].filter(Boolean).join(" at ")).join("; ") ?? "";
    return { state: "failed", words: "The contract check failed.", tone: "text-error", icon: ["state", "policy"],
      detail: [`The contract check could not run${reason ? `: ${reason}` : ""}.`, NOTHING_BLOCKED] };
  }
  if (answer.state === "absent") return { state: "unavailable", words: CONTRACT_CHECK_ABSENT, tone: "text-info", icon: ["state", "info"],
    detail: [`${CONTRACT_CHECK_ABSENT} The installed @aihq/core publishes no checkContracts, so the Workbench cannot ask whether each package can read the contracts the others write.`, NOTHING_BLOCKED] };
  const checks = answer.checks ?? [];
  // A package whose declaration could not be read was never checked; it is never folded into "passed" or "empty".
  const unchecked = (answer.packages ?? []).filter(item => item.status !== "found")
    .map(item => `Can't check ${[item.name, item.version].filter(Boolean).join(" ")}: ${item.status === "missing" ? "it publishes no package-support declaration" : `its declaration ${item.status === "mismatched" ? "does not name it" : "can't be read"}${item.reason ? ` (${item.reason})` : ""}`}.`);
  if (!checks.length && !unchecked.length) return { state: "empty", words: "No contract checks apply.", tone: "text-outline", icon: ["state", "info"],
    detail: ["Core's contract check ran over the installed packages' declarations, and no package reads a contract another one publishes fixtures for. This makes no claim either way."] };
  const failed = checks.filter(row => row.status === "failed");
  const unavailable = checks.filter(row => row.status === "unavailable");
  const passed = checks.filter(row => row.status === "passed").length;
  const tally = `${plural(passed, "check", "checks")} passed, ${failed.length} failed, ${unavailable.length} could not run.`;
  if (failed.length) {
    const lines = [...new Set(failed.map(row => cantReadWords(answer, row)))];
    return { state: "cant-read", words: lines.length > 1 ? `${lines[0]} (+${lines.length - 1} more)` : lines[0], tone: "text-tertiary", icon: ["state", "needs-ok"],
      detail: [...lines, ...unchecked, ...unavailable.map(row => unavailableWords(answer, row)), tally, NOTHING_BLOCKED] };
  }
  if (unavailable.length || unchecked.length) {
    const count = unavailable.length + unchecked.length;
    return { state: "unavailable", words: `${plural(count, "contract check", "contract checks")} can't run.`, tone: "text-info", icon: ["state", "info"],
      detail: [...unchecked, ...unavailable.map(row => unavailableWords(answer, row)), tally, NOTHING_BLOCKED] };
  }
  return { state: "passed", words: `Contracts checked: ${plural(passed, "check", "checks")} passed.`, tone: "text-outline", icon: ["state", "info"], detail: [tally] };
}

/** The strip's note, or null when every required check passed. */
export function contractCheckNote(view) {
  if (!view || view.state === "passed") return null;
  const note = el("span", `px-1.5 py-0.2 rounded bg-surface-container font-mono text-[10px] shrink-0 inline-flex items-center gap-1 ${view.tone}`);
  note.id = "contract-check-note";
  note.dataset.contractCheck = view.state;
  note.setAttribute("role", "status");
  if (view.state === "loading") note.setAttribute("aria-busy", "true");
  note.appendChild(iconSpan(view.icon[0], view.icon[1], { size: "text-[12px]" }));
  note.appendChild(el("span", "", view.words));
  attachTooltip(note, view.detail.join("\n"));
  return note;
}

/** Asks the host once; a failed request is the failed state, never a pass. */
export async function loadContractCheck(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl("/api/contract-check", { headers: { accept: "application/json" } });
    const answer = await response.json();
    return response.ok ? answer : { ok: false, error: answer?.error ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

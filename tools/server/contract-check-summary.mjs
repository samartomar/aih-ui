/**
 * The page's start-up contract check (GET /api/contract-check), from the answer of the service's
 * `contractCheck` operation. A host failure is the failed state, never absent or passed. Each row keeps
 * only the fields Core's check reports about it, so no local path reaches the page.
 */
const ROW_FIELDS = ["contractId", "readerPackage", "fixturePackage", "fixtureExport", "updatePackage", "status", "reason", "expect", "expectedCode", "actual"];
const text = value => typeof value === "string" ? value : undefined;

export function contractCheckSummary(answer) {
  if (!answer?.ok) return { state: "unknown", reason: text(answer?.error) ?? "the contract check could not be inspected" };
  if (answer.state === "absent") return { state: "absent" };
  if (answer.state === "invalid") return { state: "invalid", diagnostics: (answer.diagnostics ?? []).slice(0, 20).map(item => ({ code: text(item?.code), path: text(item?.path) })) };
  if (answer.state === "ran") return {
    state: "ran",
    versions: answer.versions ?? {},
    packages: (answer.packages ?? []).map(item => ({ name: item.name, status: item.status, version: text(item.version), schema: text(item.schema), from: text(item.from) })),
    checks: (answer.checks ?? []).map(row => Object.fromEntries(ROW_FIELDS.filter(key => row[key] !== undefined).map(key => [key, row[key]]))),
  };
  return { state: "unknown", reason: text(answer.reason) ?? "the contract check could not be inspected" };
}

/**
 * The package summary's `contractCheck`: whether the installed Core publishes
 * `checkContracts`, from the answer of the service's `contractCheck` operation.
 * `absent` is the only state the page words today; `available` and `unknown`
 * show nothing on the page and are kept in the provenance detail.
 */
export function contractCheckSummary(answer) {
  if (!answer?.ok) return { state: "unknown", reason: answer?.error ?? "the contract check could not be inspected" };
  if (answer.state === "absent") return { state: "absent" };
  if (answer.state === "available") return { state: "available", entry: answer.entry };
  return { state: "unknown", reason: answer.reason ?? "the contract check could not be inspected" };
}

/**
 * The header's Your tool answers (GET /api/tools and GET /api/tool-inspection), from the service's `tools` and
 * `toolInspection` operations. A host failure is the failed state, never an empty list. Each row keeps only the
 * fields Core returned for it, as strings or booleans, so nothing else reaches the page.
 */
const text = value => typeof value === "string" ? value : undefined;
const keep = (row, fields) => Object.fromEntries(fields.filter(key => text(row?.[key]) !== undefined).map(key => [key, row[key]]));

export function toolsSummary(answer) {
  if (!answer?.ok) return { state: "failed", reason: text(answer?.error) ?? "the tool list could not be read" };
  if (answer.state === "unavailable") return { state: "unavailable", reason: text(answer.reason) };
  if (answer.state !== "published" || !Array.isArray(answer.tools)) return { state: "failed", reason: "the service returned no tool list" };
  return {
    state: "published", source: "@aihq/core/harness listTools",
    tools: answer.tools.filter(row => text(row?.id)).map(row => ({ ...keep(row, ["id", "label", "surface"]), observed: row.observed === true,
      ...(row.refusal ? { refusal: keep(row.refusal, ["code", "reason"]) } : {}) })),
  };
}

export function toolInspectionSummary(answer) {
  if (!answer?.ok) return { state: "failed", reason: text(answer?.error) ?? "Core's inspection could not run" };
  return {
    state: "inspected", source: "@aihq/core inspect", status: text(answer.status), package: keep(answer.package, ["name", "version"]),
    tools: (answer.tools ?? []).map(row => keep(row, ["id", "label", "state", "selection"])).filter(row => row.id),
    observations: (answer.observations ?? []).map(row => keep(row, ["id", "target", "detail"])),
    diagnostics: (answer.diagnostics ?? []).slice(0, 20).map(row => keep(row, ["code", "reason", "message"])),
  };
}

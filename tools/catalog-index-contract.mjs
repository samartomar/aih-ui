/*
 * The published catalog-index contract this preview insists on before it serves anything.
 *
 * Kept apart from tools/preview.mjs so the rule can be exercised directly:
 *   node -e "import('./tools/catalog-index-contract.mjs').then(m => …)"
 */

export const EXPECTED_FORMAT = "aih-catalog-index";
export const EXPECTED_VERSION = 1;

/**
 * Returns a list of contract violations. An empty list means the index may be served.
 * @param {unknown} index parsed catalog-index.json
 * @returns {string[]}
 */
export function contractViolations(index) {
  const violations = [];
  if (index === null || typeof index !== "object") {
    return ["index is not a JSON object"];
  }
  if (index.format !== EXPECTED_FORMAT) {
    violations.push(`index format is ${JSON.stringify(index.format)}, expected ${JSON.stringify(EXPECTED_FORMAT)}`);
  }
  if (index.version !== EXPECTED_VERSION) {
    violations.push(`index version is ${JSON.stringify(index.version)}, expected ${EXPECTED_VERSION}`);
  }
  if (!Array.isArray(index.entries)) {
    violations.push("index has no entries array");
  }
  return violations;
}

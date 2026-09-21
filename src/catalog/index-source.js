/*
 * Where the page gets its data: the installed @aihq/catalog index and the
 * preview's summary - installed package versions, Catalog's collection view
 * and Core's supported targets - both served by tools/preview.mjs out of the
 * throwaway consumer.
 *
 * Every render starts from the contract, not from whatever the file happens to
 * hold: a document that does not declare the expected format and version is a
 * reported failure, never a partially rendered page.
 */

import { applyCollections } from "./collections.js";

const INDEX_URL = "./catalog-index.json";
const SUMMARY_URL = "./summary.json";
const EXPECTED_FORMAT = "aih-catalog-index";
const EXPECTED_VERSION = 1;

async function loadJson(url, what) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(`${what} could not be fetched from ${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`${what} could not be fetched from ${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${what} at ${url} is not JSON: ${error.message}`);
  }
}

function assertIndexContract(index) {
  if (index?.format !== EXPECTED_FORMAT) {
    throw new Error(`catalog format is ${JSON.stringify(index?.format)} but ${EXPECTED_FORMAT} is required`);
  }
  if (index?.version !== EXPECTED_VERSION) {
    throw new Error(`catalog version is ${JSON.stringify(index?.version)} but ${EXPECTED_VERSION} is required`);
  }
  if (!Array.isArray(index.entries)) throw new Error("catalog index has no entries array");
}

/**
 * The current inventory, plus the provenance of what was actually installed.
 *
 * Which entries are current is Catalog's statement, carried in the summary as
 * its validated collection view. Without it the page cannot tell a current
 * entry from older content kept for reference, so it is required: a missing
 * view is a reported failure, not a page that quietly shows every release.
 */
export async function loadCatalog() {
  const index = await loadJson(INDEX_URL, "the @aihq/catalog index");
  assertIndexContract(index);
  const summary = await loadJson(SUMMARY_URL, "the preview summary");
  const inventory = applyCollections(summary?.collections ?? null, index.entries);
  return { entries: inventory.current, inventory, summary };
}

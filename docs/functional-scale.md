# Functional composition capacity

Run `node tools/functional-scale-proof.mjs <new-output-directory>` using supported
Node 24.15–24.x. Set `npm_execpath` to that runtime's `npm-cli.js`, and set
`CORE_TGZ`, `CATALOG_TGZ`, `SCAN_TGZ` to exact reviewed archives. The runner packs
and installs this UI, records artifact hashes and installed consumer module
hashes, and uses public exports only. Keep the output in a worktree-local ignored
directory such as `.tmp/functional-scale-1`; retain failed outputs before retrying.

Two additional inputs are required:

- `PLAYWRIGHT_MODULE`: file URL for an installed Playwright module exporting
  `chromium`, with its compatible headless browser available.
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` may select an existing host-owned Chromium
  executable explicitly; the receipt records the actual browser version.
- `REVIEW_EVIDENCE_FILE`: original Scan report/artifact bytes covering the exact
  shipped independent `consumer-proof.review-note` recipe and materials. The
  public reader must establish a usable finding binding. Retained evidence may
  be used when those bytes match; neither fabricated report JSON nor a serialized
  checked handle can replace it. The runner never scans or authenticates a human.

The deterministic workload contains **1,800 inventory items**: the installed
maintained release, one independent note, and enough synthetic items distributed
over six fixture frameworks to reach that total. With the 46-item maintained
release this means 1,753 synthetic items. **291 explicit roots** resolve to **300
selected items including required dependency closure**: the note and its three
maintained prerequisites, plus 290 synthetic roots and six shared prerequisites.
Six optional choices remain deliberately skipped. Source inputs use labelled
local/Git/organization fixture snapshots; they claim no network acquisition or
organization authority. Inventory size, roots, selected items, inclusion paths,
unique files and byte counts are recorded separately.

The ordinary browser also loads all four maintained family releases. Its receipt
counts the 1,800 scenario items by exact scenario release identities, and reports
the total visible inventory, additional items and each ordinary family's count
separately. Synthetic material retains unknown native support; the browser
explicitly selects Full inventory and its declared generic target before choosing
a synthetic item. Browse filters never establish execution capability.

Synthetic declarations are compiled by Catalog's public producer, then read and
resolved through its public checked contracts. Actual UTF-8 Markdown and recipe
bytes are hashed and counted; declared placeholder byte lengths are insufficient.
Core derives every selected recipe/material identity and validates the saved
execution policy. The policy retains configurations, direct/template origins,
source identities/pins, skips, a checked current review and superseded history,
plus unrelated metadata, evidence and lifecycle fields. The proof writes a file,
reads it afresh, performs an ordinary UI composition, downloads it, and imports
that download in a fresh browser context with the original evidence bytes.

Conflicts, incompatible shared-origin configuration, a required skip and
multibyte consumer/Core byte-bound failures must be deterministic, preserve
original inputs and return no executable partial policy. Their original and
candidate byte counts and diagnostics are retained. A seventh framework enters
through the same producer and generic consumer code, adds 300 inventory items,
and successfully saves/reopens 301 selections. **300 is an acceptance workload,
not an item limit.** Existing consumer intent (850,000 UTF-8 bytes), Core policy
(5,242,880 bytes), choice-array and inventory limits remain independent.

The synthetic recipes are **execution-disabled**: this runner starts the standard
authoring server without `projectRoot` or material bindings, verifies execution
is unavailable, and never calls Prepare/Apply. The existing `/intent` execution
guard remains intact. Do not supply these fixtures to an execution host.

`results/functional-scale.json` records actual counts, bytes, identities, browser
agreement and limits; descriptor and identity files preserve detail. The package
manifest and lockfile retain exact dependency/artifact provenance. The runner
performs one functional scale pass plus focused authoring regressions, closes its
browser/server even after failure, and sets no timing target. This proof makes no
claim about all-inventory execution, arbitrary materials, real synthetic framework
support, native clients, organization authority, universal browser support or
latency. The older `/intent` 12-selection receipt is separate historical evidence.

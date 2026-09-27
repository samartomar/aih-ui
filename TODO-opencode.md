# TODO-opencode — overnight read-only review of aih-ui

Run: overnight LLM review, started ≈21:00 local 2026-09-25, final pass ≈04:55 local
2026-09-26. Read-only: only this file and `opencode-llm-analysis-overnight.md` may be written
in the repo. No commits, no installs, no package replacement. Companion file:
`opencode-llm-analysis-overnight.md` (iteration log I0–I4).

A parallel independent review exists in this repo (`TODO-cline.md` +
`cline-llm-analysis-overnight.md`). This register consolidates both; items this run
independently re-verified are marked **(this run)**. Discrepancies between the two runs are in
§6.

## 0. Task restated

Compare `prototype/` (Concept v3 design reference) and `aih-policy-workbench.html`
(retiring standalone snapshot) against the implemented UI in `src/` (+ `tools/` preview
backend). Record every gap: user-visible behavior, evidence (file:line), dependency, risk,
completion criterion, and a status label:

- `SAFE` — buildable now with the supplied packages
- `BLOCKED-PKG` — waits on the upcoming package release (**not yet arrived**; see §1.1)
- `DECISION` — needs a product decision from the owner
- `DONE` — already implemented in `src/`
- `UNCERTAIN` — could not be verified from the evidence available here

Priority: safe, valuable work that must land before `aih-policy-workbench.html` is retired.
Verified facts are marked **[V]**; inferences are marked **[I]**.

## 1. Verified environment facts [V]

### 1.1 Supplied package tarballs (hashes computed this run; identical to the parallel run's)

| Tarball | Version (manifest) | Size | SHA-256 |
| --- | --- | --- | --- |
| `packages/aihq-core-0.6.2.tgz` | `@aihq/core@0.6.2` | 2,721,925 B | `20FD8B632DF3AB5E10FB11F47F3EC16AC1FFE389209E0FE3ECE983AD9E25BD13` |
| `packages/aihq-scan-0.5.0.tgz` | `@aihq/scan@0.5.0` | 966,963 B | `A1524D78127CCF8BFF4521D58301108804FDFCFB5DD260A707ACF5F1D9043764` |
| `packages/aihq-catalog-0.3.0.tgz` | `@aihq/catalog@0.3.0` | 7,233,312 B | `442923773A0FA7FF2C17F44CB94C4E97BAF0CAF19BB1A911530045F9B2D7D6F5` |

Owner-supplied facts (recorded as given, not independently verifiable): core 0.6.2 = "Core
from c00248ef with upgraded analyzers; the 'nothing blocks' change is NOT included"; scan
0.5.0 = "final Scan candidate, pack4"; catalog 0.3.0 = "unchanged; requalified Catalog not
built yet". New packages were expected ~5h after run start. **As of ≈04:55 local 2026-09-26
no new tarball has arrived and the ~5h window has elapsed** (`packages/` unchanged: 9/24 and
9/25 timestamps) — flagged for the owner; if the clock was meant to start from the owner's
build run, the watch continues. When tarballs appear: re-hash, diff manifests/exports against
§1.1/§1.2, re-label the `BLOCKED-PKG` items. **Never install or replace.**

### 1.2 Public-export contract check [V]

Every `@aihq/*` name the UI/backend imports resolves against the supplied tarballs' public
export maps (35 distinct named imports; both runs reached the same result). Method note
learned the hard way: a name absent from `core/dist/index.d.ts` may still be public via
`export *` (the five governance/decision names come from `org-policy/governance-decision-v2.js`
and `org-policy/bundle.js`) — follow re-export targets before declaring anything missing.
The optional Catalog readers are reached by **namespace import with a `typeof` guard**
(`catalog-qualification.mjs:24,39-45`, `catalog-categories.mjs:19,24-27`,
`catalog-publisher.mjs:17,22-25`) so an older Catalog degrades to a stated absence.
Core peer ranges `@aihq/catalog >=0.3.0 <0.4.0`, `@aihq/scan >=0.5.0 <0.6.0` are satisfied by
the trio. Consequence: with the SUPPLIED tarballs the preview starts and every wired API has
its public contract; "blocked by package" below means CONTENT or BEHAVIOR the owner said is
not in these tarballs (requalified Catalog, Core "nothing blocks"), not missing exports.

### 1.3 Repo state [V]

- HEAD `57986a0` "Try lighter Geist typography across the Workbench"; dirty working tree
  (~26 modified + 14 untracked paths). The review reads the WORKING TREE; the README
  (itself modified) describes it and is used as a map, then checked against code.
- `.aih-ui/settings.v1.json` exists (vibe experience, clients `claude`+`codex`) → the preview
  opens the saved-experience page, not the first-run wizard. Gitignored; untouched by this
  run (SHA-256 verified unchanged).
- `.gitignore`: `node_modules/`, `src/styles/tailwind.css`, `dist/`, `*.tgz`, `.tmp/`,
  `.aih-ui/`, `.env*`, `.playwright-cli/`. `.tmp/` is a pre-existing in-repo gitignored
  scratch dir (owner's 9/25 runs left `npm-cache/`).
- Preview puts its run dir under OS temp (`mkdtempSync(join(tmpdir(), "aih-ui-preview-"))`);
  its only in-repo write is the regenerated gitignored `src/styles/tailwind.css`.

### 1.4 Runtime verification results (executed this run; [V])

- `node --test "tools/tests/*.test.mjs"` → **58 pass, 0 fail**.
- `node tools/check-page-contract.mjs` → **all checks passed** (123 relative imports resolve,
  7 page assets, entry point, 400/403/containment classification); note re-confirmed:
  "3 SORT_KEYS the page offers no option for: entryId-desc, sourceType, release" → G18.
- Full preview lifecycle against the three supplied tarballs (`CORE_TGZ`/`SCAN_TGZ`/
  `CATALOG_TGZ` env vars, port 4199): started clean; served `aih-catalog-index` v1,
  **457 entries**, digest `sha256:9eb726d2…`; summary = coreTargets published with **11
  targets**, collections `aih-core` (9 members) + `aih-default-profile` (1 member), sidecars
  publisher/qualification/categories all published (428 entries; 457/457 qualified, signature
  verified, attestation absent; 12 categories, 365/457 curated); **acceptance sweep: all
  checks passed**; served page carries the expected placeholders.
- Repo net-zero after all runs: `tailwind.css` hash unchanged (`DF22C774…` — the CSS build is
  byte-identical to the checked-in file), `settings.v1.json` unchanged, `git status` shows no
  new changes beyond the two review files per run.

### 1.5 Core 0.6.2's own shipped documentation on this repo's scope [V]

Read verbatim from inside the supplied tarball (`core/package/docs/commands.md`) — published
package content, legitimate scope evidence under `AGENTS.md` rule 3:

- `:1022` — "The Policy Workbench browser and the `aih policy generate` command were removed
  in this greenfield cutover. **There is no `aih-ui` alternative.** Core retains the policy
  schema, validation, effective-state resolution, and governed command routes. It does not
  expose a public browser or a replacement authoring command. Administrators prepare policy
  and PolicyBundle V2 files outside the governed target, validate with `aih policy validate`,
  and supply an administrator-controlled protected file via `--policy <file>` or
  `AIH_ORG_POLICY`."
- `:1030` — "These are backend verification paths, not a retained browser UI."
- `:1034` — "The retired administrator-catalog Workbench preparation route is not a CLI
  command."

Also: `guides/portable-policy-delivery.md:89-93` — the `.aih-config.json` binding is "one
selected policy, not a hierarchy or a merge of multiple policies"; a recursive grep of every
public `.d.ts` finds no `checkPolicy`/`compilePolicy`/`policyTemplate`/`publishPolicy`/
determination/triage API (the operator decision vocabulary is
`disposition: "approved" | "accepted-with-conditions" | "rejected"`,
`org-policy/governance-decision-v2.d.ts:216,322,429`). This re-labels G1, G4, G17, G19 and
bounds G3/G8.

## 2. Implemented UI inventory (verified map)

One page, no routes: `src/index.html` (663 lines) is the only screen; `src/main.js` composes
shell + elements + ai-tools + organization + theme + onboarding + policy-import +
decision-import + policy-workspace + settings-client + catalog controller + governance
controller. Surfaces: top header (org modal, AI tools, three disabled actions, theme);
sub-header provenance strip; Sources rail + kind ledger + source header (3 disabled policy
controls `#source-btn-allow-all/-allow-exceptions/-hold-back`, `:187-190`) + filter row
(`src/catalog/toolbar.js`: search, All/Needs Review/Egress Out/Signals pills, sort, 6-kind
matrix); entry card grid; inspector with 4 tabs (Details `:291-314`, Security `:315-374`,
Governance `:375-553`, Policy JSON `:557-573`); dialogs (first-run setup, decision import,
saved setup, PolicyBundle import `:578-659`); error banner `:660`. Backend routes
(`tools/server/api.mjs:59-234`): workbench-settings (GET/POST/update/clients),
policy-bundle-structure, decision-structure, packages, subject, catalog-integrity, evidence,
validation-fixture, operator-file, observation, reopen, prepare, consume, saved. Data comes
only from the served catalog document (the reader's projection, not the raw index),
`summary.json`, the optional sidecars, and Core/Scan calls made server-side inside a
throwaway consumer holding only the three installed packages.

## 3. Consolidated gap register (G1–G20)

Legend per §0. Evidence anchors are file:line in the working tree unless a file is named.
"(this run)" = independently re-verified by this review, not just the parallel one.

| # | Reference capability (prototype / snapshot) | Actual UI behavior | Evidence | Dependency | Label | Completion criterion |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Policy authoring / curation screens (snapshot `authoring-sidebar`, `curation-editor`, `custom-editor`, `remote-custom-editor`, `ecc-mcp-editor`) | No authoring surface; only two read-only structure dialogs (PolicyBundle, Decision V2) | snapshot `:681-771`; `src/index.html:602-659`; `policy-import.js:24-35`; `decision-import.js:12-20` | Core docs: authoring browser removed, no `aih-ui` replacement (`commands.md:1022`); Catalog publishes an authoring-bundle subpath the UI does not consume | `DECISION` (recommend: record out-of-scope in `README.md`; do not build) | Owner decides; if in scope, name the published reader the UI would display through + one read-only screen |
| G2 | Artifact-intake workflow (`aih-artifact-intake` v1/v2; live `fetch("/api/artifact-intake/github-skill/prepare", …)`) | No route, no module, no screen | snapshot script lines 852–866 (47 `artifact-intake` occurrences); route table `tools/server/api.mjs:59-234` has no intake path; absent from all three tarballs' exports | Owner names the owning product | `DECISION` | `README.md` records what the snapshot had, why the Workbench doesn't serve it, who owns `/api/artifact-intake/*`; owner confirms retirement without it |
| G3 | Header actions Review Changes / Check Policy / Publish | All disabled with `title` reasons naming the missing contracts | `src/index.html:58-68` | No public check-policy/publish/compile API in core 0.6.2; `aih policy validate` is the real operator route | `BLOCKED-PKG` (+ `DECISION` on wording) | Each control either wired to a live path, or its title names the exact still-missing contract (could cite `aih policy validate` instead of implying one); re-check when new tarballs land |
| G4 | Policy JSON tab (authoring + diff + reset/copy/download) | Absence sentence + four disabled controls (Copy/Download/Reset Item/Apply) | `src/index.html:557-573` (viewer `:565`, controls `:561-562`, `:567`, `:568`); tab `:282` | Core publishes no compile/template contract; per `commands.md:1022-1024` the absence is the **intended end state**, not a pending release | `DECISION` (re-labelled from `BLOCKED-PKG`) | Either Core publishes a compile/template contract and the tab renders real bytes, or the tab is removed / left with a single explicit absence sentence and no controls implying a pending feature |
| G5 | Two separate pages (admin / user) — "Never one page with roles" | One workbench page with a role-specific workspace section | `prototype/index.html:226`; `user-start.html`, `user-trim.html`, `admin-org.html`; one document `src/index.html`; `policy-workspace.js` (65 lines) | Product decision, not a package | `DECISION` | Split as the prototype decided, or the decision is explicitly superseded in `README.md` with the reason |
| G6 | `npx @aihq/core --ui` folder-based page chooser | Absent; preview serves one page | `prototype/screens/entry.html`; `prototype/index.html:81-90,260` (marked a **proposal**) | Core CLI | `DECISION` (low priority) | Dropped from scope in `README.md`, or built only if Core publishes the argument |
| G7 | Scan review backlog + "Add your own source and scan it" (`admin-scan`, `admin-acme`) | Absent; findings are shown only inside Governance after operator verification | `prototype/index.html:139-160`; `src/index.html:479-515`; `tools/service/scan-verifier.mjs` | Scan owns execution (`README.md:16`); Catalog carries no per-entry verified scan | `DECISION` | Recorded in `README.md` as Scan-owned and outside the Workbench, or scoped as a display-only screen fed by a published findings reader |
| G8 | User trim (Required / Optional / Skip) + project policy file | Absent; no policy file is ever written | `user-trim.html`; `prototype/index.html:242,261-262,266` (name/format/merge rule open) | Core: the binding is "one selected policy, not a hierarchy or a merge" (`portable-policy-delivery.md:89-93`); no trim/merge contract exists | `DECISION` (becomes `BLOCKED-PKG` if a contract appears) | Format + merge rule published, then display + save exists; until then the repo records the gap and does not write policy files (a trim saved as `aih-org-policy.json` would replace the organization policy) |
| G9 | Security-tab telemetry: detector run state + finding detail | Two slots both show the identical visible "Not published"; the specific reasons live **only** in `title` attributes on non-focusable `div`s | `src/index.html:317-328`; `details.js:47-48` ("Not published: Scan publishes one detector per record and no per-detector run state."), `:169-170` (assigned to `title`); `absence.js:23-25` (Finding detail reason carries the Governance cross-reference) **(this run)** | None — presentation/a11y | `SAFE` | Move each reason into visible text or a described-by target, and word the two slots differently so a keyboard/screen-reader user can tell them apart |
| G10 | Numeric readouts (quota, leaks, token budget, counts) | No invented numbers: tiles render `Not published` for uncounted kinds; the one percentage is guarded; rail counts come from state; coverage returns `null`, not `0` | `metrics.js:25,33,41,46,56-59`; `navigation.js:197`; `publisher.js:66-77`; runtime spot-check in the log (I3) | None | `DONE` (closed — keep so it isn't re-opened) | — |
| G11 | `catalog-publisher.mjs` throws where its doc comment promises an `unavailable` report | Not user-visible: the caller converts the throw to a stated absence (`{state:"unavailable"/"absent", reason}`) and the page renders it | `catalog-publisher.mjs:11-12,23-25`; `core-service.mjs:120-126`; `preview.mjs:109-134`; `publisher.js:32-34` | None | Not a gap (optional comment/shape nit) | Optionally align the module's comment/return shape with its two siblings |
| G12 | Catalog load failure state | Banner only: the strip keeps "Connecting to the installed @aihq/catalog package…", masthead keeps `-`, the count keeps `…`, the grid stays empty — placeholders are never replaced on failure | `index-source.js:29-52` (`loadCatalog` throws); `main.js:84-86` (catch → banner only); `shell.js:159-163`; `index.html:86,180,182,212`; `cards.js:153-156` **(this run)** | None | `SAFE` | A failed load must replace the loading placeholders with the failure (or a named absence) as well as showing the banner. Trigger scope: reachable when the page cannot fetch `/catalog-index.json`/`summary.json` after a good start (the preview itself refuses to start on a broken collection view) |
| G13 | Catalog publishes artifact paths but not the containing directory | The UI derives the directory itself (bounded, validated) | `tools/service/catalog-access.mjs:106-111` (explicit `GAP:` comment) | A Catalog accessor for the entry content dir | `DECISION` (report) | Report the gap to the Catalog owner (as `README.md` does for other absent contracts); replace the derivation with the accessor when published |
| G14 | Framework descriptors (ECC / Superpowers / plugins) | Published by Catalog 0.3.0 but unused by the UI | snapshot `:559-572,758-771`; Catalog export subpaths + `readCatalogFrameworkDescriptorV1`/`readCatalogFrameworkPluginsV1`; none imported by the UI | Owner scope decision | `DECISION` (`SAFE` to build if scoped — the readers exist) | A read-only framework panel fed by the published descriptor reader, or a `README.md` statement that framework presentation is out of scope |
| G15 | Accessibility of the reworked markup (tabs, rail toggles, dialogs, disabled controls) | Markers present and deliberate (`role="tablist"/"tab"`, `aria-selected`, `inert`, `role="alert"`, `aria-live`) but behaviour unverified — no browser/DOM runner in this environment | `src/index.html:270,278-284,612,647,660` | A browser or DOM runner outside the repo | `UNCERTAIN` | Documented keyboard pass (rail → grid → tabs → dialogs, arrow keys) with `aria-selected` in sync with panel visibility and every disabled control's reason reachable without a mouse |
| G16 | Retiring the snapshot: what would actually be lost | The snapshot is static (0 `localStorage`, 0 `XMLHttpRequest`; 2 live `fetch` calls, both artifact-intake-related) → retiring loses presentation + the G2 workflow, and no package integration the live page has | probes in the log (I1); `TODO-cline.md` §3.2 | Dispositions of G1, G2, G4, G7, G8, G14 | `SAFE` to retire once dispositions are recorded | Every snapshot surface is mapped to implemented-in-`src/`, recorded-as-decision, or package-blocked — this register is that mapping |
| G17 | Role workspaces (Project / Organization / Developer policy) | Copy tells the operator to wait for "Core's published authoring and file contracts" / "Core supplies validation and serialization" — a contract Core's own docs say will not be published | `src/app/policy-workspace.js:10-12,19-21,28-30,46-54`; `commands.md:1022-1024` **(this run)** | None — copy only | `SAFE` | Reword to the real route ("authoring happens outside the governed target; validate with `aih policy validate` and supply the protected file") or state plainly that policy authoring is out of scope for this page |
| G18 | Sort control coverage | 5 of 8 implemented `SORT_KEYS` offered; `entryId-desc`, `sourceType`, `release` have no option | `src/catalog/selectors.js:1`; `#sort-select` (5 options); `check-page-contract` note **(this run)** | None | `DONE`/observation | Either the control gains the three keys, or the register keeps this as a deliberate narrowing (the reference shows only a sample "SORT: NAME (A-Z)" label — not lost design intent) |
| G19 | "Policy Determination" block in the Security tab | **Dead static markup**: a note + three disabled radios (`hold`/`false_alarm`/`allow_risk`) that no module ever touches — a second decision vocabulary living beside Core's `approved` / `accepted-with-conditions` / `rejected` | `src/index.html:349-370` (radios `:353,359,365`); grep over `src/**/*.js`: zero references; `org-policy/governance-decision-v2.d.ts:216,322,429` **(this run)** | Wording/scope (is per-finding triage a Workbench feature at all?) | `DECISION` (presentation only) | Align the block's words with Core's decision vocabulary and feed it from real state, or remove it / label it unmistakably as design-only with no controls implying a pending selection |
| G20 | "Needs Review" / "Egress Out" toolbar pills with counts | Rendered unavailable with `null` counts and stated reasons — no per-item scan result or Core disposition exists to derive counts from | `src/catalog/toolbar.js:4-9` (doc comment), `:34-37` (reasons incl. "no item declares egress, and an empty declaration is not a measurement of none"), `:107-112` (`reviewPill(…, null, false, null)` + summary chips); `README.md:386-393` **(this run)** | Per-item scan result / Core disposition (not in the supplied packages) | `BLOCKED-PKG` | Pills become live when the packages ship per-item disposition; until then the stated-reason rendering (already correct) stands |

Risk note for the register as a whole: nothing above requires inventing policy, catalog or
scan logic in this repo (`AGENTS.md` rule 3 / `README.md:14-17`). The worst possible defect
in a governance UI — an invented number — was checked and is absent (G10).

## 4. Safe, valuable work before retiring `aih-policy-workbench.html` (priority order)

1. **G17** — reword the three role workspaces (presentation only; the page currently tells
   operators to wait for a contract Core says will never come).
2. **G9** — make the two telemetry reasons visible and word the slots differently (a11y).
3. **G12** — a failed catalog load must replace the stuck "Connecting…" placeholders with the
   failure or a named absence.
4. **G19** — align or remove the dead "Policy Determination" block (DECISION first; either
   fix is presentation-only).
5. **G4 / G3** — decide remove-vs-keep for the four dead Policy JSON controls (per Core's
   docs the absence is the intended end state); keep each disabled header-action reason
   honest and re-check both against the incoming tarballs.
6. **G2, G1, G5, G6, G7, G8, G13, G14** — record dispositions in `README.md` so the
   retirement is a documented decision rather than a silent loss (G16).
7. **G15** — accessibility keyboard pass (needs a browser outside the repo).
8. **G18** — optional: offer the three unoffered sort keys or keep the narrowing on record.

## 5. Working hypotheses — resolution

- H1 (page renders exactly what README claims): verified for the spot-checked slots and all
  seven disabled-control reasons (accurate against core 0.6.2's public surface); residual =
  G15 runtime a11y.
- H2 (no data path reaches the page that bypasses a package public reader): verified —
  35-name import surface all public; served catalog document is the reader's projection.
- H3 (workbench HTML is fully static): verified with one exception — its two live `fetch`
  calls target the artifact-intake API (G2).
- H4 (every disabled control has a named reason): verified — all seven `title` reasons read
  and checked against core 0.6.2's public surface.
- H5 (preview starts cleanly against the supplied tarballs): **verified by execution**
  (this run, §1.4).
- H6 (`check-page-contract` + `node --test` pass on the working tree): **verified by
  execution** — 58/58, all contract checks passed.

## 6. Cross-check against the parallel Cline run

Agreed independently: tarball hashes; full import-surface resolution; the Core-docs scope
finding (verbatim match); 58/58 tests + page contract + acceptance sweep (each run executed
its own). Two discrepancies, recorded:

1. **Test fixture location.** The parallel run's safety precondition "the test suite writes
   only into OS temp directories" is inaccurate: `tools/tests/settings.test.mjs:11` writes
   fixtures to the in-repo, gitignored `.tmp/` (`mkdtemp` at `:17`, per-test cleanup at
   `:19-26`). Net repo effect is zero (`.tmp/` verified unchanged after 58/58 here), but the
   stated precondition was wrong.
2. **Served page byte count.** 51,071 (parallel run, raw) vs 51,087 (this run's copy via
   IWR + `Set-Content UTF8`) — a transcription artifact of this run's copy method, not a
   content difference (placeholder strings match at the same offsets).

## 7. Resume here

- [x] Environment facts, hashes, export-contract check (§1).
- [x] Reference inventories: snapshot (4 views, 174 ids, static + 2 live fetches) and
  prototype (11 screens, 5 notes, 38-row diff table).
- [x] Consolidated register G1–G20 with file:line evidence (§3); five items independently
  re-verified by this run.
- [x] H1–H6 resolved; runtime verification executed (§1.4).
- [x] Cross-check against the parallel run (§6).
- [ ] **Watch `packages/`** — no new tarballs as of ≈04:55 local 2026-09-26 and the ~5h
  window has elapsed (flag to owner). On arrival: re-hash, diff manifests + public exports
  against §1.1/§1.2, re-label G3, G4, G8, G13, G20 (and G2 if an artifact-intake contract
  appears). **Never install or replace.**
- [ ] **Owner decision list**: G1 (authoring out of scope — recommend yes), G2 (who owns
  `/api/artifact-intake/*`), G4 (remove vs keep the Policy JSON tab), G5 (two pages vs one),
  G6 (drop the `--ui` chooser), G7 (scan backlog/BYO = Scan-owned), G8 (user trim = no-merge
  by design), G13 (report content-dir gap to Catalog owner), G14 (framework panel in scope),
  G19 (align or remove the dead block).
- [ ] **G15** keyboard pass once a browser/DOM runner exists outside the repo.
- [ ] **G12** optional deepening: serve the run dir with a 404/503 on
  `/catalog-index.json` and confirm the served module graph cannot replace the placeholders.

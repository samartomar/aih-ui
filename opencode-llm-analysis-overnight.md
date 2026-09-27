# opencode-llm-analysis-overnight — iterations

Companion to `TODO-opencode.md` (the gap register). This file is the log: each iteration
records what was checked, what was found, what was corrected, what remains uncertain, and a
**Resume here** section. Both files are self-contained so work can resume after context
compaction.

**Standing rules for this run (unchanged):** read-only except `TODO-opencode.md` and
`opencode-llm-analysis-overnight.md` at the repo root. No package install/replacement, no
commit/push/release, no edits to `src/`, `tools/`, config, tests or lockfiles. Helper probe
scripts and extracted tarballs live in `C:\Users\samar\AppData\Local\Temp\opencode`
(outside the repo). Verified facts are marked **[V]**; inferences **[I]**.

Time base: local is UTC-05:00. Run started ≈21:00 local 2026-09-25. I0–I2 times are
approximate (from work sequence, not clock reads); I3 has a hard anchor: the preview's
served qualification stamp read `2026-09-26T09:47:33Z` (≈04:47 local 2026-09-26).

A **parallel independent run** by another agent exists in this repo: `TODO-cline.md` and
`cline-llm-analysis-overnight.md` (started ≈04:00 local 2026-09-26 = 09:00Z). It is treated
as a cross-check/falsification source, never as evidence by itself. Where it and this run
agree independently, that is noted in the register.

---

## I0 — first pass (≈21:00–22:00 local, 2026-09-25)

Checks: read `AGENTS.md`, `README.md`, `package.json`, `.gitignore`; listed the `src/` and
`tools/` trees; SHA-256 + sizes of the three `packages/*.tgz`; extracted each tarball to
`%TEMP%\opencode\pkg-inspect`; walked every `@aihq/*` named import used by `tools/service/*`
and `tools/scan-attribution-cases.mjs` and matched each against the public export maps
(following `export *` targets); read the core manifest peer ranges; `git status --short` /
`git log --oneline`; read the `prototype/index.html` guide.

Findings:

- Hashes (independently recomputed; later confirmed identical to the parallel run's):
  core 0.6.2 `20FD8B63…BD13` (2,721,925 B), scan 0.5.0 `A1524D78…043764` (966,963 B),
  catalog 0.3.0 `44292377…2D7D6F5` (7,233,312 B).
- Every imported package name resolves against the supplied tarballs' public exports.
  **Correction during I0:** a first scan of `core/dist/index.d.ts` alone reported five "missing"
  names (`governanceDecisionSourceDigestV2`, `governanceDecisionSubjectDigestV2`,
  `governanceDecisionDigestV2`, `parseGovernanceDecisionV2`, `parsePolicyBundle`); they are
  re-exported via `export *` from `dist/org-policy/governance-decision-v2.js` and
  `dist/org-policy/bundle.js`. Lesson recorded: **a name absent from `index.d.ts` is not
  absent from the package** — always follow re-export targets.
- Core peer ranges `@aihq/catalog >=0.3.0 <0.4.0`, `@aihq/scan >=0.5.0 <0.6.0` are satisfied
  by the supplied trio.
- Repo is a dirty working tree (HEAD `57986a0`): ~26 modified + 14 untracked paths; the review
  reads the working tree. `.aih-ui/settings.v1.json` exists (vibe experience) → the preview
  opens the saved-experience page, not the first-run wizard.
- Preview runtime path analyzed before any run: `tools/packages.mjs` rule 2 (supplied
  `CORE_TGZ`/`SCAN_TGZ`/`CATALOG_TGZ` tarballs are used as delivered — no checkout read,
  built or packed); `tools/build-css.mjs` writes exactly one file,
  `src/styles/tailwind.css` (gitignored); the run dir is `mkdtemp` under the OS temp dir.

Deliverable: `TODO-opencode.md` created (environment facts, export-contract check,
implemented-UI inventory map, gap skeleton G1–G15, hypotheses H1–H6).

Uncertainty at end of I0: skeleton gap items carry no file:line evidence yet; no runtime
verification; full prototype/snapshot inventories not yet done.

---

## I1 — reference inventories via subagents (≈22:00–23:30 local, 2026-09-25)

Three independent subagent passes (read-only):

**A — `aih-policy-workbench.html` (retiring snapshot).** 870 lines / 3.83 MB; markup+CSS on
≈lines 1–782 with 174 distinct element ids; the model and app are inline scripts
(`window.__aihWorkbenchModel` at line 785, ~3.11 MB; session/intake/projection helpers at
lines 852–866). Four views: Compose / Artifacts / Authoring / Imports. **0 `localStorage`,
0 `XMLHttpRequest`; 16 `fetch(` occurrences, of which 14 sit inside embedded JSON evidence
strings** (source snippets quoted in findings) and **2 are live code**: a POST to a variable
endpoint and `fetch("/api/artifact-intake/github-skill/prepare", …)`. The evidence block cites
`@aihq/core 0.6.2`, `@aihq/scan 0.3.0` (**older** than the supplied 0.5.0), catalog digest
`sha256:fdea69…`, report lock `sha256:bd7def…`. H3 (snapshot is static sample data) verified
with that one live-workflow exception.

**B — `prototype/` (Concept v3).** Guide + 11 screen files (`system`, `overview`, `entry`,
`admin-org`, `admin-sources`, `admin-item`, `admin-changes`, `admin-acme`, `admin-scan`,
`user-start`, `user-trim`) + 5 notes (`adoption`, `scope`, `decided`, `open`, `asks`);
`shell.js`/`user-shell.js`/`tokens.css`/`tw-config.js`/`wb.css`/`fonts.css`/`mode.js`. Load-
bearing statements: "Two separate pages: admin and user. Never one page with roles."
(`index.html:226`); the `npx @aihq/core --ui` folder chooser is explicitly a **proposal**
(`:81-90`, `:260`); the user trim's project-file name/format/merge rule is **open**
(`:261-262`, `:266`); sample numbers are marked "[n] marks a number nobody has yet" (`:40`).
The 38-row prototype→`src/` diff table was produced. **Process note:** the first subagent was
resumed after context compaction and the resume reported "already delivered" without the
content being captured; a **fresh** agent redelivered the full inventory successfully.

**C — `src/` verification.** README claims checked against code (the four absence words are
exactly `Not published` / `Not declared` / `Not supplied` / `Not connected`,
`src/app/absence.js:16-19`); a11y markers in `src/index.html` are present and deliberate
(`role="tablist"`/`tab` with `aria-controls`/`aria-selected`/`tabindex` at `:278-284`,
`aria-hidden`+`inert` on the collapsed inspector at `:270`, `role="alert"` banner at `:660`,
`aria-live="polite"` import statuses at `:612`, `:647`). Flagged for later: filter-pill
`aria-pressed` and the six-kind matrix tab roles/labels; disabled rail items as
`<a href="#">` focusability.

Findings folded into the register: the snapshot's live `fetch` target `/api/artifact-intake/*`
is **absent** from `tools/server/api.mjs` (route table) and from every supplied package's
public surface → gap **G2**. Workbench's older scan reference (0.3.0) recorded as snapshot
staleness, not a live dependency.

---

## I2 — cross-check with the parallel Cline run + targeted verification (≈00:00–01:30 local, 2026-09-26)

Found `TODO-cline.md` + `cline-llm-analysis-overnight.md` in the repo root (parallel
overnight agent; started 09:00Z). Read both in full.

**Agreements (independent):** tarball hashes identical; all `@aihq/*` imports resolve against
the supplied exports (their count: 35 distinct names); the Core-docs scope claim; their
runtime results (58/58 tests, page contract, acceptance sweep) were to be re-verified by this
run in I3 rather than trusted.

**Targeted verification reads (all by this run, [V]):**

1. **G19 (dead "Policy Determination" block).** `name="policy-choice"` occurs only at
   `src/index.html:353,359,365` — three `disabled` radios (`hold`, `false_alarm`,
   `allow_risk`) above the note "Not published: needs a Core determination contract. This
   page reads evidence and never records a decision." (`:349-370`). Grep over
   `src/**/*.js`: **zero module references** to the block or its inputs (only near-hit is the
   unrelated id `policy-start-description` at `src/app/policy-workspace.js:37`). Dead static
   markup confirmed.
2. **G17 (misleading workspace copy).** `src/app/policy-workspace.js:10-12` (vibe),
   `:19-21` (admin), `:28-30` (developer) — rendered at `:46-54` — promise "Core's published
   authoring and file contracts" / "Core supplies validation and serialization". Contradicted
   by Core's own shipped docs (below).
3. **G12 (stuck loading state).** `src/catalog/index-source.js:29-52`: `loadCatalog()` throws
   on fetch failure, non-OK, non-JSON, or format/version mismatch (`EXPECTED_FORMAT`
   `aih-catalog-index`, `EXPECTED_VERSION` 1). `src/main.js:84-86`: the catch only calls
   `shell.showError()` (banner text + unhide, `shell.js:159-163`). `provenance.render()` is
   reached only from `controller.render()` after a successful load → on failure the page keeps
   its placeholders forever: `index.html:86` ("Connecting to the installed @aihq/catalog
   package..."), `:180`/`:182` (masthead `-`), `:212` (count `…`, title "Loading the installed
   Catalog inventory."); the grid stays empty (`cards.js:153-156` never runs).
4. **G9 (telemetry slots).** `src/catalog/details.js:47-48`:
   `DETECTOR_RUN_STATE_ABSENT = "Not published: Scan publishes one detector per record and no
   per-detector run state."`; `details.js:169-170` assigns the two reasons **into `title`
   attributes** of `#detector-run-state` / `#detector-finding-detail`, which
   (`index.html:321-328`) are non-focusable `div`s both showing the identical visible word
   "Not published". `src/app/absence.js:23-25` `FINDING_DETAIL_ABSENT` carries the Governance
   cross-reference. So the reasons exist (Cline's first-pass "no reason" was too harsh) but
   are hover-only and indistinguishable by keyboard/screen reader.
5. **Core 0.6.2's shipped docs, read verbatim from the supplied tarball**
   (`core/package/docs/commands.md`):
   - `:1022` — "The Policy Workbench browser and the `aih policy generate` command were
     removed in this greenfield cutover. There is no `aih-ui` alternative. Core retains the
     policy schema, validation, effective-state resolution, and governed command routes. It
     does not expose a public browser or a replacement authoring command. Administrators
     prepare policy and PolicyBundle V2 files outside the governed target, validate with
     `aih policy validate`, and supply an administrator-controlled protected file via
     `--policy <file>` or `AIH_ORG_POLICY`."
   - `:1030` — "These are backend verification paths, not a retained browser UI."
   - `:1034` — "The retired administrator-catalog Workbench preparation route is not a CLI
     command."
   This is published package content, so it is legitimate scope evidence under `AGENTS.md`
   rule 3. It re-labels G1 (authoring screens: no published contract, contradicted by docs),
   G4 (Policy JSON tab: the absence is the intended end state, not a pending release), and
   G17 (the workspace copy promises a contract Core says will not come).

**Cross-check discrepancies (recorded, not silently applied):**

- Cline's I2 safety precondition "the test suite writes only into OS temp directories
  (`settings.test.mjs:16-27`)" is **inaccurate about location**: `tools/tests/
  settings.test.mjs:11` sets `testRoot = fileURLToPath(new URL("../../.tmp/", import.meta.url))`
  → **in-repo, gitignored `D:\dev\aih-ui\.tmp\`**; fixtures are `mkdtemp`'d there (`:17`) and
  removed per test by `t.after` (`:19-26`). Net repo effect is zero (this run observed
  `.tmp/` unchanged after 58/58), but the stated precondition was wrong.
- Served page size: Cline measured 51,071 bytes raw; this run's copy (IWR + `Set-Content
  UTF8`) is 51,087 bytes — an encoding-transcription artifact of this run's copy method, not a
  content difference (placeholder strings match at the same offsets).

Uncertainty at end of I2: G15 a11y (no browser available in this environment); G2 ownership
(owner's call); the DECISION items; everything about the upcoming packages.

---

## I3 — runtime verification (≈04:15–04:55 local, 2026-09-26; hard anchor 09:47:33Z)

Safety preconditions checked **before** running anything:

- `src/styles/tailwind.css` pre-hash `DF22C7741D075C390FE623277E914B02CCDBE753E07C0A48A8AFE3E9C9422FFC`
  — identical to the hash the parallel run measured **after** its own CSS rebuild → a rebuild
  is byte-identical, so the preview's only in-repo write is a no-op. Verified unchanged after
  every run this pass.
- Root `node_modules` exists (no `@aihq/*` in it — the preview installs into a throwaway
  consumer under OS temp).
- `CORE_TGZ`/`SCAN_TGZ`/`CATALOG_TGZ` set to the three `packages\*.tgz` so the supplied
  tarballs are used as delivered (`packages.mjs` rule 2), not sibling checkouts.
- `.tmp/` already existed in-repo (gitignored; owner's 9/25 runs left `npm-cache/`); the
  settings-test fixtures write there and self-clean (see I2 discrepancy), so the documented
  test suite leaves the repo net-zero.

Checks and results (all [V], this run's own processes):

| Check | Result |
| --- | --- |
| `node --test "tools/tests/*.test.mjs"` | **58 pass, 0 fail**, 343 ms |
| `node tools/check-page-contract.mjs` | **all checks passed** (123 relative imports resolve, 7 page assets, module entry point, 400/403/containment classification); note re-confirmed: "3 SORT_KEYS the page offers no option for: entryId-desc, sourceType, release" (5 options, 8 keys) → G18 independently verified |
| Preview startup | started from the three supplied tarballs; log: `core 20fd8b63… (supplied-tar)`, `scan a1524d78… (supplied-tar)`, `catalog 44292377… (supplied-tar)`; consumer installed under `%TEMP%\aih-ui-preview-UPvZW2`; 54 page files served |
| Served catalog | `aih-catalog-index` v1, **457 entries**, digest `sha256:9eb726d2…` |
| `/summary.json` | `packages` = core 0.6.2 / scan 0.5.0 / catalog 0.3.0 carrying the supplied sha256s; `coreTargets` **published, 11 targets** (`claude, codex, cursor, antigravity, gemini, copilot, windsurf, opencode, zed, kimi, kiro`); collections `aih-core` (9 members, core 0.6.2) + `aih-default-profile` (1 member, catalog 1.0.0); sidecars `publisher` / `qualification` / `categories` all **published** (publisher 428 entries: description 421, title 390, category 3; qualification 457/457, signature verified, attestation absent; categories 12 curated, 365/457 curated) |
| `node tools/acceptance-sweep.mjs <preview-url>` | **all checks passed** (fresh session holds exact bytes; unknown session refused; malformed JSON refused; no filesystem location in any of the 12 inspected answer bodies; prepare/consume/reopen semantics per the six statuses) |
| Served page `GET /` | 51,087 bytes (this run's copy); still carrying the placeholders `Connecting to the installed @aihq/catalog package…` (`:86`) and `Loading the installed Catalog inventory` (`:212`) |

Post-run repo-state checks [V]: `.aih-ui/settings.v1.json` SHA-256 unchanged;
`src/styles/tailwind.css` SHA-256 unchanged (`DF22C774…`); `git status --short` lists exactly
the pre-existing changes plus the two files of each review run — no new modifications from any
check in this pass. The preview run dir remains under OS temp (not deleted, consistent with
this run's no-deletion rule; removable by hand).

Findings: H5 and H6 verified by direct execution. G10's residual runtime uncertainty is
cleared — every numeric surface observed traces to served state (11 targets, 10 current of 457
across the two collections, 428/457/365 sidecar counts, 58 tests). G18 independently re-
confirmed. G12's trigger space matches the parallel run's refinement: the preview **refuses to
start** when the installed Catalog has no readable collection view, so the stuck-placeholder
state is reachable when the *page* cannot get `/catalog-index.json` / `/summary.json` after a
good start (server stopping mid-session, proxy, future split deployment) — the defect stands,
the trigger is narrower than a naive reading implies.

---

## I4 — consolidation and final pass (≈04:55 local, 2026-09-26)

Checks: re-listed `packages/` (still exactly the three tarballs; timestamps 9/24 02:47 and
9/25 03:08 local — **no new packages have arrived**); two final evidence greps
(`src/catalog/toolbar.js` for the Needs Review / Egress Out pills; `src/catalog/details.js:44-57`
verbatim for the telemetry absence strings); consolidated the register.

Findings:

- **The ~5h window the owner gave for new packages has elapsed** without arrival (run started
≈21:00 local 9/25; now ≈04:55 local 9/26). Flagged in `TODO-opencode.md` §1.1. If the clock
was meant to start from the owner's build run rather than this review, the watch continues;
the re-hash/re-label protocol in §7 is live either way.
- **New gap G20 (this run):** the toolbar's "Needs Review" and "Egress Out" pills are rendered
  unavailable with `null` counts and stated reasons — `src/catalog/toolbar.js:4-9` (doc
  comment), `:34-37` (`UNAVAILABLE["Egress Out"] = "Not published: no item declares egress, and
  an empty declaration is not a measurement of none."`), `:107-112` (`reviewPill(…, null,
  false, null)` + summary chips). No per-item scan result or Core disposition exists in the
  supplied packages, so the pills cannot carry counts. `BLOCKED-PKG`; the stated-reason
  behaviour is already correct.
- Final register = G1–G19 (consolidated from the two parallel inventories, all
  evidence-anchored, the five items this run independently re-verified marked as such) + G20.
  Labels closed this pass: G10 `DONE`; G11 not a gap (comment nit); G4 re-labelled
  `BLOCKED-PKG` → `DECISION` (Core docs: the absence is the intended end state); G9, G12, G17,
  G18, G19 converted to verified with file:line evidence.

Corrections made this pass: none to earlier iterations (the I0 `export *` correction and the
I2 fixture-location discrepancy stand as recorded).

Remaining uncertainty (deliberate, not dressed up as findings):

- **G15 (a11y keyboard pass)** — unverifiable in this environment: no `playwright`, no DOM
  runner. Static markers look deliberate; a declaration is not behaviour.
- **G2 ownership** of `/api/artifact-intake/*` — the owner's to name; recorded, not built.
- **DECISION items** (G1, G4, G5, G6, G7, G8, G13, G14, G19) — product decisions by nature.
- **Upcoming packages** — nothing verifiable until they appear; supplied facts were treated as
  given and never silently replaced.

---

## Resume here

1. **Watch `packages/`.** No new tarballs as of ≈04:55 local 2026-09-26 and the ~5h window has
   elapsed. When tarballs appear: SHA-256 each, read `package.json` (name/version/peer
   ranges) and the public `dist/*.d.ts` export maps, diff against `TODO-opencode.md` §1.1/§1.2,
   and re-label G3, G4, G8, G13, G20 — and G2 if an artifact-intake contract appears.
   **Never install or replace.**
2. **Owner decision list** (each needs a recorded disposition in `README.md` before the
   snapshot is retired): G1 (authoring out of scope? recommend yes), G2 (who owns
   `/api/artifact-intake/*`?), G4 (remove the Policy JSON tab or keep one absence sentence?),
   G5 (two pages vs one — supersede the prototype decision?), G6 (drop the `--ui` chooser?),
   G7 (record scan backlog/BYO as Scan-owned?), G8 (user trim — record as no-merge by
   design?), G13 (report the content-dir gap to the Catalog owner), G14 (framework panel in
   scope?), G19 (align the dead block's vocabulary with Core's, or remove it).
3. **G15** — if a browser/DOM runner can be obtained outside the repo: documented keyboard
   pass (rail → grid → tabs → dialogs, arrow keys, `aria-selected` in sync with panel
   visibility, every disabled control's reason reachable without a mouse).
4. **G12 optional deepening (no browser needed):** serve the preview run dir from a
   throwaway static server answering 404/503 for `/catalog-index.json` and confirm the served
   module graph cannot replace the placeholder text (control-flow proof already exists at
   `main.js:84-86` / `index-source.js:29-52`).
5. The two SAFE-priority fixes worth doing before retirement (presentation only, no package
   logic): **G17** (reword the three role workspaces to the real route: author outside the
   governed target, `aih policy validate`, protected file — `policy-workspace.js:10-12,19-21,28-30`)
   and **G9** (make the two telemetry reasons visible and word the slots differently —
   `details.js:47-48,169-170`, `index.html:317-328`).
6. Stop condition: a full pass over §3 of `TODO-opencode.md` adds no new evidence. Do not
   manufacture findings to keep the loop alive.

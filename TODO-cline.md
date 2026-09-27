# TODO-cline — overnight read-only review of aih-ui (Policy Workbench)

Run: overnight, started 2026-09-26 (local), read-only. **Write limit: only
`TODO-cline.md` and `cline-llm-analysis-overnight.md` at the repo root may be
created or updated.** No source, HTML, config, test, lockfile or package edits;
no installs; no package replacement; no commits, pushes, releases or deletions.
Analysis probes were written to `%TEMP%` (outside the repo); package tarballs were
extracted to `%TEMP%\aihpkg` only.

Pass 3: 2026-09-27 01:41 (local), same two-file write limit; Core was replaced again while the
repo sat idle, extracted to `%TEMP%\aihpkg4`. **Read §0A first** (run 3), then §0 (run 2);
§§1–8 are the run-1 register.

Task: compare `prototype/` (Concept v3 design reference) and
`aih-policy-workbench.html` (retiring standalone snapshot) against the actual
implementation in `src/` (+ the `tools/` preview backend), and record every gap
with user-visible behavior, evidence (file:line), dependency, risk and a concrete
completion criterion. Labels:

- `SAFE` — buildable now with the three supplied packages
- `BLOCKED-PKG` — waits on a package release (run-1's "~5h, not arrived" note is stale: runs 2–3
  replaced the Core tarball twice; the current package state is §0A)
- `DECISION` — needs a product decision from the owner
- `DONE` — already implemented in `src/`
- `UNCERTAIN` — not yet verifiable from static evidence

Verified fact is **[V]** with a command or file:line behind it; inference is **[I]**.
No runtime claim is made from static markup alone.

---

## 0A. RUN 3 — Core rebuilt in place; Catalog and Scan untouched (started 2026-09-27 01:41 local)

Third overnight pass, same write limit (only this file and `cline-llm-analysis-overnight.md`);
no installs, no package replacement, no source/config/test/lockfile edits, no commits. The new
Core tarball was extracted read-only to `%TEMP%\aihpkg4` and diffed against run 2's extraction at
`%TEMP%\aihpkg3`. **§0A supersedes §0.1's core row and renumbers the `commands.md` citations in
§0.5/§0.6; everything else in §§1–8 stands.**

### 0A.1 Package state at run 3 — the brief's facts are stale [V]

| Tarball | Manifest | Size (B) | SHA-256 (computed 2026-09-27 01:49) | vs run 2 |
| --- | --- | --- | --- | --- |
| `aihq-core-0.7.0.tgz` | `@aihq/core@0.7.0` | 2,711,301 | `76058709830F00C49CC608250B3BED2B32B2EABC9CCCAA71C3969F0268669358` | **replaced build**; run 2 read 2,886,462 B / `C9F17E16…`; same version string, different bytes; mtime `2026-09-26 23:41:53` |
| `aihq-catalog-0.3.0.tgz` | `@aihq/catalog@0.3.0` | 6,923,925 | `377E38DEC71C91C65F8A5C0893C35CFCC36F3433306C5C59D81409E115BC33BA` | byte-identical to run 2 (run 1's build was `44292377…`) |
| `aihq-scan-0.5.0.tgz` | `@aihq/scan@0.5.0` | 966,963 | `A1524D78127CCF8BFF4521D58301108804FDFCFB5DD260A707ACF5F1D9043764` | byte-identical to runs 1–2 |

- The brief's `aihq-core-0.6.2.tgz` still does not exist here (facts about `c00248ef`/"upgraded
  analyzers" are unverifiable from this checkout); the supplied Core is a **second 0.7.0 build**.
- The D50 "nothing blocks" change the brief says is missing from 0.6.2 **is present** — see §0.2;
  the CHANGELOG carrying it is byte-identical across both 0.7.0 builds [V].
- "Scan is the final pack4 candidate": present and unchanged for three runs; the pack4 label stays
  an owner fact [I], not independently verifiable from the tarball.
- "Catalog unchanged": true **since run 2 only** (run 1 reviewed different bytes — §0.1).
  "Requalified Catalog not built yet" is consistent with the supply — nothing newer on disk, so
  §0.4's missing `aih-core` collection stands (owner question 2 still open).
- Watch for further arrivals: re-hash before relying on this table.

### 0A.2 Contract diff, run-2 Core build (`C9F17E16`) → run-3 build (`76058709`) [V]

77 files changed (+4,546 / −18,462), 754 → 740 files (`git diff --no-index` over the two
extractions). **Byte-identical (hash-compared):** `dist/index.d.ts` — the public type surface, so
every §0.5 import-surface conclusion carries over unchanged; `CHANGELOG.md` — D50 (§0.2) verbatim;
`schemas/aih-governance-decision-v2.schema.json` (`7FDF101568CD7CAA…`) and
`schemas/aih-organization-evidence-envelope-v1.schema.json` (`88C0A36E91772016…`) — exactly the
digests §0.3 recorded, so the Scan contract lock is unaffected [V]. `package.json` keeps version
0.7.0, the same `exports` map (the diff touches `files[]` and `scripts[]` only), and the same
fixture pins: `aihq-scan-0.5.0-a1524d78.tgz` (the supplied Scan) and `aihq-catalog-0.3.0-c8e2c03.tgz`
(still **not** the supplied `377e38de` Catalog — owner question 2). `dist/index.js` export names:
256 vs 256, set-identical (parsed tails) — no export gained or lost. `guides/**` byte-identical,
so `guides/enterprise-admin-guide.md:54` and `guides/portable-policy-delivery.md:89-93` hold as-is.

**What actually changed:** the ECC installer removal (most `dist/ecc/*` install/materialization
modules deleted, `packages/framework-ecc/dist/index.js` −12.9k lines, the `check:ecc-installer`
script dropped); `docs/governed-mcp.md:47-56` now says ECC installation is developer-managed
("aih no longer projects governed ECC content or installs ordinary ECC content"); the root
`README.md`'s ECC sections rewritten (top unchanged); `docs/commands.md` reflowed (310 lines).
None of it is UI-facing: the UI imports no ECC module, no export was lost, the page's framework
matrix renders Catalog data (Catalog byte-identical), and Core still ships
`dist/catalog-package/framework-descriptors.d.ts` (G14's premise holds) [V].

### 0A.3 `docs/commands.md` line numbers moved — run-3 mapping [V]

| Quote | run-2 build (as cited in §0.5/§0.6) | run-3 build now on disk |
| --- | --- | --- |
| "Policy Workbench browser … there is no `aih-ui` replacement" | `:1031` | **`:794`** |
| "retained `compilePolicy` … Core/build-time APIs, not public" | `:1024` | **`:796`** |
| "retired administrator-catalog Workbench preparation route is not a CLI command" | `:1034` | **`:806`** |
| lifecycle `aih policy bind\|rebind\|revoke` (G8 cites 0.6.2's `:990-1018`) | ≈`:1000+` | **`:766-790`** |

§1's citations keep their 0.6.2 numbering as a historical record; use this table for the tarball
now on disk. A heading-level diff of `commands.md` shows no new `aih policy` commands (only
`aih policy project` wording changed), so no blocked gap opens or closes.
`guides/enterprise-admin-guide.md:54` was re-verified verbatim in the run-3 extraction.

### 0A.4 State of the register, run 3

- **No label changes [V]:** contract identity (§0A.2) means §0.5's revisions stand verbatim.
  G1/G3/G5/G13/G18 remain `BLOCKED-PKG` (no `check-policy`, `publish`, `determination`,
  artifact-intake or compile contract at the package root); G17, the D50 sentence, G9 and G12
  remain §0.6's priority order — item 1's citation is now `commands.md:794`.
- **Repo state [V]:** no tracked file modified since run 2 (mtime scan + `git status`);
  status = 26 modified + 16 untracked collapsed paths (90 files with `-uall`). Run 2's log
  recorded 44 (26+18): two collapsed untracked paths are unaccounted — untracked deletions leave
  no trace, `.gitignore` is unchanged, and no gap evidence depends on them (uncertain, low
  materiality).
- **Tests [V] (2026-09-27 01:47):** `node --test` on the 8 non-settings files → **41 pass, 0 fail**
  (reproduces run 2); `settings.test.mjs` excluded because it writes the repo's `.tmp/`
  (file count 31 → 31 across the run); git status unchanged. The suite loads no package
  (`node_modules/@aihq` absent, lockfile has 0 `@aihq` entries; probing
  `tools/service/policy-review.mjs` → `ERR_MODULE_NOT_FOUND`), so it does **not** exercise the
  new Core build.
- **No runtime evidence in run 3:** the preview npm-installs the tarballs
  (`tools/packages.mjs:186-211` `installConsumer`) and rewrites gitignored
  `src/styles/tailwind.css` via `buildCss` (`tools/preview.mjs:35`) — both outside this run's
  write/install rules, so no preview or browser run was attempted; every page-behaviour claim in
  this register remains static-only [I].

---

## 0. RUN 2 — the new packages arrived (started 2026-09-26 06:50 local)

Second overnight pass. Same write limit as run 1: only this file and
`cline-llm-analysis-overnight.md` at the repo root may be created or updated — no source, HTML,
config, test, lockfile or package edits, **no installs and no package replacement**, no commits,
pushes, releases or deletions. Probes were written to `%TEMP%` (`aihprobe2.mjs`…`aihprobe4.mjs`);
the tarballs were extracted read-only to `%TEMP%\aihpkg` (run 1: core 0.6.2 + the run-1 Catalog)
and `%TEMP%\aihpkg3` (run 2: core 0.7.0 + the repacked Catalog + Scan). Read §0A first (run 3), then §0; §§1-8 are
the run-1 register and still stand except where §0.5 revises a label.

### 0.1 Package change event — two owner-supplied facts are now stale [V]

`packages/` no longer holds what run 1 reviewed or what the brief described:

| Tarball | Manifest | Size (B) | SHA-256 (computed run 2) | vs run 1 |
| --- | --- | --- | --- | --- |
| `aihq-core-0.7.0.tgz` | `@aihq/core@0.7.0` | 2,886,462 | `C9F17E1671DEE4ADC05B2F87855CDEE0C4C96DF0A0B432C335E35BFB2FEF9406` | **new file**; `aihq-core-0.6.2.tgz` (`20FD8B63…`, 2,721,925 B) is gone |
| `aihq-catalog-0.3.0.tgz` | `@aihq/catalog@0.3.0` | 6,923,925 | `377E38DEC71C91C65F8A5C0893C35CFCC36F3433306C5C59D81409E115BC33BA` | **replaced**: run 1 read 7,233,312 B / `44292377…` — same version string, different build |
| `aihq-scan-0.5.0.tgz` | `@aihq/scan@0.5.0` | 966,963 | `A1524D78127CCF8BFF4521D58301108804FDFCFB5DD260A707ACF5F1D9043764` | byte-identical to run 1 |

Timestamps: core `2026-09-26 06:05:44`, catalog `2026-09-26 06:06:42`, scan `2026-09-25 03:08:16`
local [V: `Get-ChildItem packages | Select LastWriteTime`]. This run installed, replaced, deleted
and committed nothing. **Run 3 replaced the Core tarball again at `2026-09-26 23:41:53`; §0A.1
supersedes this table's core row.**

- The supplied Core is **0.7.0, not 0.6.2**; the brief's core facts (and G1/G3's citations to
  0.6.2) are superseded by §0.5.
- The supplied Catalog is **a different build** from the one run 1 reviewed, at the same version
  string; "Catalog 0.3.0 unchanged" is no longer accurate.
- Core 0.7.0's own `devDependencies` pin `tests/fixtures/packages/aihq-scan-0.5.0-a1524d78.tgz`;
  the provided Scan hashes to `A1524D78…`, so the supplied Scan is the build Core 0.7.0 was
  validated against [V].
- The same list pins `tests/fixtures/packages/aihq-catalog-0.3.0-c8e2c03.tgz`. If that suffix is
  a digest prefix (as the Scan name implies), the provided Catalog (`377e38de…`) is **not** the
  Catalog Core 0.7.0 pins [I — inference from a naming convention, not a digest comparison].

### 0.2 The "nothing blocks" change IS in this Core [V]

`core/package/CHANGELOG.md` (0.7.0 section): "**Findings are labels; nothing blocks on them
(D50).** Exact signed evidence about a component's bytes authorizes it whatever the analyzers
found, and its findings and evidence problems travel as labels on the verification result, the
install plan, receipts, and the governance and policy views." The same section states the
behaviour change "**`aih trust scan` and `aih skill vet` exit 0 on findings and evidence problems
(D66)**", with a new opt-in `--fail-on findings|evidence-problems`. The owner's note that the
change was not included applies to 0.6.2, which is no longer the supplied package.

### 0.3 The three packages still agree at the byte level that matters [V]

Scan 0.5.0's compatibility lock (`scan/package/dist/core/core-contract-lock-v2.js`) accepts two
Core contracts — `6130dd83…`/`27295aee…` and `c3174160…`/`7fdf1015…` — plus one
organization-evidence-envelope digest `88c0a36e…`. Core 0.7.0's
`schemas/aih-governance-decision-v2.schema.json` hashes to `7fdf1015…` and its
`schemas/aih-organization-evidence-envelope-v1.schema.json` to `88c0a36e…`: **both are
accepted**, so the Strict V2 gate still admits the new Core with the supplied Scan. Run 2's probe
also found **35/35 named imports and 5/5 namespace members** used by `src/` and `tools/` still
resolve in the new packages (`%TEMP%\aihprobe2.mjs`). Core 0.7.0's policy schema still carries
`schemaVersion` const `2` and `minimumCoreVersion` ∈ {`0.6.0`, `0.7.0`}, so the page's example
authority (`tools/service/validation-fixture.mjs:79`, `:84`) remains valid.

### 0.4 The repacked Catalog drops every Core-derived entry [V — highest-priority new finding]

Measured from the two payloads (`%TEMP%\aihprobe3.mjs`, `%TEMP%\aihprobe4.mjs`):

| | run-1 Catalog (`44292377…`) | run-2 Catalog (`377e38de…`) |
| --- | --- | --- |
| index entries | 457 (`aih` 28, `github` 428, `npm` 1) | 431 (`github` 429, `npm` 1, `aih` **1**) |
| collections | `aih-core` (@aihq/core 0.6.2, 9 members, origin `package-file`) + `aih-default-profile` | `aih-default-profile` only |
| `defaults/workbench/` seeds | includes `aih/`, `aih-core-0.6.1/`, `aih-core-0.6.2/` | none of those three |
| Superpowers pin | `b36e0829…` | `5bf4e780…` (the version Core 0.7.0 requires) |

The 27 removed entries are exactly the Core-derived ones (`agent.aih.governance-quality{,core-0-6-1,core-0-6-2}`,
`agent.aih.review-quality…`, the six `mcp.aih.*` groups, `skill.aih.docs-quality…`); one entry was
added (`skill.superpowers.diagnosing-superpowers`). ECC's pin is unchanged (`5064474d…`). The
qualification sidecar, core-qualification, signed catalog and signer root are byte-identical;
presentation, categories and runtime descriptors differ.

Why this matters to the page, by the page's own rule: `src/catalog/collections.js:32-55`
(`applyCollections`) treats an entry as current only when its source type is collected **and** a
collection names it with the same subject digest. With `collectedSourceTypes: ["aih"]` and only
`aih-default-profile` left, the Core content surface is gone: the `aih-core` collection row that
`src/catalog/navigation.js:5-15` renders disappears, and the rail's "content release" marker on
it (`README.md:261`) has nothing to mark. Run 1's preview data (457 entries, `aih-core`
9 members) no longer describes what the page will read. The Catalog was nonetheless built *after*
Core 0.7.0 (its Superpowers pin moved to the version 0.7.0 requires), so the Core collection was
lost in the rebuild rather than held back deliberately [I, from the pins; the Catalog owner should
confirm]. **Not buildable in this repo** — the seeds and the collection input are Catalog's.

### 0.5 Label revisions against the new packages [V]

- **G1, G17 and the Security tab's `detector-finding-detail` copy** — verdict unchanged, better
  evidence. Core 0.7.0 still says it supplies no replacement: `docs/commands.md:1031` (run-2 numbering; the run-3 tarball on disk renumbers it to **:794**, §0A.3) ("there is
  no `aih-ui` replacement") and `guides/enterprise-admin-guide.md:54` ("Core no longer supplies a
  Policy Workbench browser, the former policy generator, **an artifact-intake form**, or a
  replacement authoring command"). G17's criterion (name the real route instead of a contract that
  will not come) is the only honest wording; still **`SAFE`** (copy only).
- **G2 (artifact intake)** — stays `DECISION`. Core 0.7.0 keeps an artifact-intake module
  (`dist/trust/artifact-intake.d.ts`, `parseArtifactIntakeText`, V1/V2 schemas) but it is **not
  reachable**: the `exports` map publishes only `.`, `./framework-host`, `./schemas/*.json`,
  `./package.json`, and `dist/index.d.ts` does not re-export `trust/*` [V]. The guide above also
  closes who owns the removed form.
- **G3 (disabled `Check Policy` / `Publish` / `Review Changes`)** — stays `BLOCKED-PKG` + wording
  `DECISION`. Recursive grep of core 0.7.0's public `.d.ts`: **0** hits for `checkPolicy`,
  `check-policy`, `reviewState`, `publishPolicy`, `publishOrganization`, `sourcePolicy`,
  `policyTemplate` [V].
- **G4 / G1's "no compile contract"** — reconfirmed precisely: `compilePolicy` and
  `compileOrganizationManifestV1` still exist but only under `dist/org-policy/workbench/**`, which
  the exports map does not reach [V]. The Policy JSON tab's absence text is the intended end
  state: keep `DECISION`/`SAFE`, do not wait for a later release.
- **G19 (dead "Policy Determination" radios)** — unchanged `DECISION`. Core 0.7.0 has no
  `determination` symbol and no triage API; the only `triage` hits are a SARIF comment and a report
  template string [V].
- **G11/G12/G14/G15** — untouched by the package change (G11 comment nit, G12 a verified
  `src/` code-path defect, G14's framework descriptors still ship, G15 still needs a browser).
- **New dependency note** — nothing in the run-1 register becomes buildable *because* of Core
  0.7.0. The one behaviour change inside this repo's scope (D50, findings are labels) is a
  presentation rule the page already obeys implicitly (no `blocks`/`gate` wording anywhere in
  `src/` [V: grep]) but never states; that is §0.6 item 2.
- **Catalog-version note** — the UI's Catalog readers (`readCatalogContentV1`,
  `readCatalogCollectionsV1`, qualification / categories / publisher) are all still exported by the
  repacked 0.3.0 tarball [V: probe], so no import or contract break follows from it; only the
  payload changed (§0.4).

### 0.6 What is safe to build now, in priority order (before retiring the snapshot)

1. **G17 copy** — replace the three role-workspace promises ("need Core's published authoring and
   file contracts") with the real route (`aih policy validate`, authoring outside the governed
   target), now backed by `docs/commands.md:1031` (run-3 build: **:794**, §0A.3) and
   `guides/enterprise-admin-guide.md:54`. Presentation only; highest trust value.
2. **D50-aligned wording in Governance** — one sentence where the verdict and findings are shown:
   a finding is a label, signed evidence is what authorizes content, and this page records no
   decision. Presentation only, and it is the mismatch the new Core introduces [V: CHANGELOG D50
   vs the page saying nothing either way]. Verified insertion points: the `govVerdict` readout
   beside `executionSentence` (`src/governance/verdict.js:104-118`, rendered from `:34-76`) and the
   Security tab's finding slot (`src/index.html:319-326`).
3. **G9** — make the two telemetry refusal reasons visible and distinct instead of hover-only.
4. **G12 then G11** — replace the stuck "Connecting…" placeholders when the Catalog load fails
   (`index-source.js` failure path never reaches `provenance.render()`); tidy
   `catalog-publisher.mjs`'s comment and its `absent` shape.
5. **G3/G4 wording, G19 dead block, G5/G6/G13/G18** — decisions the owner can take with no package
   work.
6. **G2, G7, G8, G14** — record in `README.md` what the snapshot had and that it stays out of
   scope, so retiring `aih-policy-workbench.html` is a documented decision rather than a silent
   loss.

**Do not build** authoring, artifact intake, publish, check-policy, determination or compile UI:
neither 0.6.2 nor 0.7.0 publishes those contracts, and Core's own docs say there is no `aih-ui`
replacement for the removed browser, generator or intake form.

### 0.7 Resume here (run 2)

1. Re-check `packages/` before every further pass. On any new tarball: SHA-256 it, compare its
   `dist/*.d.ts`, the Scan lock constants and the Catalog defaults with §0.1-§0.4, then revise
   §0.5. Never install or replace.
2. Confirm with the owner (a) whether `377e38de…` is the intended Catalog build and (b) whether the
   missing `aih-core` collection and the 27 Core entries are expected (§0.4). Until then, expect a
   preview run to show only Catalog's own default profile in the collection rail.
3. Verify the two §0.6 presentation items against the rendered page when a browser is available;
   today they are code-verified only.
4. Then continue run 1's §7 list: the still-unread `src/governance/*`,
   `src/catalog/{entry,selectors,navigation,toolbar,view-state,collections,categories,
   qualification}.js` and `src/app/{onboarding,setup-model,organization,theme,dom,elements}.js`, and
   confirm or drop G15's accessibility list.

## 1. Verified environment facts [V]

### 1.1 Repo baseline

- Branch `main`, HEAD `57986a0` [V: `git log --oneline`]. The working tree is dirty:
  24 modified files and 13 untracked paths at run 1 (re-counted in run 2 as **26 modified + 18
  untracked = 42 `git status --porcelain` lines**, the same set: the run-1 count was low, not a
  new change — run 2 edited no tracked file, see §0.7 and the log's I5), including all of
  `prototype/`,
  `aih-policy-workbench.html`, `TODO-opencode.md`, `src/app/policy-workspace.js`,
  `src/app/policy-import.js`, `src/app/decision-import.js`,
  `tools/service/policy-review.mjs` [V: `git status --short`]. This review reads the
  **working tree**, not HEAD.
- `AGENTS.md` (6 rules) governs; `CLAUDE.md` is one line: `@AGENTS.md` [V]. Rule 3 is
  load-bearing here: if the UI needs something unpublished, **stop and report the gap**.
- Root `node_modules` holds **no** `@aihq/*` package [V: `Get-ChildItem node_modules` →
  only `@alloc`, `@jridgewell`, `@nodelib`, `@tailwindcss`]. Nothing in this repo imports
  the packages directly; the preview installs them into a throwaway consumer
  [V: `README.md:795-797`].

### 1.2 Supplied tarballs, re-hashed this run (independent of the owner's facts)

**RUN 2 SUPERSEDES THIS TABLE — see §0.1 for the current, re-hashed facts.** What run 1 read
(kept so the two passes can be compared):

| Tarball at run 1 | Manifest | Size (B) | SHA-256 (computed run 1) |
| --- | --- | --- | --- |
| `packages/aihq-core-0.6.2.tgz` (now removed) | `@aihq/core@0.6.2` | 2,721,925 | `20FD8B632DF3AB5E10FB11F47F3EC16AC1FFE389209E0FE3ECE983AD9E25BD13` |
| `packages/aihq-scan-0.5.0.tgz` (unchanged) | `@aihq/scan@0.5.0` | 966,963 | `A1524D78127CCF8BFF4521D58301108804FDFCFB5DD260A707ACF5F1D9043764` |
| `packages/aihq-catalog-0.3.0.tgz` (replaced) | `@aihq/catalog@0.3.0` | 7,233,312 | `442923773A0FA7FF2C17F44CB94C4E97BAF0CAF19BB1A911530045F9B2D7D6F5` |

Those matched `TODO-opencode.md` §1.1, computed independently [V]. No fourth tarball existed
then or now [V: directory listings].

Owner-supplied facts at run 1, recorded as given: core 0.6.2 = Core from `c00248ef`, upgraded
analyzers, **without** the "nothing blocks" change; scan 0.5.0 = final Scan candidate pack4;
catalog 0.3.0 = unchanged, requalified Catalog not built yet; new packages expected in ~5 hours.
**Run 2 update [V]:** core 0.6.2 has been replaced by 0.7.0, the catalog tarball has been
replaced by a different build at the same version, and Scan is unchanged. Core 0.7.0 *does*
contain the "nothing blocks" change (`CHANGELOG.md`, D50). See §0.1-§0.3.

Manifests read from the tarballs [V: `tar -xzOf ... package/package.json`]:
- core peers `@aihq/catalog >=0.3.0 <0.4.0`, `@aihq/scan >=0.5.0 <0.6.0`, optional
  `@aihq/framework-ecc` and `@aihq/framework-superpowers`.
- catalog publishes `.` plus 16 JSON subpaths (index, collections, presentation,
  qualification, signed-catalog, categories, runtime-descriptors, authoring-bundle,
  core-qualification, scanner-evidence, scanner-providers, public-baseline,
  framework-ecc, framework-superpowers, framework-plugins).
- scan publishes `.` and `./package.json` only; `bin` = `aih-scan`; `prepack` builds.

### 1.3 What Core 0.6.2's own shipped documentation says about this repo's scope [V]

Read from inside the supplied tarball (`core/package/docs/commands.md`,
`core/package/guides/`) — published package content, not another repository's source, so it is
legitimate evidence under `AGENTS.md` rule 3:

- `docs/commands.md:1022`: "The Policy Workbench browser and `aih policy generate` command were
  removed in this greenfield cutover; **there is no `aih-ui` replacement**. Core retains the
  policy schema, validation, effective-state resolution, and governed command routes. It does
  not expose a public browser or a replacement authoring command… validate them with
  `aih policy validate`, and supply an administrator-controlled protected file through
  `--policy <file>` or `AIH_ORG_POLICY`."
- `docs/commands.md:1024`: "The retained `compilePolicy` and `compileOrganizationManifestV1`
  functions are Core/build-time APIs, **not public** `aih policy` authoring commands."
- `docs/commands.md:1034`: "The retired administrator-catalog Workbench preparation route is
  not a CLI command."
- `guides/portable-policy-delivery.md:89-93`: the binding in `.aih-config.json` records the
  canonical root identity, project id, selected policy path/digest and approved target set;
  "**This is one selected policy, not a hierarchy or a merge of multiple policies.**"
- Command inventory from the `docs/commands.md` headings: `aih policy` exists
  (bind / rebind / revoke / project / data prepare|sign|import / validate); there is **no**
  `check-policy`, `publish` or `generate` command [V].
- A grep of every public `.d.ts` in core 0.6.2 for `check-policy`, `checkPolicy`,
  `compilePolicy`, `policyTemplate`, `publishPolicy` returns **no public API** [V], consistent
  with `:1024`.

Consequences applied in iteration 1: G4's absence is the *intended* end state rather than a wait
for a release; G1's authoring screens have no published contract and are contradicted by Core's
own docs; G8's "trim + merge" is a design intent the product explicitly does not have; and G3's
wording may name `aih policy validate` (a real command) instead of implying a missing contract.


## 2. What the implementation actually is [V, working tree]

### 2.1 One page, one HTML document, no client-side router

- `src/index.html` (663 lines) is the only screen document. There is **one** Workbench page;
  the prototype's separate admin page and user page do not exist as screens
  [V: file listing of `src/`; `src/main.js` mounts one page].
- `src/main.js` (90 lines) composes exactly eleven modules: shell, elements, ai-tools,
  organization, theme, onboarding, policy-import, decision-import, policy-workspace,
  settings-client, catalog controller, governance controller [V: `src/main.js:16-27`].
- View state lives in `src/app/shell.js` (`let currentView = "catalog"`, `shell.js:16`);
  the role-specific *presentation* is `src/app/policy-workspace.js` (65 lines) — a title,
  intro and review section, not a second page.

### 2.2 Screens / surfaces present in `src/index.html`

| Surface | Anchor | Line |
| --- | --- | --- |
| Top header: identity, org modal trigger, AI tools, three disabled actions, theme, avatar | `#org-modal-trigger`, `#ai-tools-trigger`, `#theme-toggle-btn` | 21-80 |
| Sub-header: provenance strip + panel toggles | `#provenance-strip`, `#toggle-nav-btn`, `#toggle-inspector-btn` | 82-96 |
| Sources rail, kind ledger, source header (3 disabled policy controls), filter row | `#source-btn-allow-all/-allow-exceptions/-hold-back` | 187-190 |
| Entry grid / cards | catalog controller + `src/catalog/cards.js` | — |
| Inspector with 4 tabs: Details, Security Scan, Governance, Policy JSON | `#tab-details/#tab-security/#tab-governance/#tab-json` | 279-284 |
| Details pane: publisher overview, capabilities, upstream provenance, identity disclosure | `#details-desc`, `#details-capabilities`, `#details-source`, `#details-identity` | 291-314 |
| Security pane: telemetry (2 slots), qualification, evidence statements, policy determination | `#security-qualification`, `#security-statements`, `#statement-count` | 315-374 |
| Governance pane: operator inputs, steps 1-6 | `#gov-*` inputs, `#gov-prepare-btn`, `#gov-consume-btn` | 375-553 |
| Policy JSON pane: live viewer + 4 disabled controls | `#live-json-viewer`, `#copy-json-btn`, `#download-json-btn`, `#reset-item-btn`, `#apply-staging-btn` | 557-573 |
| Dialogs: first-run setup, decision import, saved setup, PolicyBundle import | `#setup-dialog`, `#decision-dialog`, `#org-modal-overlay`, `#org-policy-dialog` | 578-659 |
| Error banner | `#catalog-error` | 660 |

### 2.3 Backend routes served to the page [V: `tools/server/api.mjs:59-234`]

`GET /api/workbench-settings` · `POST /api/workbench-settings` ·
`POST /api/workbench-settings/update` · `POST /api/workbench-settings/clients` ·
`POST /api/policy-bundle-structure` · `POST /api/decision-structure` · `GET /api/packages` ·
`POST /api/subject` · `POST /api/catalog-integrity` · `POST /api/evidence` ·
`POST /api/validation-fixture` · `POST /api/operator-file` · `POST /api/observation` ·
`POST /api/reopen` · `POST /api/prepare` · `POST /api/consume` · `POST /api/saved`.

Same-origin, `application/json` and Host checks guard the settings/structure routes
[V: `api.mjs:247-258`]; unknown bodies are rejected rather than coerced
[V: `api.mjs:25-47`]; a failure returns the error, never a substitute success
[V: `api.mjs:265-267`].

### 2.4 Data sources

- Catalog content: served from Catalog's public reader result, not the raw index
  [V: `tools/service/catalog-served.mjs`, `README.md:782`].
- Core: governance input preparation/consumption and the decision digests
  [V: `tools/service/core-adapter.mjs`, `core-service.mjs`].
- Scan: attestation verification, scan-result record and findings readers, projection
  into Core's organization-evidence envelope [V: `tools/service/scan-verifier.mjs`].
- Core's supported CLI targets: public `SUPPORTED_CLIS`, read by the backend and handed
  to the page as `coreTargets` through one summary [V: `tools/service/core-targets.mjs`,
  `src/main.js:73-78`].
- Local UI settings: `tools/server/settings.mjs` + `.aih-ui/settings.v1.json`
  (gitignored) [V: `.gitignore:6`].

### 2.5 Package integrations verified

Every named import from `@aihq/*` in `src/` and `tools/` resolves against the supplied
tarballs' public export maps (35 distinct names; see iteration log for the method and for
the one false positive I corrected) [V].

### 2.6 Public-export contract check [V]

(Numbered 2.x because it belongs to what the implementation is: it records exactly what the
implementation imports.)

Method: extracted the three tarballs to `%TEMP%\aihpkg`, walked every `.js`/`.mjs`
under `src/` and `tools/`, collected every named import from `@aihq/core|scan|catalog`,
and matched each name against the package's `.d.ts` text, following `export *` targets.

Result: **35 distinct named imports; all 35 resolve.** The first pass of the check reported
5 "missing" core names (`governanceDecisionDigestV2`,
`governanceDecisionSourceDigestV2`, `governanceDecisionSubjectDigestV2`,
`parseGovernanceDecisionV2`, `parsePolicyBundle`). That was **my false positive, corrected
in this run**: `dist/index.d.ts` re-exports them with `export *` from
`dist/org-policy/governance-decision-v2.d.ts` (first four) and `dist/org-policy/bundle.d.ts`
(`parsePolicyBundle`); both files exist and contain the names [V]. Method note for later
iterations: **a name absent from `index.d.ts` is not absent from the package.**

Import surface actually used:
- core: `prepareGovernanceInputV1`, `consumeGovernanceInputV1`, `parseGovernanceInputV1Bytes`,
  `parseOrganizationEvidenceEnvelopeV1Bytes`, `organizationEvidenceEnvelopeDigestV1`,
  `governanceDecisionSourceDigestV2`, `governanceDecisionSubjectDigestV2`,
  `governanceDecisionDigestV2`, `parsePolicyBundle`, `parseGovernanceDecisionV2`,
  `SUPPORTED_CLIS` [V: `tools/service/core-adapter.mjs:11-19`, `policy-review.mjs:2`,
  `validation-fixture.mjs:25`, `core-targets.mjs:13`].
- scan: `verifyScanAttestationV2`, `readScanResultRecordV1`, `readScanResultSubjectBindingV1`,
  `readScanFindingsV1`, `parseScanAttestationEnvelopeV2Json`, `parseScanCandidateV2Json`,
  `canonicalCoreOrganizationEvidenceEnvelopeV1Bytes`,
  `projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1`,
  `canonicalScanAttestationEnvelopeBytesV2`, `canonicalScanCandidateBytesV2`,
  `ed25519KeyIdV2`, `sealSourceV2`, `createScanCandidateV2`, `signScanCandidateV2`,
  `AI_HARNESS_DECISION_V2_SCHEMA_SHA256`, `AI_HARNESS_STRICT_V2_COMMIT`,
  `SCAN_RESULT_RECORD_FORMAT_V1`, `SCAN_RESULT_RECORD_VERSION_V1`
  [V: `tools/service/scan-verifier.mjs:38-49`, `fixture-candidate.mjs:19-24`,
  `validation-fixture.mjs:26-34`].
- catalog: `readCatalogContentV1`, `readCatalogCollectionsV1`,
  `CATALOG_CONTENT_INDEX_ROOT_URL`, `CATALOG_CONTENT_INDEX_SUBPATH_V1`,
  `CATALOG_COLLECTIONS_SUBPATH_V1`, `resolveCatalogContentPathV1`
  [V: `tools/service/catalog-access.mjs:23-28`, `catalog-collections.mjs:19`].

Reach mechanism for the other Catalog readers (**resolves the §1.3 open question, so it is
not a gap**): the optional readers are reached through a **namespace** import,
`import * as catalog from "@aihq/catalog"` [V: `catalog-qualification.mjs:24`,
`catalog-categories.mjs:19`, `catalog-publisher.mjs:17`], which is exactly how the page can
read *older* Catalog packages that export less. Which namespace members each module touches
is recorded in the iteration log; a `typeof` guard keeps a missing export from throwing.

### 2.7 Corrections applied to §2.6 in this pass [V]

- The namespace import **is** the reach mechanism: `catalog-qualification.mjs:24` imports
  `* as catalog`, then destructures `readCatalogQualificationV1`,
  `resolveCatalogQualificationPathV1`, `CATALOG_QUALIFICATION_SUBPATH_V1` and returns
  `{ qualification: null, absent: "the installed @aihq/catalog does not export ..." }` when
  the `typeof` guard fails (`:39-45`). Same shape in `catalog-categories.mjs:19,24-27` and
  `catalog-publisher.mjs:17,22-25`. So an older Catalog is handled by absence, not by copy [V].
- Two real deviations found while reading those files, both recorded as gaps below:
  `catalog-publisher.mjs` **throws** when the presentation reader is missing (`:23-25`) even
  though its own doc comment promises the operation reports `unavailable` (`:11-12`); and
  `catalog-access.mjs:106-111` carries an explicit `GAP:` comment (Catalog publishes artifact
  paths, not the containing directory; the UI derives the directory itself).

---

## 3. Reference inventory (comparison baselines, not proof) [V]

### 3.1 `prototype/` — Concept v3, 11 screens + 5 notes

11 screen files (`prototype/screens/`): `system`, `overview`, `entry`, `admin-org`,
`admin-sources` (the reference screen), `admin-item`, `admin-changes`, `admin-acme`,
`admin-scan`, `user-start`, `user-trim`; plus `shell.js`, `user-shell.js`, `tokens.css`,
`tw-config.js`, `wb.css`, `fonts.css`, `mode.js` [V: directory listing].

The guide's own nav data names each screen and its review question
[V: `prototype/index.html:54-186`], and the notes carry the decisions and the open
questions: `adoption` (least-resistance adoption path), `scope` (first release in/later),
`decided` (23 decided points), `open` (14 open questions), `asks` ("what this asks of aih")
[V: `prototype/index.html:187-285`].

Load-bearing prototype statements for this review:
- "Two separate pages: admin and user. **Never one page with roles.**" [V: `index.html:226`].
- "Today the product serves one workbench and takes no other arguments"; folder-based page
  choice is a proposal [V: `index.html:87`, `:260`].
- The user's trim needs its own file; `aih-org-policy.json` is the organization policy, so
  the project file's name/format/merge rule are **open** [V: `index.html:261-262`, `:266`].
- Two panel toggles replace the hamburger; the section navigation lives in the rail
  [V: `index.html:244-247`].
- Prototype figures that are explicitly sample data ("[n] marks a number nobody has yet",
  `index.html:40`; 42 scan records vs 86 items, `:258`).

### 3.2 `aih-policy-workbench.html` — the retiring snapshot

870 lines / 3.83 MB, of which one line is 3.11 MB and six more are 20-230 KB
[V: probe over the file]. Structure:
- markup + CSS on lines ≈1-782, with **174 distinct element ids** [V: id probe].
- the model and app are inline scripts: `window.__aihWorkbenchModel` (line 785) and
  `window.__aihPolicyWorkbenchSession` / `__aihArtifactIntake` /
  `__aihPolicyWorkbenchProtectedScanGuide` / `__aihSetWorkbenchView` /
  `__aihWorkbenchValidatePolicy` / `__aihPolicyWorkbenchEnhanceRows` /
  `__aihWorkbenchApplyingProjection` (lines 852-866) [V].
- **no** `localStorage` and **no** `XMLHttpRequest` in the file [V: 0 occurrences each].
- 16 `fetch(` occurrences: 14 are *inside embedded JSON evidence strings* (source snippets in
  findings, e.g. `fetch('https://api.github.com/repos/affaan-m/ECC/releases/latest'`,
  `` fetch(`https://api.example.com/video/${props.videoId}` ``); the other two are live code:
  `fetch(Ve.endpoint,{method:"POST",credentials:"same-origin",...})` and
  `fetch("/api/artifact-intake/github-skill/prepare",{method:"POST",...})` [V: context probe].

Capability surfaces the snapshot carries, by id [V: id probe]:
- policy + evidence intake: `policy-file`, `evidence-file`, `decision-file`, `validate`,
  `download`, `export` (lines 536-538, 530-535);
- protected-bundle form: `protected-*` ids for issuer, decision, kind, subject, source
  locators, targets, effects, catalog signer/head/member digests, evidence, policy, control,
  actor, reason, disposition, conditions, review-by, plus
  `download-protected-bundle`/`download-protected-evidence` (lines 582-652);
- curation/authoring: `authoring-sidebar`, `curation-editor`, `custom-editor`,
  `remote-custom-editor`, `ecc-mcp-editor` and their rows (lines 681-771);
- deployment/adoption: `adoption-recipe*`, `policy-settings*`, `posture`,
  `supported-cli-count`, `deployment-readiness`, `framework-rows`, `ecc-hook-controls`
  (lines 545-572);
- verdict/decision: `approval-rows`, `decision-rows`, `dispositionable-findings`,
  `hard-blockers`, `report-preview`, `config-preview` (lines 664-666, 779-781);
- artifact intake: a generated `#artifact-intake-review` section, format
  `aih-artifact-intake` v1/v2 with an `authority.state === "not-authority"` rule, 47
  occurrences of `artifact-intake` [V: context probe].

---

## 4. Gap register

Legend: **B** = user-visible behavior, **E** = evidence, **D** = dependency,
**R** = risk, **C** = completion criterion, **L** = label. Items are first-pass;
iteration 1+ verifies, splits, corrects or drops them (corrections are appended to
`cline-llm-analysis-overnight.md`, never silently applied).

### G1 — Policy authoring / curation screens have no counterpart in `src/`

**Iteration 1 — verified and strengthened [V].** Core 0.6.2's shipped docs state the Workbench
browser and `aih policy generate` were removed and *there is no `aih-ui` replacement*, that
`compilePolicy`/`compileOrganizationManifestV1` are build-time APIs and **not public**, and that
administrators prepare policy outside the governed target and validate it with
`aih policy validate` (`core/package/docs/commands.md:1022-1024`). So this is not an unfinished
screen: an authoring UI in this repo would contradict the published contract.
**Verdict: `DECISION` — recommend "out of scope" recorded in `README.md`; do not build.**

- **B**: the snapshot lets an operator author curated entries, custom sources, remote
  sources and ECC MCP approvals in sidebars (`authoring-sidebar`, `curation-editor`,
  `custom-editor`, `remote-custom-editor`, `ecc-mcp-editor`). The live page has no such
  surface; the closest live surfaces are two read-only structure dialogs
  (`#org-policy-dialog`, `#decision-dialog`, `src/index.html:602-659`).
- **E**: snapshot ids `authoring-sidebar`/`authoring-forms`/`curation-editor`/
  `custom-editor`/`remote-custom-editor`/`ecc-mcp-editor` with rows at
  `aih-policy-workbench.html:681-771`; live dialogs at `src/index.html:637-659` and
  `src/index.html:602-624`; `src/app/policy-import.js:24-35`, `src/app/decision-import.js:12-20`.
- **D**: Catalog *publishes* authoring/framework artefacts (export map subpaths
  `catalog-authoring-bundle.json`, `catalog-framework-*.json`), but the UI imports **no**
  authoring or framework reader [V: 35-name import surface].
- **R**: the repo must not grow authoring rules of its own (`README.md:14-17`); building this
  without a published contract would put policy semantics in the UI.
- **C**: owner decides whether authoring is in scope; if yes, name the published reader the
  UI will display authoring state through and add one read-only screen; if no, record in
  `README.md` that authoring stays outside this repo.
- **L**: `DECISION`.

### G2 — Artifact intake is in the snapshot but has no route, module or screen here

- **B**: the snapshot's artifact-intake workflow reviews an `aih-artifact-intake` v1/v2
  document and stages it. The live preview API serves no such route.
- **E**: `artifact-intake` 47 occurrences, `#artifact-intake-review` generation and
  `fetch("/api/artifact-intake/github-skill/prepare", {...})`,
  `fetch(Ve.endpoint, {...})` in `aih-policy-workbench.html` (same 3.1 MB script line);
  live route table `tools/server/api.mjs:59-234` contains **no** `artifact-intake` path [V].
- **D**: no supplied package publishes an artifact-intake contract: core's export list has
  no intake reader; the format name appears nowhere in the three tarballs' public exports
  (to be re-confirmed by iteration 1).
- **R**: if the snapshot is retired without recording this, a workflow that exists in the
  shipped HTML disappears with no decision on the record. Per `AGENTS.md` rule 3 this is a
  **report**, not a reimplementation.
- **C**: the gap is written into `README.md` (what the snapshot had, why the Workbench does
  not serve it, which product owns `/api/artifact-intake/*`), and the owner confirms the
  snapshot may be retired without it.
- **L**: `DECISION`.

### G3 — Header actions stay disabled, and two of them name no reachable contract

**Iteration 1 — partially verified [V].** A grep of every public `.d.ts` in core 0.6.2 for
`check-policy`, `checkPolicy`, `compilePolicy`, `policyTemplate`, `publishPolicy` returns
nothing, and the command reference lists no `check-policy`/`publish`/`generate` command, so the
disabled titles are *accurate* about a missing page-served contract. What exists instead is
`aih policy validate` (operator CLI) and the protected-file route `--policy <file>` /
`AIH_ORG_POLICY` (`core/package/docs/commands.md:1022`). **Verdict: keep `BLOCKED-PKG` for a
page-served path, and add a `DECISION` for wording** — the reason could name
`aih policy validate` rather than implying a contract nobody published.

- **B**: `Review Changes`, `Check Policy` and `Publish` are disabled and carry titles naming
  what is missing. `Review Changes` names Core review state (organizations supply the
  workflow); `Check Policy` names a Core "check-policy contract"; `Publish` names
  organization resolution plus a Core publish contract.
- **E**: `src/index.html:58-68` (three `disabled` buttons with `title` reasons).
- **D**: need to re-verify against core 0.6.2's public surface whether any of the three has a
  published counterpart (`CAPABILITIES`, `ALL_COMMANDS`, `builtinCommandNames`,
  `registerCommands`, `runSessionGuardrails` are exported; a *page-served* check/publish API
  is not visible in the export list) — iteration 1 task, then re-label.
- **R**: a disabled control with a wrong reason is a misleading state; a disabled control
  whose contract exists in the new packages becomes dead UI.
- **C**: for each of the three, either a live path exists and is wired, or the title names
  the exact publishable contract that is still missing. No third state.
- **L**: `BLOCKED-PKG` (owner says a Core release is expected in ~5h; the "nothing blocks"
  change is explicitly *not* in 0.6.2) — re-check when the tarballs land.

### G4 — The Policy JSON tab is an empty shell with four dead controls

**Iteration 1 — label corrected to `DECISION`/`SAFE` (was `BLOCKED-PKG`) [V].** Core 0.6.2
publishes no compile/template API and its docs say the authoring browser was removed with no
replacement (`docs/commands.md:1022-1024`). The tab's absence text is therefore the intended end
state and **no upcoming release is expected to fill it**. Two honest options: state the absence
once with no controls, or remove the tab. Keeping four disabled buttons that imply a pending
feature is the actual defect.

- **B**: the tab shows `Not published: no policy compiler or template contract. This page
  does not export a policy.` and `Copy JSON` / `Download` / `Reset Item` / `Apply` are
  disabled.
- **E**: `src/index.html:557-573` (`#live-json-viewer` at `:565`, `#copy-json-btn` and
  `#download-json-btn` at `:561-562`, `#reset-item-btn` at `:567`, `#apply-staging-btn`
  at `:568`); tab label and title at `:282` ("Policy JSON · not published").
- **D**: a policy compile/template contract in `@aihq/core`. The snapshot's equivalent
  surface (staged policy JSON + `download`/`export`) is at
  `aih-policy-workbench.html:528-536`.
- **R**: the tab is reachable and looks like a feature that was never finished. Also the tab
  is the only place where "staged policy delta" language survives, so a reader may believe
  the page stages policy bytes when it does not.
- **C**: either Core publishes a compile/template contract and the tab renders real bytes, or
  the tab is removed or left with a single explicit absence reason and no disabled controls
  that imply a pending feature.
- **L**: `BLOCKED-PKG` (verify against the new packages) / `DECISION` for remove-vs-keep.

### G5 — Admin page and user page are one page here, against a stated prototype decision

- **B**: the prototype shows two separate pages (admin with org/publish, user with trim-only,
  no admin controls). The live page is one Workbench with a role-specific workspace section.
- **E**: decision at `prototype/index.html:226` ("Two separate pages… Never one page with
  roles."); screens `prototype/screens/user-start.html`, `user-trim.html`,
  `admin-org.html`… vs one live document `src/index.html` and
  `src/app/policy-workspace.js` (title/intro/review, 65 lines).
- **D**: a product decision, not a package.
- **R**: a role-specific screen rendered inside a page that also exposes admin-flavoured
  disabled actions ("Publish", "Review Changes") can read as role confusion to a user.
- **C**: the split is either implemented as the prototype decided, or the decision is
  superseded explicitly in `README.md` with the reason.
- **L**: `DECISION`.

### G6 — The `npx @aihq/core --ui` page chooser is absent

- **B**: nothing in the live page lets an operator arrive at a policy-repo view versus a
  project view; the preview serves one page.
- **E**: `prototype/screens/entry.html`; guide text `prototype/index.html:81-90` stating the
  folder-based choice is a **proposal** and today's product takes no other arguments.
- **D**: `@aihq/core`'s CLI (`bin: aih`, `dist/cli.js`) would have to offer it.
- **R**: low for this repo — the prototype already marks it as not-current behaviour.
- **C**: either dropped from scope in `README.md`, or implemented only if Core publishes the
  argument.
- **L**: `DECISION` (low priority; the reference itself calls it a proposal).

### G7 — "Add your own source and scan it" / scan review backlog are absent

- **B**: `admin-acme` ("say what the item is, copy the command, run it, load the result")
  and `admin-scan` (findings grouped, three allowed decisions, review backlog) exist only in
  the prototype and the retiring snapshot; the live page can display findings after operator
  verification inside Governance, and runs no scan.
- **E**: `prototype/index.html:139-160` (both screens) and their review checks; live
  capability `src/index.html:479-515` (steps 4b/5) plus `tools/service/scan-verifier.mjs`.
- **D**: running a scan belongs to `@aihq/scan` (`README.md:16`); the UI may only display
  what a package emitted.
- **R**: building any of this in the UI would violate the ownership rule; leaving it
  unrecorded makes the retirement look like a feature loss.
- **C**: recorded in `README.md` as Scan-owned and outside the Workbench, or scoped with the
  owner as a display-only screen fed by a published findings reader.
- **L**: `DECISION`.

### G8 — User trim (Required / Optional / Skip) and the project policy file are absent

**Iteration 1 — verified; the design intent has no contract [V].**
`core/package/guides/portable-policy-delivery.md:89-93` says the binding in `.aih-config.json`
records the canonical root identity, project id, the exact selected policy path/digest and the
approved target set, and that "**this is one selected policy, not a hierarchy or a merge of
multiple policies**". `docs/commands.md:990-1018` gives the lifecycle (`aih policy
bind|rebind|revoke|project`, `--apply` to commit) and states that binding is not authority and
that explicit conflicts fail closed. So a Required/Optional/Skip trim would invent a merge rule
the product deliberately does not have. **Verdict: `DECISION` — a user-side screen could at most
*display* the binding and required content; a trim that writes policy must not be built here.**

- **B**: no surface lets a user trim an organization policy, and no project-policy file is
  written.
- **E**: `prototype/screens/user-trim.html`, `user-start.html`; the prototype's own open
  question about the project file's name/format/merge rule
  (`prototype/index.html:261-262`, `:266`), and the decided wording rule
  ("Required / Optional / Skip … Never Yes", `:242`).
- **D**: a format `@aihq/core` reads, plus a published trim/merge contract.
- **R**: the file name is a real hazard the prototype names: saving a trim as
  `aih-org-policy.json` would replace the organization policy. Any implementation in this
  repo must not invent the format.
- **C**: the format and merge rule are decided and published, then a display + save path
  exists; until then the repo records the gap and does not write policy files.
- **L**: `DECISION` now; becomes `BLOCKED-PKG` when a Core contract exists.

### G9 — Inspector "Scanner Telemetry" slots say `Not published` while Scan can supply findings

**Iteration 1 — verified, and narrowed to a real accessibility/UX defect [V].** The two slots do
carry specific reasons, set once at startup: `details.js:169-170` sets
`detectorRunState.title = "Not published: Scan publishes one detector per record and no
per-detector run state."` and
`detectorFindingDetail.title = "Not published: " + FINDING_DETAIL_ABSENT`, where the latter is
`absence.js:23-25`: "Catalog does not supply a verified per-entry Scan result and annex bytes.
Open Governance to verify operator-supplied scan material and inspect typed findings." So the
Governance cross-reference exists and the claim in the first pass was too harsh. The surviving
defect: the reason lives **only** in a `title` on a non-focusable `div`, so it is mouse-only
(no `aria-describedby`, no visible text), and both slots show the identical visible words
"Not published", so a keyboard or screen-reader user cannot tell the two apart.
**Verdict: `SAFE` (presentation/a11y) — move each reason into visible text or a described-by
target, and word the two slots differently.**

- **B**: the Security tab keeps two slots reading `Not published` — "Detector identities and
  per-engine run state" and "Finding rule, severity, message and location" — while the
  Governance pane can display Scan's typed findings after operator verification.
- **E**: `src/index.html:317-328` with the inline note at `:318-320` explaining the split;
  Scan's readers are imported and used (`tools/service/scan-verifier.mjs`).
- **D**: whether a *verified in-session* scan can be shown in the inspector — a UI wiring
  question, not a package gap (the readers exist) [I until iteration 1 confirms the data
  flow].
- **R**: a reader who verified a scan in Governance and then opens Security sees
  "Not published" with no cross-reference; that can read as "the scan produced nothing".
- **C**: either the slot shows the verified session's findings with provenance, or the slot's
  reason names the missing step ("supply attested material and verify in Governance") and
  links to that step.
- **L**: `UNCERTAIN` → verify in iteration 1, then likely `SAFE` (presentation/wiring).

### G10 — Numeric readouts that could be invented: egress guard, quota, leaks, token budget

**Iteration 1 — verified clean, label `DONE` (static evidence) [V].** A probe of `src/index.html`
for numeric text found only step labels (`01 / Start` … `6 · Reopen…`) and the statement counter
(default `0`, then written by `details.js:328`). Metric tiles compute from state and render
`Not published` for any kind the index does not carry (`metrics.js:25`, `:33`, `:41`, `:46`); the
only percentage on the page is `Math.round((count / model.total) * 100)` guarded by
`if (count !== null && model.total)` (`metrics.js:56-59`); rail counts come from
`navigation.js:197`; `categoryCoverage()` returns `null` rather than `0` when nothing is
published (`publisher.js:66-77`). The design's `3 of 11` does not appear anywhere. Residual risk
is a runtime one only (a tile rendering a number with no published source) — one preview
spot-check remains, recorded in the iteration log.

- **B**: the sub-header/rail carries `Quota: Not connected`, `Leaks: Not connected`, several
  `Not connected` rows and metric tiles; `README.md:497-501` states a tile with nothing
  published keeps its size and reads `Not published`, never an invented count.
- **E**: `src/index.html:159-164` (quota/leaks), `:122`, `:143-149`, `:323-327`; claim at
  `README.md:497-501`; the prototype's sample numbers ("[n] marks a number nobody has yet",
  `prototype/index.html:40`).
- **D**: none.
- **R**: any invented number or percentage would be the worst possible defect in a governance
  UI; the retiring snapshot contains much sample data, so a copy-paste during retirement is a
  live risk.
- **C**: every numeric slot on the page traces to served state or reads an absence word; a
  grep-probe over the rendered page finds no numeric literal that is not from state.
- **L**: `UNCERTAIN` → verify tile by tile in iteration 1 (static markup cannot prove this).

### G11 — `catalog-publisher.mjs` throws where its own doc comment promises an absence

**Iteration 1 — disproved as a user-visible gap; kept only as a comment nit [V].** The throw is
converted before it can reach the page: `core-service.mjs:120-126` catches every operation and
answers `{ok:false,error}`; `preview.mjs:109-116` (`startupFact`) maps that to
`{state:"unavailable", reason}`, `:123-127` (`sidecarFact`) maps a `null` payload to
`{state:"absent", reason}`, and `:130-134` writes that into the summary; the page then reports
the absence with its reason (`publisher.js:32-34`, `:103-106`). So an installed Catalog without
the presentation export reads as an absence, exactly as the doc comment and `README.md:231-234`
promise. **Verdict: not a gap. Optional tidy-up: correct the module comment, or return
`{absent}` for symmetry with its two siblings.**

- **B**: with an installed Catalog that predates the presentation contract, this backend
  operation throws `the installed @aihq/catalog does not export readCatalogPresentationV1`
  instead of reporting the operation unavailable.
- **E**: code at `tools/service/catalog-publisher.mjs:23-25`; doc comment at `:11-12`
  ("A Catalog that predates the contract makes this one operation report `unavailable`");
  siblings instead return `{ absent: … }` (`catalog-qualification.mjs:44`,
  `catalog-categories.mjs:26`). README's rule for an older Catalog is "keeps its place and
  reads **Not published** with both counts from the presentation data" (`README.md:231-234`).
- **D**: none — a local consistency question.
- **R**: whether the operator sees `Not published` (as promised) or a raw error string
  depends on the caller's error handling; a raw error in the publisher/provenance slot would
  be a user-visible regression against the documented behaviour.
- **C**: one absence vocabulary across the three optional readers (all return a stated
  absence, or all throw and the caller renders the stated absence), proven by a test that
  simulates a Catalog without the export.
- **L**: `UNCERTAIN` → verify caller handling in iteration 1; if the throw surfaces, this is
  `SAFE` (backend-side consistency fix).

### G12 — Provenance strip initial state: the failure path leaves the placeholders in place

**Iteration 1 — confirmed, upgraded to a verified defect, `SAFE` [V].** `loadCatalog()` throws a
descriptive error for a failed fetch, a non-OK response, non-JSON, or a format/version mismatch
(`index-source.js:29-52`), and `main.js:84-86` catches it into `shell.showError()`, which only
sets `#catalog-error` text and unhides the banner (`shell.js:159-163`). `provenance.render()` is
reached **only** from `controller.render()` (`controller.js:135-142`), which runs only after a
successful `loadCatalog()` (`:177`, `:199`) — so on failure the page keeps its placeholders
forever: `#provenance-strip` still reads "Connecting to the installed @aihq/catalog package..."
(`index.html:86`), the masthead still reads `-` (`:180`, `:182`), the entry count still reads `…`
with the title "Loading the installed Catalog inventory." (`:212`), and the grid stays empty
because the empty-state message is only written by `cards.render()` (`cards.js:153-156`).
**Completion criterion (unchanged): a failed load must replace the loading placeholders with the
failure (or a named absence) as well as showing the banner — proven by pointing the preview at a
missing or contract-broken Catalog and reading the rendered text.**

- **B**: before the summary loads the strip reads "Connecting to the installed @aihq/catalog
  package..."; if the summary never loads, the operator must not be left with a permanent
  "Connecting…" and an empty rail.
- **E**: `src/index.html:84-87` (initial text); loading/failure handling to be read in
  `src/catalog/index-source.js` (82 lines), `src/catalog/controller.js`,
  `src/app/shell.js` (`showError`).
- **D**: none.
- **R**: a stuck loading state hides the reason a page is empty; the error banner exists
  (`#catalog-error`, `src/index.html:660`) but its use for the catalog failure path is not
  yet verified.
- **C**: a fetch/contract failure replaces the strip text AND shows the reason in the banner
  (or a named absence), proven by pointing the preview at a missing package and reading the
  rendered text.
- **L**: `UNCERTAIN` → verify in iteration 1 (runtime check, not static markup).

### G13 — Catalog publishes artifact paths, not the containing directory (reported gap)

- **B**: none yet visible to an operator; it is a derivation the UI performs.
- **E**: `tools/service/catalog-access.mjs:106-111` — an explicit `GAP:` comment saying the
  last step is read off a path rather than asked for, confined to one function.
- **D**: a Catalog accessor for the entry's content directory.
- **R**: `AGENTS.md` rule 3 says an unpublished need is reported, not worked around. The
  workaround is bounded and validated (`resolveCatalogContentPathV1`), but it is still the UI
  deriving a location Catalog owns.
- **C**: the gap is reported to the Catalog owner (as `README.md` does for other absent
  contracts) and replaced by the accessor when published.
- **L**: `DECISION` (report; no UI change needed to satisfy the rule).

### G14 — Framework descriptors (ECC / Superpowers) are published but unused

- **B**: the snapshot has `framework-rows`, `ecc-hook-controls`, an ECC MCP approval editor and
  a "supported CLI count" block; the live page shows none of it.
- **E**: snapshot ids at `aih-policy-workbench.html:559-572`, `:758-771`; Catalog 0.3.0
  publishes `catalog-framework-ecc.json`, `catalog-framework-superpowers.json`,
  `catalog-framework-plugins.json` and exports `readCatalogFrameworkDescriptorV1` /
  `readCatalogFrameworkPluginsV1` [V: manifest + `dist/index.d.ts`]; the UI imports none of
  them [V: 35-name import surface].
- **D**: a decision on whether framework-specific presentation belongs in this repo.
- **R**: the only live surface today is the generic AI-tools control reading Core's supported
  CLIs. If the owner expects parity with the snapshot, the content is already published and
  the missing part is UI work.
- **C**: either a read-only framework panel fed by the published descriptor reader, or a
  `README.md` statement that framework presentation is out of scope.
- **L**: `DECISION` — and `SAFE` to build if the owner scopes it, since the readers exist.

### G15 — Accessibility of the reworked markup is unverified

- **B**: keyboard/screen-reader behaviour of the inspector tabs, rail toggles, disabled
  controls and the four dialogs.
- **E**: roles/labels are present and look deliberate — `role="tablist"` / `role="tab"` with
  `aria-controls` / `aria-selected` / `tabindex` (`src/index.html:278-284`), `aria-hidden`
  + `inert` on the collapsed inspector (`:270`), `role="alert"` on the error banner (`:660`),
  `aria-live="polite"` on the import statuses (`:612`, `:647`) — but a declaration is not
  behaviour.
- **D**: none.
- **R**: a screen-reader user may meet a tablist whose panels are hidden by class only, or a
  disabled control whose `title` reason is never announced.
- **C**: a documented keyboard pass (rail → grid → tabs → dialogs, including arrow keys) with
  `aria-selected` kept in sync with panel visibility, and every disabled control's reason
  reachable without a mouse.
- **L**: `UNCERTAIN` → verify in iteration 2 with a real keyboard pass in the preview.

### G16 — Retiring the snapshot: what would actually be lost

- **B**: not a gap, but the decision input for retirement.
- **E**: the snapshot reads no package and stores nothing locally — 0 `localStorage`,
  0 `XMLHttpRequest`; its only live `fetch` calls target `/api/artifact-intake/*` and a POST
  endpoint variable [V: probes in §3.2]. Everything else is inline model data
  (`window.__aihWorkbenchModel`) [V]. So retiring it removes **presentation plus the
  artifact-intake workflow (G2)** and removes no package integration the live page has.
- **D**: G1, G2, G4, G7, G8, G14 dispositions recorded in `README.md`.
- **R**: the real risk is not runtime loss but losing the *record* of what the snapshot
  offered (its 174-id surface) once the file is deleted.
- **C**: every snapshot surface is mapped to implemented-in-`src/`, recorded-as-decision, or
  package-blocked. That mapping is this review's deliverable.
- **L**: `SAFE` to retire once the dispositions above are recorded.

---

### G17 — Three role workspaces promise a Core contract Core says will not come

- **B**: the Project policy / Organization policy workspaces tell the operator that starting
  points, choices, validation and saving "need Core's published authoring and file contracts"
  / "need Core's file and serialization contracts".
- **E**: `src/app/policy-workspace.js:10-12` (vibe), `:19-21` (admin), `:28-30` (developer);
  the panels are rendered with those strings at `:46-54`.
- **D**: none — this is copy, and the evidence contradicts it: Core 0.6.2's shipped docs state
  the Workbench browser and `aih policy generate` were removed with **no `aih-ui` replacement**,
  that `compilePolicy`/`compileOrganizationManifestV1` are build-time APIs and **not public**,
  and that administrators prepare policy outside the governed target and validate it with
  `aih policy validate` (`core/package/docs/commands.md:1022-1024`).
- **R**: the page tells an operator to wait for a contract that the package explicitly says
  will not be published. That is the clearest "misleading UI state" found in this review, and
  it will never resolve by itself.
- **C**: the copy names the real route instead of a future contract — e.g. "authoring happens
  outside the governed target; validate with `aih policy validate` and supply the protected
  file" — with no promise of a UI authoring contract; or the workspace states plainly that
  policy authoring is out of scope for this page.
- **L**: **`SAFE`** (presentation copy only; no package change needed).

### G18 — Three implemented sort keys are not offered in the UI (observation, not a defect)

- **B**: the entry grid can be sorted by 5 of 8 implemented keys; `entryId-desc`, `sourceType`
  and `release` are reachable in code but not in the control.
- **E**: `SORT_KEYS` at `src/catalog/selectors.js:1`; the 5 options in `src/index.html`
  (`#sort-select`); reported by the page contract check as
  "note 3 SORT_KEYS the page offers no option for: entryId-desc, sourceType, release".
- **D**: none.
- **R**: none demonstrated — the reference shows a single sample "SORT: NAME (A-Z)" label, so
  this is unimplemented surface rather than lost design intent. Recorded so it is not mistaken
  for a regression later.
- **C**: either the control gains the three keys, or the register keeps this as a deliberate
  narrowing.
- **L**: **`DONE`/observation** — no build required.



### G19 — "Policy Determination" is dead static markup carrying a second vocabulary

- **B**: the Security tab shows "Not published: needs a Core determination contract. This page
  reads evidence and never records a decision." above three disabled radios: "Keep held back
  (Recommended)", "Not a real problem (False alarm)", "Accept the risk and allow".
- **E**: `src/index.html:349-370`; **no module references the block or its
  `name="policy-choice"` inputs** [V: grep over `src/**/*.js` — the only near-hit is the
  unrelated id `policy-start-description` at `src/app/policy-workspace.js:37`], so nothing ever
  replaces the note or enables the radios. Core 0.6.2 publishes no determination/triage API
  [V: recursive `.d.ts` grep], and its operator decision uses a different vocabulary —
  `disposition: "approved" | "accepted-with-conditions" | "rejected"`
  (`core/dist/org-policy/governance-decision-v2.d.ts:216`, `:322`, `:429`) — which the
  Governance pane already has the operator supply.
- **D**: none (wording/scope), plus the open question of whether per-finding triage is a
  Workbench feature at all.
- **R**: two vocabularies for one idea live side by side on one page (hold / false alarm /
  allow risk beside approved / with conditions / rejected). A reader cannot tell which one the
  product records, and the static one can never become true by itself.
- **C**: either the block's words are aligned with Core's decision vocabulary and it is fed by
  real state, or the block is removed or unmistakably labelled as design-only with no
  controls that imply a pending selection.
- **L**: `DECISION` (presentation only).



## 5. Priority order for safe, valuable work before retiring the snapshot

1. **G17** — copy that tells an operator to wait for a contract Core says will never come.
   Presentation only, highest trust value, buildable today.
2. **G9** — the two telemetry reasons are hover-only and identically worded; make them visible
   and distinct. Presentation/a11y only.
3. **G12, G11** — states that can stall or mislead (stuck "Connecting…" placeholders; the
   `catalog-publisher` comment nit). Presentation/backend consistency, no package change.
4. **G3, G4** — disabled controls: keep each reason honest, re-check against the incoming
   packages (`BLOCKED-PKG`), and decide remove-vs-keep for the four dead JSON controls.
5. **G2, G1, G7, G8, G14** — record the snapshot's unowned workflows in `README.md` so the
   retirement is a documented decision rather than a silent loss (`DECISION`).
6. **G15** — accessibility pass on the changed markup (needs a browser).
7. **G5, G6, G13, G18, G19** — decisions/reports that need no package work to close; G19 is
   presentation-only (align the wording with Core's decision vocabulary, or remove the dead
   block).

Nothing above requires inventing policy, catalog or scan logic in this repo. G10 is closed as
`DONE` and G11 is closed as a comment nit; both are kept in the register only so a later run
does not re-open them by accident.

---

## 6. Claims that did not survive verification [V]

- "Core 0.6.2 is missing five functions the UI imports" — **false**; they are re-exported
  through `export *` (see §2.6). Corrected.
- "The Catalog readers are reached by named imports" — **false** for the optional three;
  they are reached through a namespace import with a `typeof` guard (§2.7).
- "The retiring snapshot fetches package data" — **false**; its `fetch` calls are either
  inside embedded evidence JSON or the artifact-intake API (§3.2).

Resolution status after iterations 1-3: G9, G10, G11, G12, G13 and G19 were converted from
`UNCERTAIN` to verified (G10 closed `DONE`, G11 closed as a comment nit); G15 remains
`UNCERTAIN` because no browser is available in this environment; G2's ownership and all
`DECISION` items need the owner. **No `UNCERTAIN` label survives as a finding** — each is either
verified with evidence or explicitly stated as unverifiable here.

---

## 7. Resume here

Iterations 1-3 are complete (code verification, runtime verification, copy/dead-markup
verification); see `cline-llm-analysis-overnight.md` for the checks, results and corrections.

Next concrete checks, in order:

1. Read the sources still unread: `src/governance/*` (notably `controller.js`, `verdict.js`,
   `revisions.js`, `transport.js`, `inputs.js`, `observation.js`, `reopen.js`, `statuses.js`,
   `vocabulary.js`), `src/catalog/{entry,selectors,navigation,toolbar,view-state,collections,
   categories,qualification}.js`, and `src/app/{onboarding,setup-model,organization,theme,dom,
   elements}.js`. Confirm or drop G15's list and the README's "one verdict, one set of inputs".
2. Verify G15 with a real keyboard pass if a browser can be obtained outside the repo (none is
   available today: no `playwright`, no DOM runner).
3. Re-check `packages/` for the new tarballs. When they appear: SHA-256 each, read manifests and
   public `dist/*.d.ts` export maps, diff against §1.2/§2.6, and re-label G3, G4, G8, G13 (and
   G2 if an artifact-intake contract appears). **Never install or replace.**
4. Append every iteration to `cline-llm-analysis-overnight.md` with timestamp, checks,
   findings, corrections, remaining uncertainty and a fresh "Resume here".

---

## 8. Runtime verification carried out in this run (iteration 2) [V]

Performed read-only against the three supplied tarballs, after proving the preview's one write
(regenerated `src/styles/tailwind.css`) is byte-identical to the checked-in file:

- `node --test <tools/tests/*.test.mjs>` → **58 pass, 0 fail**.
- `node tools/check-page-contract.mjs` → **all checks passed** (ids unique, 123 relative imports
  resolve, 7 page assets present, request-path classification 400/403/containment).
- `node tools/preview.mjs --port 4399` with `CORE_TGZ`/`SCAN_TGZ`/`CATALOG_TGZ` set → started and
  logged `core 20fd8b63…`, `scan a1524d78…`, `catalog 44292377…`, i.e. **the same SHA-256 values
  this review computed by hand**.
- `node tools/acceptance-sweep.mjs` → **all checks passed**: 11 Core targets, invalid Decision V2
  refused with Core's own error, cross-site request refused, fixture/prepare/consume/reopen all
  behave, operator files named session-relative, and 12 checks confirm no answer leaks a
  filesystem location.
- Served data read directly: index `aih-catalog-index` v1 with **457 entries**; collections
  `aih-core` (@aihq/core 0.6.2, 9 members) and `aih-default-profile` (@aihq/catalog 1.0.0,
  1 member) → 10 current of 457; `publisher`/`qualification`/`categories` all `published`;
  `coreTargets` published with 11 targets; the three sidecars reachable at 200;
  `/api/subject` and `/api/catalog-integrity` answer as documented (`artifacts=verified`,
  `artifactsVerified=4`, `publishedEvidence.declared=3`, `byteChecked=0`).
- Not verifiable here: any browser-executed behaviour (hence G12's visual end state and all of
  G15 remain inferences/uncertain, stated as such).

Two run directories were left behind **outside** the repo
(`%TEMP%\aih-ui-preview-IeAFU0`, `%TEMP%\aih-ui-preview-gPxnIY`); this run does not delete
anything, so the owner may remove them. No repo file was created or changed except this file and
`TODO-cline.md` (verified with `git status --short`).









# cline-llm-analysis-overnight — iterations

Companion to `TODO-cline.md` (the gap register). This file is the log: each iteration records
the timestamp, what was checked, what was found, what was corrected, what remains uncertain,
and a **Resume here** section. Both files are self-contained so work can resume after context
compaction.

**Standing rules for this run (unchanged):** read-only except `TODO-cline.md` and
`cline-llm-analysis-overnight.md` at the repo root. No package install/replacement, no
commit/push/release, no edits to `src/`, `tools/`, config, tests or lockfiles. Probe scripts
were written to `%TEMP%`, tarballs extracted to `%TEMP%\aihpkg`, and the preview's run
directory lives under the OS temp directory.

Time base: local is UTC-05:00. Iterations: **I0** (first pass) ≈04:00 local,
**I1** (code verification) ≈04:05, **I2** (runtime verification) ≈04:12 local
(2026-09-26T09:12Z). The new packages the owner expects (~5h after run start) have **not**
arrived; `packages/` still holds exactly three tarballs — **stale for runs 2–3: both replaced the
Core tarball (and run 2 repacked the Catalog) without this header being updated. Run 3 continues at
I6 below; the current package state, hashes and contract diff are `TODO-cline.md` §0A.**

---

## I0 — first pass (≈04:00 local, 2026-09-26)

Checks: repo/AGENTS/README read; `src/` and `tools/` inventories with line counts; the route
table read from `tools/server/api.mjs`; every element id and every `Not published` /
`Not supplied` / `Not connected` / `disabled` occurrence in `src/index.html` listed with line
numbers; the three tarballs hashed; their manifests and `dist/*.d.ts` export maps read;
`prototype/` (11 screens + 5 notes) and `aih-policy-workbench.html` (870 lines, 3.83 MB,
174 ids, one 3.11 MB script line) probed for capabilities; `TODO-opencode.md` read **as a
claim to verify**, never as evidence.

Deliverable: `TODO-cline.md` created with the environment facts, the implemented-UI inventory,
the reference inventory, and gap register G1-G16. Two I0 assertions were flagged for
verification rather than stated as fact.

Corrections from I1/I2 affecting I0's text: (a) "five core imports are missing from the
published package" was **my false positive** — `dist/index.d.ts` re-exports them via
`export *`; (b) the retiring snapshot does not fetch package data — 14 of its 16 `fetch`
occurrences are inside embedded evidence JSON strings, and two are live calls (an
artifact-intake API and a POST to a variable endpoint).

Uncertainty at the end of I0: G9, G10, G11, G12, G15 were `UNCERTAIN` because static markup
cannot prove runtime state.

---

## I1 — code verification (≈04:05 local, 2026-09-26)

Checks (all reads): `src/catalog/{index-source,controller,cards,details,metrics,elements,
provenance,publisher}.js`, `src/app/{shell,absence,policy-workspace,ai-tools}.js`,
`tools/service/{catalog-access,catalog-qualification,catalog-categories,catalog-publisher,
core-service}.mjs`, `tools/preview.mjs`, the core tarball's `docs/commands.md` and
`guides/`, and a grep of every public `.d.ts`.

Findings (new or changed):

1. **Catalog readers are reached by namespace import with a `typeof` guard**
   (`catalog-qualification.mjs:24`, `:39-45`; `catalog-categories.mjs:19,24-27`;
   `catalog-publisher.mjs:17,22-25`). Not a gap; corrects an I0 method assumption.
2. **Core 0.6.2's shipped docs redefine this repo's scope**
   (`docs/commands.md:1022-1024`, `guides/portable-policy-delivery.md:89-93`): the Workbench
   browser and `aih policy generate` were removed with "no `aih-ui` replacement";
   `compilePolicy` is a build-time API and not public; administrators prepare policy outside
   the governed target and validate with `aih policy validate`; the `.aih-config.json` binding
   is "one selected policy, not a hierarchy or a merge". This re-labels G1, G3, G4, G8.
3. **G12 is real** (stuck loading state). `loadCatalog()` throws (`index-source.js:29-52`);
   `main.js:84-86` shows only the banner; `provenance.render` is reached only from
   `controller.render()` (`controller.js:135-142`) after a successful load (`:177`, `:199`), so
   `index.html:86`, `:180`, `:182`, `:212` keep their placeholders and the grid stays empty
   (`cards.js:153-156` never runs).
4. **G9 narrowed to an a11y defect.** The telemetry slots do carry specific reasons and a
   Governance pointer (`details.js:169-170`, `absence.js:23-25`), but only in `title`
   attributes on non-focusable `div`s, and both show the same visible `Not published`.
5. **G11 disproved as user-visible.** `core-service.mjs:120-126` → `{ok:false,error}`;
   `preview.mjs:109-116`, `:123-134` → `{state:"unavailable"|"absent", reason}`; the page then
   reports the absence with its reason (`publisher.js:32-34`, `:103-106`).
6. **G10 clean on static evidence.** No invented numbers: tiles render `Not published` for
   uncounted kinds (`metrics.js:25`, `:33`, `:41`, `:46`), the one percentage is guarded
   (`:56-59`), rail counts come from state (`navigation.js:197`), coverage returns `null`
   rather than `0` (`publisher.js:66-77`); the design's `3 of 11` appears nowhere.
7. **G13 confirmed.** Catalog 0.3.0's public `.d.ts` exposes only
   `resolveCatalogContentPathV1` / `resolveCatalogQualificationPathV1`; no content-directory
   accessor exists, matching the `GAP:` comment at `catalog-access.mjs:106-111`.
8. **G3/G4 confirmed against the package**: no `check-policy`/`publish`/`compilePolicy`/
   `policyTemplate` public API and no such command, while `aih policy validate` does exist.
9. **New gap G17 (verified in I1, recorded in `TODO-cline.md`)**: all three role workspaces
   tell the operator to wait for "Core's published authoring and file contracts"
   (`policy-workspace.js:10-12`, `:19-21`, `:28-30`), which Core's own documentation
   contradicts. Misleading copy, `SAFE` to reword.

Uncertainty left at the end of I1: G12's and G10's runtime confirmation; G15 (pass/fail of a
keyboard pass); G2's owner beyond the snapshot's own code.

## I2 — runtime verification (≈04:12 local, 2026-09-26; UTC 2026-09-26T09:12Z)

### Safety preconditions checked *before* running anything

- **The preview rewrites `src/styles/tailwind.css`** (`build-css.mjs:29`), so the Tailwind build
  was first computed **in memory** and compared with the checked-in file: both
  `df22c7741d075c39…`, 37,635 bytes — **byte-identical** [V]. The write is therefore a no-op,
  and the file is verified unchanged afterwards (still `DF22C7741D075C39`).
- The test suite and preview write only into OS temp directories
  (`tools/tests/settings.test.mjs:16-27`, `sessions-observation.test.mjs:33`).
- Repo state after the iteration: `git status --short` lists exactly the pre-existing changes
  plus `TODO-cline.md` / `cline-llm-analysis-overnight.md`; `.aih-ui/settings.v1.json` is
  untouched (9/25 3:36 AM) [V]. Two run directories were created outside the repo
  (`%TEMP%\aih-ui-preview-IeAFU0`, `…-gPxnIY`, the latter ~10.6k files); they were **not**
  deleted because this run forbids deletions. They can be removed by hand.

### Checks and results

| Check | Command | Result |
| --- | --- | --- |
| Unit/regression suite | `node --test <tools/tests/*.test.mjs>` | **58 pass, 0 fail** [V] |
| Page/asset contract | `node tools/check-page-contract.mjs` | **all checks passed**: ids unique, tabs present, 123 relative imports resolve, 7 page assets copied, request-path classification (400/403/containment) [V] |
| Preview startup | `CORE_TGZ/SCAN_TGZ/CATALOG_TGZ=<supplied> node tools/preview.mjs --port 4399` | started from the three supplied tarballs and logged `core 20fd8b63…`, `scan a1524d78…`, `catalog 44292377…` — **the same hashes this review computed independently** [V] |
| Governance acceptance sweep | `node tools/acceptance-sweep.mjs http://127.0.0.1:4399/` | **all checks passed**: 11 Core targets; invalid Decision V2 refused with Core's own union error; cross-site request refused; fixture builds; prepare is byte-identical on repeat; consume answers six axes; "raw annex root must be an array" refusal named; session-relative operator names; both saved files read back; reopen opens a *different* session; 12 checks confirm no response body names a filesystem location [V] |
| Served catalog | `GET /catalog-index.json` | `aih-catalog-index` v1, **457 entries**, digest `sha256:9eb726d2037b2…` [V] |
| Summary blocks | `GET /summary.json` | `publisher`, `qualification`, `categories` all `published` with their specifiers; `coreTargets` published with **11 targets** (`claude, codex, cursor, antigravity, gemini, copilot, windsurf, opencode, zed, kimi, kiro`); `packages` = core 0.6.2 / scan 0.5.0 / catalog 0.3.0 carrying the supplied sha256s [V] |
| Current vs reference inventory | `GET /summary.json` | 2 collections: `aih-core` (@aihq/core 0.6.2, 9 members) and `aih-default-profile` (@aihq/catalog 1.0.0, 1 member) → **10 current of 457 indexed** [V] |
| Sidecars reachable | `GET publisher-metadata.json`, `catalog-qualification.json`, `catalog-categories.json` | 200; 317,999 B / 102,448 B / 133,977 B [V] |
| Entry data path | `POST /api/subject`, `POST /api/catalog-integrity` for `skill.aih.docs-quality` | subject returns Core-derived ids/digests; integrity returns `indexStructure=valid`, `artifacts=verified`, `artifactsVerified=4`, `publishedEvidence.declared=3`, `byteChecked=0` — the documented split [V] |
| Served page | `GET /` | 51,071 bytes, still carrying the placeholders `Connecting to the installed…` and `Loading the installed Catalog inventory` [V] |

### What I2 changed in the register

- **G10 residual cleared [V]**: every numeric surface observed traces to served state (11 Core
  targets, 10 current of 457, 4 verified artifacts beside 3 declared evidence files, 58 passing
  tests). The design's `3 of 11` turns out to match a *real* Core count (11 supported CLIs) — a
  caution against "restoring" design sample numbers.
- **G12 refined [V]**: the preview *refuses to start* when the installed Catalog has no readable
  collection view (`preview.mjs:211-213`, `:229-236`) and fetches its own page assets before
  printing the URL (`:363-372`). So the stuck-placeholder state is **not** reachable by starting
  the preview against a broken package; it is reachable when the *page* cannot get
  `/catalog-index.json` or `/summary.json` — a server stopping mid-session, a stale run
  directory, a proxy, or a future deployment where the service is separate. The defect stands;
  its trigger is narrower than I0 implied. A browser confirmation was **not possible** here
  (`playwright`/`playwright-core` absent, no DOM runner), so the visual end state remains an
  inference from control flow.
- **New observation, not a gap — G18 [V]**: `check-page-contract` notes that 3 of the 8
  `SORT_KEYS` (`entryId-desc`, `sourceType`, `release`, `selectors.js:1`) have no option in
  `#sort-select` (`src/index.html`, 5 options). The reference shows only a sample
  "SORT: NAME (A-Z)" label, so this is an unimplemented dimension rather than a reference gap.
- **G2 unaffected [V]**: the artifact-intake API the snapshot calls is absent from
  `tools/server/api.mjs` and from every package's public surface; **ownership of that endpoint
  is the owner's to name** (recorded, not built).
- **G9's a11y item is the strongest SAFE candidate** surfaced so far: move each telemetry
  reason into visible/described text and word the two slots differently
  (`details.js:169-170`, `src/index.html:317-328`).

### Corrections to earlier claims (whole run)

1. Five "missing" core exports — false positive (`export *` re-exports). [I0 → corrected I1]
2. "The snapshot fetches package data" — false (14 of 16 `fetch` calls sit inside embedded JSON
   evidence strings). [I0 → corrected I1]
3. "The Security tab gives no reason" — false; reasons exist but are hover-only. [I0 → corrected I1]
4. "`catalog-publisher` surfaces a raw error to the operator" — false;
   `startupFact`/`sidecarFact` convert it to a stated absence. [I0 → corrected I1]
5. "G4 waits on an upcoming package" — false; Core's own docs say the authoring browser is
   gone with no replacement. [I1 → corrected I2]

### Remaining uncertainty (deliberate, not dressed up as findings)

- G15 (accessibility) is **unverified**: no browser is available, so no keyboard pass was run.
  The static markers (roles, `aria-selected`, `tabIndex`, `inert`, `aria-live`) look deliberate
  but a declaration is not behaviour.
- G12's visual end state is inferred from control flow, with the trigger space described above.
- Product decisions remain open by nature: G1, G2, G5, G6, G7, G8, G13, G14.
- Nothing about the upcoming packages can be verified until they appear; the supplied facts
  were treated as given and not silently replaced.

## I3 — copy and dead-markup verification (≈04:25 local, 2026-09-26)

Checks: a sweep of every claim string in `src/**/*.js` and `src/index.html` about what a package
does or does not publish; `navigation.js`, `qualification.js`, `verdict.js`, `vocabulary.js`
read in full; the seven `title` reasons on the disabled/absent controls read verbatim; a
**recursive** grep of core 0.6.2's public `.d.ts` files for `determination` / `policyAxis` /
`triage` / `disposition`; and a grep for any module that writes the Security tab's
"Policy Determination" block.

Findings:

1. **New gap G19 [V] — the "Policy Determination" block is dead static markup.** `src/index.html:349-370`
   holds a note ("Not published: needs a Core determination contract. This page reads evidence
   and never records a decision.") and three disabled radios valued `hold`, `false_alarm`,
   `allow_risk`. **No module references any of them** (the only `policy-choice`-adjacent hit is
   an unrelated id in `policy-workspace.js:37`), so no state will ever fill the block. Core
   0.6.2 publishes **no** determination/triage API (recursive `.d.ts` grep: only a SARIF
   "code-scanning triage" comment and a V9 HTML template), and its operator decision uses a
   different vocabulary — `disposition: z.ZodLiteral<"approved" | "accepted-with-conditions" |
   "rejected">` (`dist/org-policy/governance-decision-v2.d.ts:216`, `:322`, `:429`). So one page
   carries two competing vocabularies for the same idea (hold/false-alarm/allow-risk beside
   approved/with-conditions/rejected), and the static one is unreachable dead UI.
   Label **`DECISION`** (align the words, or mark the block unmistakably as design-only);
   presentation-only either way.
2. **Verified-good, worth recording so a later run does not "fix" them**:
   - `qualification.js:56-63` (page) and `catalog-qualification.mjs:39-45` (backend) keep
     *refused by the reader* and *package exports nothing* as different words — exactly the
     distinction commit `4ba63d6` established.
   - `navigation.js:55-65` counts both numbers at run time and never prints `undefined` or a
     borrowed zero.
   - `vocabulary.js:101-107` gives an unknown Core refusal code an explicit "this page is older
     than it" sentence rather than an empty line.
   - `verdict.js:104-118` never says Applied / Installed / Executed / Published, and states what
     `observed` does **not** prove.
   - The seven disabled/absent control reasons are accurate against core 0.6.2's public
     surface: `:58` organization review state, `:62` "needs a Core check-policy contract",
     `:65` "organization resolution and a Core publish contract", `:187` "Core source-policy
     resolution contract", `:567` "Core template contract", `:568` "Core compile/apply
     contract" — none of those APIs exist publicly, and `aih policy validate` is the real
     operator route.
3. **Candidate disproved and dropped**: `navigation.js:62`'s compound sentence ("publishes no
   curated category taxonomy, and this preview could not read how many entries carry a
   category") looked like it might overstate. Tracing the call sites shows it is reached only
   when the curated view is absent (`scopeRow`, `:151-167`) *and* the coverage counts are
   unreadable (`:61-63`), where both clauses are true. Not a gap — recorded here so it is not
   re-opened.

4. **Partially read (worth recording as progress, not as a finding)**: `src/governance/controller.js`
   lines 1-300. Its documented rule — every input change takes a revision token first, an answer
   for a stale token changes nothing (no state, no session id, no render), the previous verdict
   is cleared when any verification input changes, and Consume is offered only when nothing is in
   flight — matched the code on that range (`:233-237` session adoption, `:240-267` operator file,
   `:277-300` observation parts). The rest of that file and the rest of `src/governance/` remain
   unread, so this is not yet a verification of the README claim "one verdict, one set of inputs".

Corrections: none to earlier iterations. Uncertainty: unchanged (G15 unverifiable without a
browser; the governance/catalog/app modules listed in "Resume here" remain unread).

---

## Resume here

1. **Watch `packages/`** for the new tarballs — when they appear: hash each with SHA-256, read
   `package.json` (name/version/peer ranges) and the public `dist/*.d.ts` export maps, diff
   them against §1.2/§2.6 of `TODO-cline.md`, and re-label G3, G4, G8, G13 — and G2 if an
   artifact-intake contract appears. **Never install or replace.**
2. **Read the remaining unread sources** before touching the register again:
   `src/governance/*` (controller.js 574 lines, verdict.js, revisions.js, transport.js,
   inputs.js, observation.js, reopen.js, statuses.js, vocabulary.js), `src/catalog/{entry,
   selectors,navigation,toolbar,view-state,collections,categories,qualification}.js`, and
   `src/app/{onboarding,setup-model,organization,theme,dom,elements}.js`. Confirm or drop G15's
   a11y list and the README's "one verdict, one set of inputs".
3. **Optional runtime deepening without a browser**: serve the preview run directory from a
   throwaway static server that answers 404/503 for `/catalog-index.json`, and confirm the
   served module graph cannot replace the placeholder text (control-flow proof already
   exists); or obtain a DOM runner *outside* the repo and execute `main.js` against the served
   modules to observe the failure state directly.
4. **Confirm the two-file write limit before every action**, then append the next iteration with
   its timestamp, checks, findings, corrections, remaining uncertainty and this section again.
5. Stop when a full pass adds no new evidence. Do not manufacture findings to keep the loop
   alive.




## I4 — run 2, the packages arrived (06:50-07:40 local, 2026-09-26)

Checks (all reads; nothing installed): `packages/` listing with sizes, timestamps and SHA-256 for
all three tarballs; `tar -tzf` / `tar -xO` for manifests and payload listings; extraction to
`%TEMP%\aihpkg3` (run 1's `%TEMP%\aihpkg` kept for diffing); `%TEMP%\aihprobe2.mjs` (import
resolution: 35 named + 5 namespace members over `src/**` and `tools/**`), `%TEMP%\aihprobe3.mjs`
(index / collection / category / presentation counts, and the `applyCollections` rule applied to
both payloads), `%TEMP%\aihprobe4.mjs` (framework pins, `aih`-sourced entry ids, seed manifest);
core 0.7.0 `CHANGELOG.md`, `docs/commands.md`, `guides/enterprise-admin-guide.md`,
`dist/index.d.ts`, `dist/org-policy/{governance-decision-v2,bundle,governance-input-v1}.d.ts`,
`schemas/*`; scan 0.5.0 `dist/core/core-contract-lock-v2.js` and
`tools/verify-core-contract-lock-v2.mjs`; SHA-256 of both Cores' decision and envelope schemas;
recursive `.d.ts` greps for
`determination|triage|checkPolicy|reviewState|publishPolicy|sourcePolicy|policyTemplate|compilePolicy|compileOrganizationManifest|artifactIntake`;
`node tools/check-page-contract.mjs`; `node --test` on 8 of 9 test files; `git status --short`.

Findings:

1. **Package replacement [V].** `aihq-core-0.6.2.tgz` is gone and `aihq-core-0.7.0.tgz`
   (`C9F17E16…`, 2,886,462 B, 06:05:44) is present; `aihq-catalog-0.3.0.tgz` was replaced
   (`44292377…` / 7,233,312 B → `377e38de…` / 6,923,925 B, 06:06:42) at the same version string;
   Scan is byte-identical to run 1 (`A1524D78…`). Two owner-supplied facts are therefore stale.
2. **"Nothing blocks" is in 0.7.0 [V].** `CHANGELOG.md` D50 ("Findings are labels; nothing blocks
   on them") and D66 (`aih trust scan` / `aih skill vet` exit 0 on findings, opt-in
   `--fail-on`). This is a presentation rule for the Workbench; `src/` contains no `blocks`/`gate`
   claim [V: grep] — so the page does not contradict it, but it also does not state it. Recorded
   as safe work in `TODO-cline.md` §0.6, not as a defect.
3. **The lock still admits the new Core [V].** Decision-schema digest `7fdf1015…` and envelope
   digest `88c0a36e…` are byte-identical between 0.6.2 and 0.7.0 and both appear in Scan 0.5.0's
   accepted sets. **A false lead was disproved**: I expected 0.7.0 to move the decision schema and
   break the Strict V2 gate; it did not.
4. **Import surface intact [V].** 35/35 named imports and 5/5 namespace members resolve in the new
   packages. Core 0.7.0 removed the ECC Package Graph adapters from the library root, but this
   repo uses none of them.

5. **The repacked Catalog lost all Core-derived content [V].** Index 457 → 431 entries; the `aih`
   source type 28 → 1 (`recipe.default` only); `catalog-collection-inputs-v1.json` no longer names
   the `aih-core` collection (its `workbench/aih-core-0.6.1|0.6.2` seed dirs are gone); the
   Superpowers pin moved to `5bf4e780…` (the version Core 0.7.0 requires) while ECC's stayed at
   `5064474d…`. Qualification, core-qualification and the signed catalog are byte-identical;
   presentation, categories and runtime descriptors differ. Under the page's own rule
   (`src/catalog/collections.js:32-55`) the `aih-core` rail row and its release marker disappear.
   Reported for the Catalog owner; not fixable here.
6. **Gap labels re-checked, none newly unblocked [V].** `checkPolicy` / `check-policy` /
   `reviewState` / `publishPolicy` / `publishOrganization` / `sourcePolicy` / `policyTemplate` = 0
   hits in 0.7.0's public `.d.ts`; no `determination`, no triage API; `compilePolicy` and
   `compileOrganizationManifestV1` still exist only under `dist/org-policy/workbench/**`, which the
   exports map does not reach; `artifact-intake` (`parseArtifactIntakeText`) exists but is equally
   unreachable. G1/G2/G3/G4/G17/G19 keep their run-1 labels; G17 gains better evidence lines
   (`docs/commands.md:1031`, `guides/enterprise-admin-guide.md:54`).
7. **Repo checks re-run: no regression [V].** `node tools/check-page-contract.mjs` → all checks
   passed (ids unique, 123 relative imports resolve, 7 assets, request-path classification and
   containment). `node --test` on `cards`, `catalog-served`, `category-filters`, `inspector`,
   `publisher-refusal`, `revisions`, `session-relative`, `sessions-observation` → **41 pass, 0
   fail**. `settings.test.mjs` was deliberately **not** run: it writes under the repo's `.tmp/`
   (`settings.test.mjs:11`, `:16`, `:47`), which this run's two-file write limit disallows. No repo
   test or sweep hardcodes the Catalog content that disappeared (only
   `sessions-observation.test.mjs:21` names a Core pack path).

Corrections: (a) the owner's core and catalog facts are stale — replaced, not "unchanged"; (b) my
own hypothesis that the new Core would break Scan's contract lock is **disproved** by digest
comparison; (c) run 1's preview observation "457 entries, `aih-core` 9 members" must not be reused
for the new Catalog; (d) run 1's `TODO-cline.md` §1.2 table is now a historical record (annotated,
not deleted).

Uncertainty: the Catalog build's provenance (`c8e2c03`?) and whether dropping the Core collection
was intended [I]; the rendered effect of the collection change is code-plus-payload derived, not
browser-observed; run 1's G15 accessibility list remains unverified without a browser; the preview
and the acceptance sweep were **not** executed this run because they `npm install` the tarballs
into a throwaway consumer (`tools/packages.mjs:186-211`) and this run forbids installs — so run 2
produced contract, payload, code and page-contract evidence only, no runtime evidence.

## I5 — register re-check and write-limit proof (07:05-07:15 local, 2026-09-26)

Checks (all reads, plus one deliberate determinism probe): full read of
`src/governance/verdict.js` (181 lines) and `src/app/policy-workspace.js` (67 lines); grep of
`src/index.html` for `block|Blocked|finding|Finding`; mtime scan of every file under `src/`,
`prototype/`, `tools/` and the tracked root files for changes after 06:45; `git status --porcelain`;
`git check-ignore -v src/styles/tailwind.css`; SHA-256 of `src/styles/tailwind.css` before and after
a fresh `node tools/build-css.mjs`.

Findings:

1. **G17's copy is confirmed verbatim in the working tree [V]** —
   `src/app/policy-workspace.js:10-12` (vibe), `:19-21` (admin), `:28-30` (developer), rendered at
   `:46-54`. The run-1 line numbers remain exact, so §0.6 item 1 needs no re-derivation.
2. **The page is consistent with D50 but silent about labels [V]** — `verdict.js:34-76` renders an
   outcome, the reason, evidence rows and the execution sentence; `:104-118` states "Nothing was
   installed, applied, executed or published", and the file's own header forbids reading as
   Applied/Installed/Executed/Published. Nothing anywhere claims that findings block, gate or
   authorize; nothing states that they are labels either. The natural insertion point for §0.6 item
   2 is the `govVerdict` readout next to `executionSentence` (`verdict.js:104-118`) and the Security
   tab's finding slot (`src/index.html:319-326`), which still reads `Not published` — honest, since
   0.7.0 publishes no findings *reader* at the library root and Scan's typed reader stays the only
   route.
3. **No tracked file changed in run 2 [V].** The only repo file with a post-06:45 mtime is the
   gitignored generated stylesheet `src/styles/tailwind.css` (06:56:35), rewritten by the repo's own
   check (`tools/check-page-contract.mjs:31` → `tools/build-css.mjs:24`). A fresh
   `node tools/build-css.mjs` produced byte-identical output (`DF22C7741D075C390FE623277E914B02CCDBE753E07C0A48A8AFE3E9C9422FFC`
   before and after), so the regeneration is a pure function of unchanged tracked inputs;
   `git status --porcelain` still lists exactly the 26 modified + 18 untracked paths run 1 started
   from. Two-file write limit respected: `TODO-cline.md` and `cline-llm-analysis-overnight.md` are
   the only files this run authored.
4. **G19's vocabulary is still on the page** — the only `block`-family text in `src/index.html` is
   Tailwind classes plus the three policy-choice labels ("Keep held back (Recommended)", "Not a real
   problem (False alarm)", "Accept the risk and allow", `:355`, `:361`, `:367`), which are policy
   vocabulary, not a claim that findings block.

Corrections: none to §0.1-§0.5; §0.6 item 2 now carries verified insertion points. Uncertainty
unchanged (no runtime evidence in run 2; no browser).

## Resume here (run 2)

1. **Watch `packages/`.** On any new tarball: SHA-256 it, then diff `dist/*.d.ts`, the Scan lock
   constants and the Catalog defaults against `TODO-cline.md` §0.1-§0.4 and revise §0.5. Never
   install or replace.
2. **Ask the owner** (a) whether `377e38de…` is the intended Catalog build and (b) whether the
   missing `aih-core` collection and the 27 Core entries are expected. `TODO-cline.md` §0.4 is the
   evidence to hand over.
3. **Safe work when acting is allowed**, in `TODO-cline.md` §0.6 order: G17 copy, the D50 sentence
   in Governance, G9 visibility, G12 stuck placeholders, then the decision items.
4. **Do not** re-open G10/G11/G18, and **do not** build authoring, artifact-intake, publish,
   check-policy, determination or compile UI — neither 0.6.2 nor 0.7.0 publishes those contracts.
5. When a browser or an install-permitting run is available, execute the preview against the new
   tarballs and report the rendered collection rail, the entry counts and G12's failure state: the
   only runtime evidence on record is from the old packages.
6. Stop when a full pass adds no new evidence. Do not manufacture findings to keep the loop alive.

---

## I6 — run 3, first pass (2026-09-27 01:41–01:55 local, 06:41–06:55Z)

Context: an updated owner brief (same text as run 1's, so its package facts are stale) plus a
package change while the repo sat untouched: **a second Core 0.7.0 build landed at
2026-09-26 23:41:53**. Catalog and Scan are byte-identical to run 2. Same write limit (the two
root files only); new extract at `%TEMP%\aihpkg4`, diffed with `git diff --no-index` against run
2's `%TEMP%\aihpkg3`. Deliverable: `TODO-cline.md` §0A (inserted before §0) plus in-place
citation annotations; §§1–8 untouched.

Checks: SHA-256 of all three tarballs at start and at 01:49 (stable); full tree diff of the two
Core extractions (77 files, +4,546/−18,462, 754 → 740 files); hash-compare of `dist/index.d.ts`,
`CHANGELOG.md`, both contract-lock schemas; parsed `dist/index.js` export tails (256 vs 256,
set-identical); `package.json` diff (version, `exports` map, fixture pins unchanged);
`docs/commands.md`, `docs/governed-mcp.md` and README diffs with citation re-anchoring;
`git status` + tracked-file mtime scan; `node --test` on the 8 non-settings test files;
module-resolution probes for `@aihq/*`; re-read of `tools/preview.mjs` + `tools/packages.mjs`
for install behaviour; G14's premise re-checked in the new extraction.

Findings (new or changed):

1. **Package event [V]** — hash table in `TODO-cline.md` §0A.1. The brief's
   `aihq-core-0.6.2.tgz` still does not exist; §0.1's core row (`C9F17E16…`) is superseded by
   `76058709…` (2,711,301 B, mtime 2026-09-26 23:41:53). Scan `A1524D78…` and Catalog
   `377E38DE…` unchanged for the whole run, so §0.3's lock conclusion and §0.4's missing-
   `aih-core` finding stand without re-derivation.
2. **The rebuild does not change any UI contract [V]** — byte-identical `dist/index.d.ts` (type
   surface), byte-identical `CHANGELOG.md` (D50 intact), byte-identical schemas carrying the
   exact §0.3 digests (`7FDF101568CD7CAA…`, `88C0A36E91772016…`), unchanged `exports` map,
   set-identical 256-name runtime export list. Every §0.5 conclusion therefore carries verbatim;
   no label in §§1–8 changes.
3. **Docs moved; quotes survive [V]** — `docs/commands.md` reflowed (310 lines). The three scope
   quotes now sit at **:794** (no `aih-ui` replacement), **:796** (compilePolicy not public),
   **:806** (retired admin route); the bind/rebind/revoke lifecycle is at **:766-790**.
   `guides/enterprise-admin-guide.md:54` is verbatim (guides byte-identical). Mapping recorded in
   `TODO-cline.md` §0A.3; §0.5/§0.6 citations annotated in place. Heading-level diff: no new
   `aih policy` commands → G1/G3/G5/G13/G18 stay blocked.
4. **What changed is ECC, and it is not UI-facing [V]** — ECC installer/materialization modules
   deleted, `packages/framework-ecc/dist/index.js` −12.9k lines, `governed-mcp.md:47-56` now says
   ECC installation is developer-managed, root README's ECC sections rewritten (top unchanged).
   The UI imports no ECC module, no export was lost, the page's framework matrix renders Catalog
   data (byte-identical), and Core still ships `dist/catalog-package/framework-descriptors.d.ts`
   (G14's premise holds).
5. **Tests reproduced [V]** — `node --test` on cards, catalog-served, category-filters, inspector,
   publisher-refusal, revisions, session-relative, sessions-observation → **41 pass, 0 fail**
   (01:47 local). `settings.test.mjs` excluded (writes the repo's `.tmp/`; file count 31 → 31
   across the run); `git status` 42 lines before and after. The suite loads no package
   (`node_modules/@aihq` absent, lockfile has 0 `@aihq` entries;
   `import('./tools/service/policy-review.mjs')` → `ERR_MODULE_NOT_FOUND`, while
   `catalog-served.mjs` loads because its package mention is not a top-level import), so the run
   says nothing about the new Core build — it is src-regression evidence only.
6. **Repo unchanged since run 2 [V]** — no tracked-file mtime after 2026-09-26 07:20; status =
   26 modified + 16 untracked collapsed paths (90 files with `-uall`). **Discrepancy:** run 2's I5
   recorded 44 (26+18); two collapsed untracked paths are unaccounted. Untracked deletions leave
   no trace; `.gitignore` (8 rules, unchanged) covers `packages/*.tgz`, `.playwright-cli/`,
   `.tmp/`, `.aih-ui/`, `node_modules/`, `src/styles/tailwind.css`, `dist/`, `.env*`. Low
   materiality; unresolved.
7. **No runtime evidence in run 3 [V for the reason]** — the preview npm-installs the tarballs
   (`tools/packages.mjs:186-211` `installConsumer`) and rewrites gitignored
   `src/styles/tailwind.css` via `buildCss` (`tools/preview.mjs:35`); both fall outside this
   run's rules, so no preview or browser run was attempted. All page-behaviour claims remain
   static [I].

Corrections:

- **My own false alarm:** I first read run 2's I4 as claiming six test files (`api-routes`,
  `core-service`, `entry-contract`, `policy-review`, `scan-verifier`, `setup-model`) that exist
  nowhere in the repo, and briefly suspected a fabricated claim. Re-reading the log's actual line
  showed those names were mine, not the log's: I4 names the real files (cards …
  sessions-observation). The claim stands and is now independently reproduced (finding 5).
- **Run 2's I3 "README:1-2 = line 2 the one-line promise"** is inaccurate even for its own
  extracted build: line 2 is blank (line 1 title, badges at 3–9; identical in both builds). No
  conclusion depends on it; no TODO citation uses the Core README.
- My repo-state script printed directory entries unconditionally (script bug); the file-level
  mtime scan is the reliable signal, and it shows no post-run-2 tracked change.

Remaining uncertainty: no runtime/browser evidence for run 3; the ±2 untracked-path discrepancy;
the `c8e2c03` Catalog fixture pin vs the supplied `377e38de` build (owner question 2 open);
Scan's "pack4" label unverifiable from the tarball; dist chunk churn not line-audited beyond
contracts, exports, docs and ECC scope; whether more tarballs arrive overnight.

Verification coda (01:57 local): both files re-read for structure (§0A at `TODO-cline.md:32`,
§0 intact at `:121`; I6 at log `:388`; the Resume section follows this coda); `git status` still 42 lines and the
only files with a 2026-09-27 mtime anywhere in the working tree are the two permitted ones;
reference files unchanged overnight (`prototype/index.html` 24,914 B mtime 2026-09-20,
`aih-policy-workbench.html` 3,826,488 B mtime 2026-09-25 — run 1's reference inventory still
describes the files on disk); packages re-hashed at 01:57:18 — unchanged, no further arrivals
during this pass. No further check available under this run's rules produces new evidence; the
loop stops here unless a package change or owner input arrives.

## Resume here (run 3)

1. Re-hash `packages/` first. On any change: SHA-256, extract to a fresh `%TEMP%` folder, diff
   `dist/index.d.ts` / `CHANGELOG.md` / the two schemas / export tails against §0A.2, and revise
   §0A. Never install or replace.
2. Hand the owner `TODO-cline.md` §0.4 (the repacked Catalog lost the `aih-core` collection) and
   the open `c8e2c03` vs `377e38de` fixture-pin question (§0.1/§0A.1).
3. Safe work unchanged — `TODO-cline.md` §0.6 order: G17 copy (now citing `commands.md:794`),
   the D50 sentence in Governance, G9 visibility, G12 stuck placeholders, then decision items.
4. Do not open G10/G11/G18, and do not build authoring, artifact-intake, publish, check-policy,
   determination or compile UI — 0.6.2, 0.7.0-run2 and 0.7.0-run3 publish none of those contracts.
5. If a rules-compatible runtime appears (install-permitted run or pre-built consumer), capture
   the collection rail, the entry counts (457 run-1 data vs the 430 §0.4 expects) and G12's
   failure state — still the only behaviour claims with no runtime evidence.
6. Stop when a full pass adds no new evidence. Do not manufacture findings to keep the loop alive.

# Report

`/report.html` shows what this Workbench recorded about the machine since it started, as
Core's normalized claims. The page fetches `GET /api/readiness-report`; the host turns its
readiness journal into a claim set (`aih-ui/claims`), `@aihq/core/report` validates and projects
it, and `src/app/claims-view.js` turns the projection into panels. The page and the headless
`reportText()` print the same panel strings and compute no meaning of their own.

## What it shows

| Panel | Content |
| --- | --- |
| Configuration-check score | Passed checks over all checks of the latest machine check, or `Unavailable` with the reason. Unknown checks stay in the total; failed checks are listed whatever the score. The check set and calculation method are named with their versions. |
| Verified repairs | Core's count, then every attempt with its reason, counted or not. |
| Suggested actions | Core's ranked actions: blockers, urgent reviews, important unknowns. |
| Claims | Each check, condition and repair claim: kind (Measured, Estimated, Declared, Unknown), value or `Unavailable — <reason>`, coverage, freshness, de-duplication and its sources. |
| Context and usage | Measured file size, estimated configured context and observed usage as three separate series. Unknown is never 0 and an estimate is never compared with usage. |
| De-duplication | Events counted once, conflicting records and records without an event identity. |

The read-only text box is the headless rendering of the same records.

## Record to claim

| Readiness record | Claims |
| --- | --- |
| Machine check | A `configuration-check` claim and a `condition:<check id>` claim per Core check, plus a `condition:<check id>` claim for the same check made with the persisted configuration when the record carries it. Passed or failed is Measured; unavailable, skipped and client `…/loading` observations are Unknown with Core's reason. |
| Repair | A `repair` claim per target when an operation was applied, a `condition:<check id>` claim per rechecked condition, and a `persisted-configuration` claim per persisted value Core reported for the recheck, Measured with Core's state (`applied`, `removed`, `modified`, `unowned`). The Core run is a source. |
| Two machine checks with no repair of the target between them | An attempt with no repair, so Core reports an unknown cause or no recovery. |
| Scan report read | One measured `file-size` claim in bytes. |
| Estimate | An Estimated `configured-context` claim. |
| Usage | A Measured `observed-usage` claim; with none, one Unknown claim. |

Each claim keeps its record id and SHA-256 as a source, so importing the same record again is
the same claim and a record id re-used with other content is shown as a conflict. The same holds
for estimates and usage: an identical entry twice is one claim, and two entries for one event with
different amounts are both shown as a conflict. Ids that look like a machine-local path are refused.

## What counts as a verified repair

Core counts a condition once: the same check **failed** before, a repair for it was **applied**,
and the same check **passed** afterwards. Nothing else counts:

- already passing before the repair is `already-healthy`;
- failed, then passed with no repair applied is `unknown-cause`;
- applied but not yet passing is `applied-unverified`, still failing is `repair-not-verified`
  (both also rank an urgent review);
- no earlier machine check is `unknown-precondition`.

The machine check records each condition for this host (`process`) and, when that inspection
ran, with the persisted configuration (see [readiness](readiness.md#persisted-configuration)). The post-repair
recheck uses the persisted configuration. (The friction check keeps the two configurations as separate timelines for the same reason.) The precheck Core sees is chosen so that a repair
counts only when:

1. the condition **failed in both** configurations before the repair;
2. the repair was applied;
3. the persisted recheck passed.

| Before: this host | Before: persisted | Persisted recheck | Result |
| --- | --- | --- | --- |
| passed (for example a CA the developer trusts) | any | any | `already-healthy`, not counted |
| failed or unknown | passed (for example a Core-managed block from before this host started) | any | `already-healthy`, not counted |
| failed | failed | passed | `verified`, counted once |
| failed | failed | failed | `repair-not-verified` |
| failed | failed | did not answer | `applied-unverified` |
| failed | unknown | any | `unknown-precondition` |
| unknown | failed or unknown | any | `unknown-precondition` |

When it failed in both, the persisted failure is the precheck, the same configuration as the recheck.

A record without the persisted inspection (from an older Workbench or Core) never pairs, and
neither does a recheck made with this host's own trust: the attempt is `unknown-precondition`. A
recheck that failed before Core answered keeps its precheck, so the attempt is `applied-unverified`.
When the two configurations disagree in the latest machine check, an important-unknown action
says so; the score and blockers keep using this host's result.

A later machine check does not add a second win for the same repair.

After a repair, the latest machine check no longer describes the targets that repair rechecked:
its claims for them read "Recheck needed", they stop producing blockers, and one action asks for
the machine check to be run again. Failed checks of targets no repair touched stay current blockers.

## What stays unknown

- Client usage: the Workbench collects none, so observed usage is Unavailable.
- File size and estimated context appear only when a Scan report read or an estimate is supplied
  to the adapter.
- Checks that did not run (offline, unavailable, skipped, deadline) and client loading that was
  observed but not verified.

## Limits

- Records live in the host's memory (latest 64) and are lost when the host restarts; nothing is written to disk.
- The page shows readiness records only. Scan reads, estimates and usage are headless adapter
  inputs (`readinessReport({ scanReports, estimates, usage })`); the page does not collect them.
- `generatedAt`, the instant the caller passes to `readinessReport`, is the capture time of the Unknown usage claim; the host passes its own clock.
- The report is a projection for the developer; it does not change anything and grants no approval.

## Saved snapshot report (V9)

The page also draws a saved `@aihq/core/report` snapshot as one self-contained, offline HTML page in
the V9 developer-console design. Core owns the snapshot: its shape, `createReport`, `importSnapshot`,
`exportSnapshot`, `validateSnapshot`, the bounds and the privacy projection. The Workbench owns how it
looks, and reads the snapshot only through those public functions.

| Piece | Where |
| --- | --- |
| Renderer (no package, file, network or clock access) | `src/report/render.js`, `createReportRenderer(reportData)` |
| Authored V9 shell | `src/report/templates/report.html` (not served on its own) |
| Generated template module | `src/report/template.js`, from `node tools/report-template.mjs`; `--check` verifies it |
| Binding to the installed Core | `tools/report/core-report.mjs` |
| Offline tool | `tools/render-report.mjs` |
| Page section and host route | `src/report.html`, `src/report/snapshot-view.js`, `POST /api/report-render` (`tools/server/report.mjs`) |
| Checks | `tools/tests/report-render.test.mjs`, `tools/check-report.mjs`, `tools/report/visual.mjs`, `tools/report/page-browser.mjs` |
| Attribution | `src/report/NOTICE`, `src/report/LICENSE` (Apache-2.0) |

`renderReport(snapshot, { title?, mode? })` takes a title of 1–200 characters (default `AIH report`)
and a mode of `report` (default) or `demo`; any other option value throws `TypeError`. The snapshot is
re-projected through `exportSnapshot` and `importSnapshot` before it is drawn, so invalid input throws
Core's `ReportInputError` (`INPUT_INVALID` or `SCHEMA_UNSUPPORTED`), in demo mode too.

Offline, without a server:

```
node tools/render-report.mjs <snapshot.json> <out.html> [--demo] [--title <text>] [--consumer <dir>]
```

`@aihq/core` is found in `node_modules` from `--consumer`, else from the current folder, else from
this repository. Core validates the file before anything is written; an invalid snapshot prints
Core's code and reason and writes nothing. An existing output file is never replaced.

On the page, the person opens a snapshot file and chooses the snapshot or the design sample. The host
validates it with the installed `@aihq/core/report` and renders it with the same renderer; the page
shows the document in a frame sandboxed to an opaque origin (scripts only) and offers the same bytes
to save. The route takes a same-origin `application/json` post of the snapshot document, at most
2 MiB, with `?mode=report` or `?mode=demo`; an invalid snapshot answers 422 with Core's code.

### What the page shows

- **Offline and deterministic.** Inline CSS and script, system fonts, no external request. Identical
  snapshot and options give identical bytes; the only clock is the topbar time, filled in at view time.
- **Escaped.** Every supplied string is HTML-escaped. The embedded `window.AIH_DATA` literal escapes
  `<`, `>`, `&`, U+2028 and U+2029, so supplied text cannot end the script or add markup.
- **No score.** Counts are the snapshot's own `metrics.counts`. Readiness wording is factual
  (`FAILED CHECKS`, `UNVERIFIED GAPS`, `NO FAILED CHECKS`, `NO CHECKS REPORTED`, or `NOT EVALUATED`
  when `status` is not `completed`) and never says "ready".
- **Report mode.** Every document says **Saved snapshot display**. Five of the 14 sections are LIVE
  ("LIVE · supplied snapshot" or "LIVE · caller-labelled newly acquired"; live means supplied, never
  fresh): `sec-hero` (status, counts, totals), `sec-ready` (failed and not-evaluated checks, and the
  evidence and provenance card), `sec-actions` (items ranked mechanically from failed checks, broken
  tools, diagnostics, unavailable and skipped checks, absent and config-only tools, each with "no
  command supplied"), `sec-adoption` (check chips, tools by state, observations) and `sec-support`
  (a copy-ready draft of the findings). The other nine are EMPTY with a reason and no number; a
  missing measurement is never drawn as zero.
- **Evidence limits.** `binary` is "found — not run", `config-only` is "not verified", observations
  are "observed, not verified". Structural validation, the original-evidence SHA-256 (not recomputed)
  and authentication (`not authenticated`) are three separate rows.
- **Design sample.** Demo mode is the authored V9 sample with its DEMO banner, DEMO chips and PREVIEW
  ribbons: every number, name and command is invented, and none of the snapshot's values is drawn
  (the snapshot is still validated). The page adds its own design-sample note beside the frame.
- **Static and hydrated.** The document is complete with scripts off. The same section HTML is
  embedded in `window.AIH_DATA` and re-applied on load, so static and hydrated sections are
  identical. The Ctrl+K palette jumps between the 14 sections; without scripts each is reachable by
  its `#sec-…` anchor.

### Checks

`npm run check:workbench` runs `tools/check-report.mjs` against the installed Core. It verifies that
the template reproduces from the shell; that, while the installed Core still exports
`./report/render`, the Workbench renderer draws Core's bytes for every fixture snapshot
(`tools/report/fixtures.mjs`), both modes and an escaped title, and refuses invalid input and options
with the same error (once Core no longer exports it, the comparison is recorded as skipped); and that
the offline tool writes the renderer's bytes, refuses an unsupported snapshot without writing and
never replaces a file. Its visual check renders the workflow snapshot in both modes with scripts off
and on in Chromium (`REPORT_BROWSER_CHANNEL`, for example `msedge`, selects an installed browser) and
saves `report-static`, `report-hydrated`, `demo-static` and `demo-hydrated` full-page and `-hero`
screenshots with `visual-check.json` under `report-evidence/visual/` in the check output. It fails on
a page or console error, any network request, a missing section, an invisible or mis-sized outcome
bar, report-mode states other than 5 LIVE and 9 EMPTY, hydrated sections that differ from static
ones, or a broken palette. The integrated Workbench check drives the page section in Chromium
(`tools/report/page-browser.mjs`). The screenshots, `visual-check.json` and `report-equivalence.json`
from one run against Core 1.0.0-dev.37 are kept in [report-evidence](report-evidence/). Only Core's
single supported diagnostic contract is bound, and only Chromium is checked.

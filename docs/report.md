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
| Machine check | A `configuration-check` claim and a `condition:<check id>` claim per Core check. Passed or failed is Measured; unavailable, skipped and client `…/loading` observations are Unknown with Core's reason. |
| Repair | A `repair` claim per target when an operation was applied, and a `condition:<check id>` claim per rechecked condition. The Core run is a source. |
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

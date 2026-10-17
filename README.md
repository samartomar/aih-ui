# aih-ui

The Policy Workbench user interface for AIH, built as an independent application.

## What this repo owns

- The screens, interaction and presentation of the Policy Workbench.
- Consumer draft editing, selection interactions, composition through public Catalog and Core validators, and policy import/export. This is application workflow; Core retains policy validity, organization authority and execution semantics.
- Versioned consumer saved intent: explicit roots, exact template origins, optional skips, configuration, source provenance and content pins. `metadata.aih.workbench` is a consumer convention. Catalog remains the dependency/configuration validator; Core remains the policy and execution authority.
- The versioned Workbench journey envelope (`aih-ui/journey`, `schemas/journey-envelope/1.0.0.json`): a non-executable record that keeps unresolved authoring drafts beside the exact saved-intent bytes they reference. Later record kinds are added as new versioned record schemas.
- Maintenance dispositions (`aih-ui/maintenance`, `schemas/journey-record-maintenance-disposition/1.0.0.json`): an optional journey record that remembers keep current, skip this exact revision or defer (optionally until a date) for an available update, by category, subject selection, scope and exact candidate revision. Opening a draft and Check now only read the envelope and the host-configured sources; they never scan, run native checks, call a model, apply anything or schedule anything. A defer date is considered only when the Workbench opens or checks. A later revision is a separate update, authority and evidence facts stay visible whatever the choice, and unselected update categories are never checked or added. Under an update source's host-declared order, a candidate listed before the selected revision is not offered, and an update whose order is unknown (the selected revision is not in the source, or the candidate is listed on both sides of it) says so. An ordinary saved policy gets the same check, and recording a choice on it saves it as a draft. A second optional record (`schemas/journey-record-maintenance-check/1.0.0.json`) keeps the time and category states of the last successful check, written only when an envelope is saved, so a reopened draft can show them while sources are unreachable. A malformed disposition or check record refuses the whole envelope, like the unresolved-draft record.
- Organization baseline drafts (`aih-ui/organization-author`, `schemas/journey-record-organization-draft/1.0.0.json`): a required journey record that keeps an organization author's entries, obligations, selectors, input permissions and declared targets beside the empty Enterprise starting policy. A declared target's client is chosen from the AI clients the installed Core publishes, with Harness labels; when Core's list is unavailable the field says so and only a target without a client can be added. Each entry's client selector offers the same list. An edit that names a client outside Core's `nativeClientIds` is refused with Core's reason (`unknown-client`); a saved draft that already holds one still opens, shows it as not known to Core, and export reports Core's refusal. Listing a client does not mean it is installed or connected. Preview results (admission, advisory, fulfillment, contradictions) come from Core. Export writes a candidate organization policy, an explanation and the repository, path and ref to hand to a pull request; it does not publish, authenticate or sign, and never activates authority. Developers are governed only by what is merged and read at the configured source.
- Improvement suggestions (`aih-ui/improvements`, `schemas/journey-record-improvement-suggestion/1.0.0.json`, `schemas/journey-record-improvement-dismissal/1.0.0.json`): two optional journey records, a suggestion and the dismissal that binds its exact revision. Suggestions come from a fixed, versioned rule table (rules 1.6.0) over the open draft, the AI clients saved in setup, the supplied Catalog and an optional goal; no model is called, nothing is read from the network and nothing is applied. A suggestion carries a stable identity, the goal, scope, proposed change, reasons, supporting references, Catalog overhead facts and explicit unknowns, with one leading suggestion and at most three alternatives. Identity ignores labels, descriptions, release digests and rule wording, so a dismissal survives a rename or a reopen; it shows again only when a new reason applies or the content of the item, or of an item it needs, changes (with that reason shown) or when the person asks. When Core publishes its client list, only saved clients on it are used, named by their Harness labels; a saved client Core no longer lists is shown as not listed, gets no suggestion and stays saved. Without a published list every saved client is used, named by its id. Against the host's configured update source, an item that is new or revised (its own content or an item it needs) in a newer release of a source the policy was saved from (by the order declared by this host's update source when known, otherwise by a strictly later semantic version) is suggested only when a saved guided-setup goal makes it relevant (a goal rule names it, or a phrase of a matching rule is in its label or description); novelty alone suggests nothing. The check always says whether content changes were checked (no source configured and an unreadable source are unknown, not "nothing changed", and so is a different release of a saved package that neither that declared order nor a semantic version orders: `version-order-unknown`). A failure that came back after it was fixed, on something the draft selects, is suggested the diagnosis practice (`mattpocock.diagnosing-bugs`) from stored Core results the host already holds (in the Workbench, the readiness and repair records of the checks the person ran here); the check says whether that was checked (see "Recurring friction from stored Core results" below). The optional AI prompt is attributed to the rules, is text to copy into an AI client the person already uses, and is never sent or run by the Workbench.
- Improvement trials (`aih-ui/trials`, `schemas/journey-record-improvement-trial/1.0.0.json`): an optional journey record for one bounded trial of a suggested Catalog item, linked to its suggestion by id and keeping the suggestion revision it tried and the exact change it tests. The person defines the acceptable outcome and its quality checks when proposing the trial, before anything is compared; the quality bar changes only by revising the trial. A trial needs at least one bound, and every bound states its label, value and unit and is advisory unless the host names a mechanism that enforces it; the Workbench host names none, so no bound is presented as a cap, and unknown costs are listed as unknown. The lifecycle is proposed, started, then kept, revised or stopped. A decision keeps a snapshot of the evidence outcome (qualifying improvement, no demonstrated qualifying improvement, or inconclusive), and the person may record a deliberately narrower accepted outcome beside it without changing it. Keep selects only the trial's item at the chosen scope through the ordinary draft edit and leaves every other choice untouched. Stop ends the evaluation; any restoration the person asks for is tracked separately as proposed, pending, completed, partial or unsupported, as the person records it. Nothing is inferred as undone or adopted from a stop or an inconclusive result. Quality is evaluated first, from the trial's own checks: any failed check means no demonstrated qualifying improvement, and an unrecorded check leaves the result inconclusive. Overhead for setup, indexing, runtime/context and maintenance is then put through Core's claim set and `context-change` calculation, and each row shows Core's result, including Core's reason when it cannot compare two values. The runtime/context row the host measures is configured material size, not observed usage, and is measured only against the draft the trial was proposed from: once that draft has changed, both sides are recorded as unknown until the trial is revised. Each trial record carries a revision derived from its content, so a record edited without recomputing it is refused when read.
- Workspace declaration and local checkout bindings (`aih-ui/workspace`, `aih-ui/workspace-host`, `schemas/journey-record-workspace-declaration/1.0.0.json`, `schemas/journey-record-local-binding/1.0.0.json`): two optional journey records. The declaration is portable: workspace id and revision, repository members with their declared logical identity (host/owner/name) and confirmed aliases, and each member's responsibilities, instruction locations and contract references recorded as known or explicitly unresolved, plus confirmed relationships with endpoints and provenance (and optional unconfirmed suggestions). An empty or incomplete relationship set is valid and is shown as unresolved; it is complete only when the owner says so. A local binding ties one member to one checkout folder the person chose and records the identity, revision and working state observed there; it is local state and never portable execution permission. Binding is deliberate: an exact or confirmed-alias match binds, while a fork, a similarly named repository, an ambiguous or missing remote (a remote this build cannot read counts as ambiguous next to a matching one), a moved checkout (a rebind that replaces an earlier one) or an additional checkout of a member that is already bound (another worktree or clone) each need the person's confirmation of exactly what was observed, against a fresh read of the folder; an unrelated repository, another member's repository and a folder already bound to another member are refused. Different worktrees of one repository stay different bindings, and workspace members are not the saved-intent roots. A repository identity keeps a non-default port (another port is another service) and compares case-insensitively only on github.com, gitlab.com and bitbucket.org; Verify checkouts compares the recorded remotes with the observed ones and reports any difference, or an ambiguity that is new since the person confirmed, as an identity change. Relationships go back to unresolved when a member is added or removed or a member's repository or aliases change (a case-only edit on a host that folds case is not a change). The default export is a defined portable artifact: it keeps only the records of kinds this build knows to be portable (unresolved draft, maintenance disposition and check, improvement suggestion, dismissal and trial, organization draft, workspace declaration), leaves out every local binding of any version (and with it every absolute path) and every optional record of an unknown kind (nothing says what it carries), and reports both counts as `excluded`; an unknown required record cannot be left out, so it refuses the export. The declaration validator refuses local paths (a drive, UNC or `file:` path, `~/`, an absolute POSIX path under a root a local machine, container or CI uses such as `/srv/x`, `/home/x` or `/app/src/x`, a top-level file such as `/private.pem`, or a credential file such as `/x/.env` or `/id_rsa`), URL credentials and token, key and password patterns (`token=` or `password:` followed by a secret-looking value) in any field, while ordinary routes and prose (`/v1/orders/`, `serves api/root/health`, `password: reset emails`) stay valid. This text check recognizes these patterns; it is not a general secret scanner, so what the export structurally leaves out (bindings and unknown records) is the guarantee, and typed text is checked on a best-effort basis; the export itself refuses, keeping the file unchanged and naming only JSON pointers (an unsafe key is reported as `~unsafe-key`), when any text or key in the remaining records or the saved intent looks like one. A record version this build does not read is refused explicitly with the original bytes kept, and other edits keep carrying it. The host reads a folder only through local Git metadata (revision, branch, remote names reduced to identities, read from the repository's own configuration including its includes and worktree configuration) and a digest of the working state, computed locally and never stored: the status output, the staged changes (blob ids and modes), the content of changed files and, for an untracked folder, the paths and content digests of its files (at most 20000 entries); an unmerged checkout is refused. No fetch (lazy fetching in a partial clone is switched off and status detects no renames) and no write; fsmonitor and the untracked cache are disabled, every content filter the repository defines is switched off for the read, submodules are ignored (their state is not part of the identity), inherited GIT_* variables are dropped, no raw remote URL is stored or shown, and Git runs as a child process with asynchronous file reads, so Verify checkouts does not block the server.
- Reviewed batches (`aih-ui/batch`, `aih-ui/batch-host`, `schemas/journey-record-reviewed-batch-1.0.0.json`, page `/batch.html`): an optional journey record describing one reviewed change across scopes, such as adding a second client (B) beside an existing one (A). It records the selected categories and actions in their reviewed order, each scope's role, client and exact target folder, each action's exact saved-policy selection (id and digest) and shared inputs (material digests), the dependency edges, the disclosed checks and the person's choice after a failure (stop, or continue independent actions). It is a description, never a prepared handle: it holds no session, review digest, run or outcome, and every review, run and recovery prepares fresh work through the execution host, each scope folder separately. A client comes from Core's published list; being listed is not being installed or connected. Review shows the conflicts it checks for before anything is applied (a Core conflict, two actions on one target, a target inside another scope, nested scope folders, an unlisted client, a changed shared input) and a run refuses while any of those remains; other conflicts surface only when Core prepares or applies. A batch is refused when an action's selection needs another selection that no action of its scope carries, when its inputs are not exactly the local material its inline recipe reads, or when its recipe cannot be inspected that way; an envelope with a required record this Workbench does not know can be reviewed but is never run or recovered. A run verifies each shared input before every action that uses it, stops a failed action's dependents and continues independent actions only under the continue choice, and reports each action, and each scope's unrelated files, as completed, failed, untouched, cancelled or unknown, exactly as Core and the folder reported; there is no all-or-nothing promise across scopes. Recover reinspects current state and writes a superseding batch for the rest. Finished file work that still stands, or that the person has since edited, is kept and not re-applied; a kept result that no longer stands is reported as failed. Core's published interface cannot show that an opaque process already ran, so recovery keeps such an action too, never runs it on its own, and reports it untouched; the person can tick Run again for it, and actions that depend on it wait until it has completed. Run again is a choice for one run of the batch as stored when it was made: the page sends the ticked actions, with the stored revision of the batch it rendered, with that review and that Apply; the box is always shown unticked (after a reload, a recovery or a run); and the choice is saved nowhere, so a reload or a second Apply never runs the process again. Any attempt at an opaque process, the first or a Run again, records itself before it can run: just before the process runs the host saves the batch as a new stored revision (a first attempt as a superseding batch that keeps the action, a Run again as the same batch at the next revision) and waits until that is saved, so an earlier choice cannot be reused. A second page, tab or caller holding a choice made against an older revision is refused (`BATCH_RERUN_STALE`, 409) before anything runs, and the page then unticks every box, shows the batch as stored and asks the person to review and choose again. Planning the process in the first place is the first choice and is used once in the same way. Every save is a compare-and-swap on the stored batch (the envelope file is replaced only while its stored revision is the one the run started from), so replaying older bytes of a batch that was already spent is refused by the saved state, and if the attempt cannot be saved the process does not run (failed, `consent-not-recorded`). Within one Workbench host process every replace of an envelope file, whether the page's own write (a continuation choice, a recovery) or the record of an attempt, is a compare-and-swap serialized with every other: it runs in its own turn, reads the stored revision and writes only if that is the expected one, so of two writers holding the same revision exactly one is applied. A refused page write answers `BATCH_CHANGED` (409); a refused attempt record leaves that action failed with `consent-not-recorded` and nothing applied for it. There is no lock file to leave behind or reclaim. Two separate host processes writing one envelope file are not supported; the batch page has exactly one. The record holds absolute local folders, so the default sharing export leaves it out and counts it as `excluded.batches`. `AIH_BATCH_FIXTURE` is a demonstration and test input naming the envelope file, a disposable Core account home and test faults; the page's host runs Core in a child whose account home is that folder and which never writes the envelope file: it asks the host process to save each spent batch, and that process alone writes the named file. Without a fixture no batch host starts.
- Portable human evidence-review decisions, history and reconsideration through the same supported UI/headless boundary. Exact checked evidence bindings remain separate from producer authentication and execution authority.
- Current host-selected Enterprise authority presentation and explicit recovery through public Core Prepare/Apply and managed-removal APIs; shared with the Node-only `aih-ui/execution-host` boundary.
- Explicit browser folder selection, bounded recognition of personal SKILL.md content through Catalog's public producer, and ephemeral client-scoped material grants. Saved intent records exact choices and provenance; fresh pages require explicit folder rebinding.
- `src/` owns the live screens, design tokens, and presentation. Tailwind utilities are compiled locally from the classes used in `src/`.
- `prototype/` is retained as a separate design reference. The running page does not import it.
- Local onboarding preferences (experience, organization context, requested assistance, explicit AI clients and an optional reviewing identity that defaults "Reviewing as" and is never exported). These are UI settings, not policy artifacts or enterprise authorization.
- The machine-readiness check and host-configured npm repair: Core inspection and repair results projected as failed, unknown, applied, configured or verified, with no project, saved intent or policy. See [machine readiness](docs/readiness.md).
- The report page: the readiness records as Core-normalized claims, with the configuration-check score, verified repairs, ranked actions and context series. See [report](docs/report.md).
- Guided personal setup (`src/guided.html`): a goal sentence, an optional project folder inspected only in the browser and the chosen AI clients become explained starter choices from the served Catalog, a copyable prompt and a saved unresolved-draft envelope. The rules are fixed and local (`src/app/guided-rules.js`); no folder content, model call or upload is involved. A chosen client is served by the adapter whose Catalog `clientId` names it, and the choice states that adapter's target, Core support and installed state separately.

## What it must never contain

- Policy rules, validation, digests or compile logic. Those belong to `@aihq/core`.
- Catalog content, categories, templates or findings. Those belong to `@aihq/catalog`.
- Scanner execution. That belongs to `@aihq/scan`.
- Imports from another repository's source tree, or from a package's private `dist` files. Public package interfaces only.

## Done means

An outside developer can build this UI from public package interfaces. The policy artifacts it saves are consumed by `@aihq/core` without the UI; local onboarding settings are owned only by this UI. Updating only `@aihq/catalog` brings compatible new content without changing core.

## Testing against unpublished packages

The ordinary prototype-derived application at `/` integrates mixed-source v3
authoring into its existing catalog cards, inspector and Policy workspace.
Start it with `node tools/preview.mjs --port 4173` and the three reviewed archive
environment variables. `/authoring` remains a separate contract exploration
page. Both and the headless `aih-ui/authoring` entry share
[the authoring contract](docs/authoring.md), including
the shipped saved-intent v3/review-v1 schemas, portable source intake, exact
snapshot reopen, migrations and explicit reconciliation. Start it with the same
reviewed archives and `tools/preview.mjs`; execution remains host-owned.

The application offers project proposals, configuration, dependency review,
acceptance, exact policy downloads, fresh reopen and explicit personal-folder
rebinding. Target support is producer-declared capability data, independent of
policy choices and native execution. Portable declaration intake, evidence
inspection, human review decisions and source reconciliation are available in
the same Policy workspace. Imported original bytes remain downloadable.
Organization role preferences do not establish organization authority. The
workspace's connection summary explains the scan queue, audit, compliance,
Git publishing and operator-host inputs that are still needed.

Optional host configuration uses the existing `AIH_CONSUMER_PROJECT`,
`AIH_CONSUMER_CONTROLS`, `AIH_ORGANIZATION_SOURCE` and `AIH_REVIEW_TRUST`
environment inputs. Without a configured host, Prepare/Apply and managed removal
remain unavailable with an explanation. `AIH_UPDATE_SOURCE_CATALOG_ROOTS` configures the update source: an ordered list of at most 8 absolute paths of locally packed Catalog package roots, oldest first, separated by the platform path delimiter (`;` on Windows, `:` elsewhere). Each root is read only through the public `readInstalledRelease`, one export at a time: its `release.json` and the four family release exports, and nothing else under it; nothing is written and no scan runs. A root must carry all five release exports to be read, and counts as read only when all five are valid releases of the installed `@aihq/catalog` package; otherwise it is reported offline as unreadable, invalid or a different package, naming the first export that failed, with the time it was last read kept for the lifetime of the server. While some roots are offline, the updates the readable ones offer are still listed, but content is reported unknown ("some update sources could not be read"), never checked, and the page keeps earlier updates and their check time; the improvements check says the same. The page shows each source by position, never by path. Later entries are newer, which is this host's own declaration and not a Catalog or producer fact (local packs can share one package version), so the page words it as the order declared by this host's update source. A launcher passes the same list as `startConsumer({ updateSourceCatalogRoots })`; the owner-testing candidate sets it from its manifest's `updateSourceCatalogs`. More than 8 entries, an empty entry or a relative path fails at startup, and so does setting it together with `AIH_MAINTENANCE_SOURCE`. `AIH_MAINTENANCE_SOURCE` is a test fixture only: the path of a small JSON file naming note-fixture revisions to publish as newer revisions of the review note, shown as "Test fixture source — not a real update source". With neither set, the host has no update source and content updates are unknown, not checked. `AIH_UI_SETTINGS_PATH` selects an
isolated local setup store for tests; HTTP inputs cannot choose that path.

The machine-readiness host tests run Core only against a disposable fixture home and PATH, never the owner's clients or configuration; see [machine readiness](docs/readiness.md) for the mapping, routes and host inputs.

Pack each local package with `npm pack`, install the tarballs into a throwaway consumer project, and run the scenario there. Do not use `npm link`: it hides packaging errors such as a wrong `exports` map or a missing file.

For the saved-intent local proof, set `CORE_TGZ`, `CATALOG_TGZ` and `SCAN_TGZ`
to reviewed archives, then run `node tools/saved-intent-proof.mjs <output-directory> --serve`
with Node 24.15–24.x. It installs into an isolated consumer, runs the focused tests,
writes policies and measurements beneath that output directory, and serves
`http://127.0.0.1:4821/intent` (override with `AIH_CONSUMER_PORT`). The ordinary `/`
page still uses installed Catalog content and the public execution host when configured.

`/intent` uses explicitly illustrative test data and offers authoring only. It
demonstrates save/reopen, template ownership, shared dependency removal, optional
skips and explicit changed/missing-pin reconciliation. Update candidates retain the
original JSON and need acceptance. Evidence and execution lifecycle annotations
remain readable, but edits refuse to strip them; they require separate resolution.
The fixture runner measures six inventories of 300 items and adds a seventh as
data. Inventory size and selected policy size are separate: selecting all 1,800
illustrative items exceeds the current bounded policy format and is refused.

For the separate 1,800-inventory / 300-selected **functional** proof with actual
material bytes, installed public validators and an actual browser download/fresh
import, use [functional composition capacity](docs/functional-scale.md). Its
synthetic recipes remain execution-disabled; it sets no latency target or item cap.

## Owner-testing candidate

`tools/candidate.mjs` runs one integrated Workbench candidate from exact packed
artifacts, with every piece of state in one disposable data directory and
sample data for each journey. It reuses `tools/preview.mjs` and
`tools/packages.mjs`; the page, the server and the host inputs are the ordinary
ones described above.

### The candidate manifest

A JSON file names the exact Core, Catalog and Scan tarballs, their SHA-256
digests and the source commit each was packed from. Relative paths resolve
against the manifest's own folder. `previousCatalog` is optional: a second
Catalog artifact used as `AIH_CONSUMER_PREVIOUS_CATALOG`.

Each `sha256` is 64 lowercase hex characters and each `commit` 7 to 40. For
example, with the three tarballs beside the manifest:

```json
{
  "schema": "urn:aih-ui:candidate-manifest:1.0.0",
  "candidate": "Core dev.37, Catalog 0.1.0 main, Scan 0.5.0",
  "packages": {
    "core": {
      "tarball": "aihq-core-1.0.0-dev.37-main-faa19b5-sha256-97213491a10ed4805a5fcaf912f22b366c900fba8f624ef041f0c93946a0b9d6.tgz",
      "sha256": "97213491a10ed4805a5fcaf912f22b366c900fba8f624ef041f0c93946a0b9d6",
      "commit": "faa19b5"
    },
    "catalog": {
      "tarball": "aihq-catalog-0.1.0-main-cc4d1fb0-sha256-544964be902f673f19932820b7d2bfe8e239860d236142542b6985577d29c32b.tgz",
      "sha256": "544964be902f673f19932820b7d2bfe8e239860d236142542b6985577d29c32b",
      "commit": "cc4d1fb0be4dd25662f9bbea49a5b64003f80a84"
    },
    "scan": {
      "tarball": "aihq-scan-0.5.0-main-9bbed5ae-sha256-a15f445acf940b7556d59c5d8ff61fae531085cac1bf3e062287f2175591f707.tgz",
      "sha256": "a15f445acf940b7556d59c5d8ff61fae531085cac1bf3e062287f2175591f707",
      "commit": "9bbed5ae"
    }
  }
}
```

`updateSourceCatalogs` is also optional: a list of 1 to 8 entries, each exactly
`tarball`, `sha256` and `commit`, naming locally packed Catalogs the Workbench
reads as its update source (`AIH_UPDATE_SOURCE_CATALOG_ROOTS`, described above).
The list is in the order declared by this host's update source, oldest first;
the Workbench words it that way, because the order is the manifest author's
declaration and not a Catalog fact. To place the installed Catalog in that
order, list the same tarball as `packages.catalog` again at its position. For
an older pack and then the installed main pack:

```json
"updateSourceCatalogs": [
  { "tarball": "aihq-catalog-0.1.0-older.tgz", "sha256": "<older pack sha256>", "commit": "<older pack commit>" },
  { "tarball": "aihq-catalog-0.1.0-main.tgz", "sha256": "<main pack sha256>", "commit": "<main pack commit>" }
]
```

Start unpacks each one into the run directory, lists their package roots to the
Workbench, and verifies each digest first like the three packages (a refusal
names `updateSourceCatalogs[i]`); the printed identity then lists them by
position. With an update source configured the maintenance test fixture is not
published (the two are never combined), and the candidate seeds one more sample:
`samples/saved-intents/sample-update-source-draft.json`, a saved draft selecting
a client adapter (`aihq.client.claude` when offered) from the oldest listed pack,
with `samples/update-source/SAMPLE.md`. Open it in **Policy** (Open file,
Validate and reopen) and a later pack that offers that adapter shows it as a
newer revision with both exact digests, which you can keep, skip or defer.

Start refuses a tarball whose digest differs from the manifest before it writes
anything.

### Start, stop, reset, report

PowerShell, from the repository root:

```powershell
node tools/candidate.mjs start --manifest C:\path\to\candidate.json
node tools/candidate.mjs status
node tools/candidate.mjs stop
node tools/candidate.mjs reset
node tools/candidate.mjs report
```

POSIX shells:

```sh
node tools/candidate.mjs start --manifest /path/to/candidate.json
node tools/candidate.mjs status
node tools/candidate.mjs stop
node tools/candidate.mjs reset
node tools/candidate.mjs report
```

`--port <n>` chooses the port; the default is 4300. Start refuses 4173 and any
port already in use. `--data <dir>` chooses the data directory; the default is
`.aih-ui/candidate` in this checkout (ignored by Git). Use the same `--data` for
every command.

- **start** installs the three tarballs into a throwaway consumer inside the
  data directory, creates any missing sample data, and starts the server as a
  background process with no console window. The process is recorded at once as
  **starting** (`status` shows it, `stop` ends it, `reset` refuses while it
  lives) and rewritten as **ready** when it serves. It runs with this shell's
  environment minus every `AIH_*` setting, plus the candidate home, a temporary
  directory inside the data directory (`TEMP`, `TMP`, `TMPDIR`) and the
  manifest; a sample that could not be made leaves its host input unset, so the
  page shows its own "not configured" state. Start prints the URL, the candidate
  identity (each package's version, SHA-256 and commit) and the data directory.
  It then opens the page headless and checks that the package strip and the
  provenance disclosure show the same identity as the manifest; a mismatch is
  reported and start exits non-zero, leaving the server running. `--no-smoke`
  skips that check. Its screenshots of each journey's start page are kept in
  `logs/checks/`. Start without `--manifest` restarts the candidate already
  recorded in the data directory.
- **stop** ends only the candidate's own process tree, the one start recorded.
  A serving candidate gets a stop request first. One still installing (starting,
  or reset's seeding run) cannot read a request, so it is ended at once. Either
  way it is ended by force only when its command line still names this
  candidate's server.
- **reset** deletes the data directory, after checking that it carries the
  marker start wrote and that the marker names this same folder. It refuses
  while the candidate is starting or running. It keeps the candidate
  definition: the manifest copy is re-verified first, written back, and the
  sample data is made again from it (the server entry in a seed-only mode, which
  installs the packages and can take a few minutes), so the next start serves
  fresh samples. When no valid manifest copy exists the directory is still
  emptied and the next start needs `--manifest`.
- **report** writes a failure-report bundle under `reports/` in the data
  directory: the candidate identity, Node and OS versions, the server and
  transport logs, the journey records and host configuration, and recent check
  logs, with secrets and the real home path redacted. When the candidate is
  ready, it also saves its own readiness report and reviewed batch
  (`records/live/`; anything unavailable is listed, never fatal). It refuses a
  directory the candidate did not make. Its `ISSUE.md` asks for the
  steps, the expected result and the actual result. Check the bundle before
  sharing it.

Data persists across stop and start until reset.

### What the data directory holds

| Path | Purpose |
| --- | --- |
| `home/` | The candidate's account home. Core keeps its records in `home/.aih/core`. |
| `config/` | Host configuration: settings, organization source, maintenance source, readiness repairs, batch host. |
| `samples/` | Sample projects, repositories and fixtures, each with a `SAMPLE.md`. |
| `samples/repositories/sample-web/.claude`, `sample-api/.codex` | The two controlled client configuration folders, inside the two sample checkouts. |
| `staged/` | Present only while a staged condition is on: the sample CA, the interceptor's certificate and key, and the notice for [TLS interception](#staged-tls-interception). |
| `tmp/` | Temporary files of the server process and everything it starts. |
| `state/`, `logs/`, `reports/` | The running server's record (starting or ready), logs, and failure reports. |
| `run/` | The installed consumer and served page, rebuilt by every start. |

The real account home is never used. Start and stop each compare a metadata
listing of the real home's `.aih/core` against the listing taken at start and
print any change; nothing is deleted.

### Sample data

Everything under `samples/` is sample data created by the candidate. It is
labelled as such and is not observed evidence.

- **Personal setup:** `samples/projects/sample-js-app`, a small JavaScript
  project, is the host-configured project (`AIH_CONSUMER_PROJECT`), so Prepare
  and Apply write only there. `samples/saved-intents/` holds a saved policy to
  reopen from Policy; it already declares the sample workspace (below), and
  `sample-maintenance-draft.json` is the draft for the maintenance journey.
- **Readiness and repair:** a disposable home and `PATH` with a broken `jq` and a
  test-only CA certificate (`AIH_READINESS_HOME`, `AIH_READINESS_PATH`). The
  `node-npm-ca` repair is host-configured (`AIH_READINESS_REPAIRS`). Verification
  needs the public npm registry; offline, the honest outcome is **applied**, not
  **verified**. The diagnosed `jq` failure has no Workbench repair. Core's npm
  TLS check passes on this machine before the CA repair, so the repair shows
  configuration and fresh verification rather than fixing a failed check.
- **Organization authoring and consumption:** `samples/authority` is a local Git
  repository holding `policy/organization.json`. Core's organization reader
  reads GitHub only, so the candidate answers its GitHub requests for
  `sample-org/sample-authority` from that local repository's real Git objects
  through a loopback transport. No request reaches GitHub, and each answered
  request is logged to `logs/authority-transport.log`. To publish an authored
  baseline, commit the exported file into that repository, then refresh the
  authority source in Policy.
- **Continuity:** `samples/repositories/sample-web` and `sample-api` are two
  local checkouts, each with one commit and a clean tree, to bind to the
  workspace the saved intent declares (members by remote identity, nothing
  bound). The task is to add the second client (Codex) to sample-api while
  sample-web keeps its Claude Code setup, as one reviewed batch
  (`samples/continuity`, `/batch.html`) whose two client scopes are those
  checkouts. An apply writes inside the two checkouts and the batch's Core home,
  plus one counter file, `samples/repositories/proc-runs`. Three existing
  switches provoke partial failure: the unowned file
  `sample-api/.codex/b-core.md`, present at first;
  `"faults": { "b-core": "stale-target" }` in `config/batch-host.json`; and the
  absent `sample-api/proc-ok` marker, which makes the process action fail.
- **Maintenance and improvement** (`samples/maintenance/SAMPLE.md`):
  `config/maintenance-source.json` starts with
  `{ "revisions": ["current"] }`. Add `updated`, `newer`, `additional` or
  `expanded` to publish newer sample revisions, then check for changes.
  Reopen `samples/saved-intents/sample-maintenance-draft.json` in Policy (it
  selects the review note the source publishes revisions of) to keep, skip or
  defer an update and to get suggestions; trials also need AI clients chosen in
  setup.

### Staged TLS interception

An optional condition you switch on yourself, so the readiness journey has a
real failure to repair instead of a repair that only shows configuration. It
stands in for a corporate inspection proxy: an interceptor on loopback, using a
generated sample CA, sits between the candidate's own services and
`registry.npmjs.org`. It decrypts the connection with a certificate that CA
signed, then connects to the real registry and relays the traffic.

PowerShell, from the repository root:

```powershell
node tools/candidate.mjs tls-interception on
node tools/candidate.mjs tls-interception status
node tools/candidate.mjs tls-interception rotate
node tools/candidate.mjs tls-interception off
```

POSIX shells:

```sh
node tools/candidate.mjs tls-interception on
node tools/candidate.mjs tls-interception status
node tools/candidate.mjs tls-interception rotate
node tools/candidate.mjs tls-interception off
```

Use the same `--data <dir>` as for the other commands. `on` and `off` refuse
while the candidate is starting, running or making its sample data, and they
take effect at the next start. Both reset the readiness sample, so the next
start makes a fresh fixture home and an earlier repair cannot hide the staged
failure. `status` says whether it is staged and prints the sample CA's SHA-256.

The journey, after `tls-interception on` and a start:

1. Open readiness and check with the target **npm**. The check
   `npm/tls/node/registry.npmjs.org` **fails** with a certificate-chain reason
   (`npm/version` and `npm/tls/os/registry.npmjs.org` are unaffected). A banner
   says which staged condition is active.
2. Prepare the offered npm CA repair (two operations), then apply it. Its
   `trust/material-digest` and `trust/npm-behavior` verifications pass: npm's
   own ping goes through the interceptor and is relayed to the real registry.
3. The re-check now passes, and the readiness report counts **1 verified
   repair**.

To see the same condition come back, as when an inspection proxy rotates its
CA, run `node tools/candidate.mjs tls-interception rotate` (with the same
`--data <dir>`) while the candidate is still running. It is the one mode that
works while the candidate runs, and only while the condition is staged. It makes
a fresh sample CA in its own folder under `staged/tls-interception/`, leaves
every earlier CA file as it was (so the trust the earlier repair persisted goes
stale rather than following the new CA), rewrites the repair offer, and does
not reset the readiness sample. The running interceptor switches to the new
certificate at its next connection and logs the rotation; material that does
not verify is refused and the previous certificate kept. Check again with the
target **npm**: the persisted-configuration check fails again. An improvements
check on a draft that selects an item running `npx` (an ECC MCP server such as
`ecc.claude.mcp.context7`) then suggests the diagnosis practice from these
records (see "Recurring friction from stored Core results"). Before the
rotation, the same check reads `checked` with no suggestion. The readiness page
reads its repair offer when it starts, so it offers the new sample CA only after
the next start, and a restart begins a new readiness journal.

Confinement:

- The sample CA, interceptor certificate and key, and a notice (`STAGED.md`) are
  written to `staged/tls-interception/` in the data directory, the repair offer
  to `config/readiness-repairs-staged.json`, and the interceptor's events to
  `logs/tls-interception.log`. The CA's private key signs the CA and the
  interceptor's certificate in memory, then is dropped; it is never kept.
- Only the processes the candidate's server starts after it has installed its
  packages (the readiness check and what Core runs from it) see the condition:
  a preload that reroutes their TLS connection for `registry.npmjs.org:443` to
  the interceptor, and npm's own proxy setting (`npm_config_https_proxy`,
  `npm_config_proxy`) pointing at it. Your shell, the launcher, npm's installs
  for the candidate and every other program are unchanged.
- Nothing is written to the system or user certificate store, `~/.npmrc`, npm's
  global configuration, `PATH`, the registry setting, or any client
  configuration. `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` and
  `npm_config_cafile` are not set.
- `npm/tls/os/registry.npmjs.org` is deliberately unaffected: a failure in the
  operating system's own check could only be repaired by changing its trust
  store, which the candidate never does.
- `reset` removes the data directory and with it the condition. The report
  bundle states the active condition and includes its record and notice
  (`staged/`), never the key.

The relayed ping and the interceptor's connection to the real registry need
network access to `registry.npmjs.org`; offline, the repair cannot be verified.

### Optional native clients

The candidate needs no installed Claude Code or Codex. To point one at the
candidate's controlled client home, start it from a separate shell with only
that shell's environment changed: `CLAUDE_CONFIG_DIR` for Claude Code or
`CODEX_HOME` for Codex, set to the client home in the table above. Supply
credentials by reference only, through an API-key environment variable already
set in that shell. Do not copy or link `~/.claude` or `~/.codex` files into the
data directory; a linked credential file would let the client write through to
the real home. Reset removes anything a client wrote there.

## How the page is put together

`src/index.html` carries the markup; `src/main.js` composes three parts and
connects their callbacks. Nothing else knows about more than its own job.

```
src/
  main.js               composes the parts; holds no state, renders nothing
  app/                  the shell: rails, inspector tabs, the error banner
    shell.js            rail collapse, tab switching, the error banner
    elements.js         the shell's own element ids
    dom.js              el / text / collectIds, shared by both features
    absence.js          Not published / Not supplied / Not connected
    workbench.css       interaction-specific presentation rules
    mode.js             theme preference and toggle
    onboarding.js       first-run wizard and saved-setup loading
    setup-model.js      versioned UI settings shape and input validation
    core-targets.js     Core's published AI clients and their Harness labels, for display
    client-identity.js  a client adapter's Catalog clientId, Core support and observed presence, as three separate facts (pure)
    settings-client.js  local setup API transport
    setup-summary.js    read-only review of saved preferences
    policy-import.js    read-only local PolicyBundle structure review
    decision-import.js  read-only local Decision V2 structure review
    policy-workspace.js role-specific policy workspace presentation
    authoring-client.js page-scoped authoring state and exact byte transport
    authoring-workspace.js project proposals, files, intake and host presentation
    guided-rules.js     guided setup detection, starter rules and plain-language text (pure; no DOM)
    evidence-review.js checked evidence and portable human review decisions
  styles/               Workbench design tokens and presentation rules
    tokens.css          dark and light colour roles
    workbench.css       compact layout and component styling
    tailwind.input.css  Tailwind build input (generated output is ignored)
  catalog/              Sources & Catalogs: it presents published data only
    controller.js       the ONE owner of selection and filter state
    entry.js            pure readers over a published entry
    selectors.js        search, filters, sorting, inventory counts (pure)
    index-source.js     fetch + contract assertion of the served catalog and summary
    qualification.js    Catalog's publisher qualification, bound to the served index
    categories.js       Catalog's curated categories, bound to the served index
    view-state.js       the view kept for a browser session
    navigation.js       source navigation (the left rail)
    metrics.js          the metric tiles
    toolbar.js          the filter toolbar
    cards.js            the cards and the grid
    details.js          selected-item details and evidence display
    provenance.js       the masthead facts and the provenance strip
    elements.js         the feature's element ids, grouped per component
  governance/           one vertical slice through @aihq/core
    controller.js       the workflow state; holds no policy or digest logic
    revisions.js        which input an answer belongs to (pure; no DOM)
    transport.js        every /api/* call
    bytes.js            base64 <-> bytes, and exact-byte downloads
    vocabulary.js       the six axes, their tones, and every typed refusal
    inputs.js           subject readout, evidence import, operator fields
    operator-files.js   the operator's own authority, trust and material
    observation.js      the operator's manifest, install root and files
    reopen.js           reopening downloaded bytes in a fresh session
    prepared.js         prepare, the prepared artifacts, the downloads
    statuses.js         the six verification statuses
    verdict.js          consume, and the consumption verdict
    detector.js         detector provenance and the validation-mode button
    rows.js / elements.js
```

Each component owns its own DOM subtree and its own listeners. Data and
callbacks are passed in explicitly: no component reaches into another's DOM or
mutates another's state, and selection and filter state lives in exactly one
place. There is no event bus.

### What the page shows

It shows the whole installed
`@aihq/catalog` index: list, search, and filter by kind and source; clicking a card
shows that entry's identities and evidence statements in the inspector. It presents
and filters only — it never decides, compiles, or publishes.

Source identity is read from the `source.type` discriminator, never from whichever
field happens to be present:

- `github`: repository, commit, path. A commit is shown as a commit — never as a
  version. The rail groups these entries by repository, and shows one extra row per
  revision when a repository publishes more than one commit.
- `npm`: registry, package, version, integrity. The version is the locator; no commit
  is invented for a tarball, and the commit row stays **Not published**.
- `aih`: the release and revision the index actually carries. The revision is the
  content digest, so it is shown in full rather than as a shortened hash. Which
  `aih` entries are CURRENT is Catalog's statement, not the page's: see "One current
  collection per owner" below.

Search matches the published ids and every published identity field: entryId, subject
id, kind, source type, repository, package, registry, version, path, commit and
revision. Sorting by `SOURCE REPOSITORY / PACKAGE` uses the same per-type locator.

Absence is worded by what is actually absent:

- **Not published** — a package identity field the index does not carry (network
  egress, execution sandbox, required secrets, per-engine scanner telemetry, the
  policy determination and the Policy JSON pane).
- **Not supplied** — organization information. Organizations supply it; the catalog
  never will. The header scope is one of these.
- **Not connected** — a page action or telemetry feed with no Core contract wired yet
  (Review Changes, Check Policy, Publish, Scan Review, Policies & Publish, Audit Feed,
  Compliance Matrix, whether an AI tool is installed or connected, Egress Guard).

No entry, count or label comes from a hardcoded total: every number on the page is
counted from the installed index at run time. Absence markers are never counted as
release labels or as source identities.

## Workbench presentation

`src/index.html` and the components under `src/` are the screen. `src/styles/tokens.css`
defines the two colour modes; `src/styles/workbench.css` owns the compact layout;
`src/app/workbench.css` holds interaction-specific rules. `tailwind.config.cjs` maps
the same tokens to utilities and scans `src/` for used classes. Install the pinned
build dependencies with `npm ci`; `npm run build:css` writes the ignored
`src/styles/tailwind.css`. The preview runs that build on startup. The live page
uses no Tailwind browser script.

Theme colors are defined once at the root in `tokens.css`: canvas, panel, card,
subtle surfaces; text and metadata; separators and control borders. Kind icons,
metric bars and metadata retain their distinct accents, with mode-specific values
for light and dark backgrounds. Components use these roles through Tailwind
utilities, and shadows follow the same light/dark tokens.

The neutral palette pairs black and graphite dark surfaces with white light
surfaces. Dark cards and the header use a restrained sheen and edge highlights;
light cards stay solid white over a cool pale canvas with soft shadows. Separate
chrome, card-edge and control roles keep the layers distinct. These treatments
live in the root theme tokens, following Carbon's surface-layering approach.

Typography sizes for the body, source heading, card text, and metric counts live
in `src/styles/tokens.css` as `--type-*` tokens. Components use semantic classes
for these roles so changing the dense scale does not require editing card markup.
The Geist / Geist Mono weight scale is deliberately restrained: body text stays
at 400, labels and card titles use 500, and the main source heading, key counts
and important governance outcomes use 600. Weight 300 is limited to the larger
setup headings and source revision line. Both families load exactly 300–600;
Tailwind weight utilities and direct CSS share the `--fw-*` tokens.

The metric tiles span the full width
above the split, and the inspector is a **sibling of `<main>`** inside
`#workspace-split-row` -- so it runs the full height alongside the source header,
the source policy controls, the filters and the cards.

The inspector width is controlled by `--inspector-width` (340px), capped by the
viewport when shown as an overlay. Its Policy JSON icon retains a named keyboard
tab. Published prose stays plain text; identifiers, paths and digests use
selectable, wrapping code blocks with theme-aware surface and text roles.
The inspector starts collapsed and cannot open without a selected entry; closed
content is inert. Its header shows the name and a kind icon with a hover/focus
hint. Full source fields appear once in Upstream Provenance, and each evidence
summary appears once with its record in Security. Core-derived identities and
verification states remain separately labeled in Governance. Unavailable policy
Apply/Reset actions live with Policy JSON.
The current public presentation contract supplies extracted descriptions, not
full Markdown bodies. Policy JSON remains an unavailable placeholder until a
public compiler/template contract exists. Governance downloads keep the original
bytes supplied by Core; display formatting never re-serializes them.

### The rail lists published sources and current collections

Catalog Scopes has one row per **published source identity** -- a repository for
github, a package for npm -- and one row per **Catalog collection** for the source
types Catalog governs by collection, largest first, with the current item count.
Nothing is read out of an entry id. `@aihq/catalog` is not a row: it is the package
that transports these sources, and it is named in the package strip.

Each row shows a revision only as what it is. A github repository shows its commit
(`affaan-m/ECC 5064474`), linked to that commit. An npm package shows its version,
because an integrity value is not a commit. A collection shows its current content
release.

Selecting a row scopes the grid, the "All Items" count and the masthead to that
source; selecting it again shows every source. The selected row opens to where the
Workbench design lists categories: see "Curated categories" below. The organization's
own additions come last and read **Not supplied** until something is actually
imported.

### Curated categories

When the installed Catalog publishes its curated dataset
(`@aihq/catalog/catalog-categories.json`, read in the backend with
`readCatalogCategoriesV1` and served as `catalog-categories.json`), the page uses
it as given:

- the selected rail row lists, under **Curated by Catalog maintainers**, each
  taxonomy category its items carry with a count taken from the served records at
  run time, largest first, then **Not curated** with the count of items no rule
  assigned;
- each card's category badge shows its curated category's label, with a tooltip
  naming `basis: curated` and the maintainers' one-sentence rationale; an entry
  whose category is `null` reads **Not curated**;
- search matches the curated label.

Category rows are keyboard-accessible toggle buttons. Selecting one narrows the
chosen source; selecting it again clears the category. Choosing another source
clears it too. **Not curated** matches only explicit null category records, never
missing or unavailable data. An unavailable category row stays disabled. The
selected category is saved for this browser session and restored only while the
current source still offers it. Category selection combines with search, kind,
compatible source type and sort; a different source type clears the source and
category together. Rail category counts describe that source's inventory; the
grid and **All Items** counts describe the cards matching the active filters.

This is curation by the Catalog maintainers, never an upstream declaration, and
the page never words it as one. What an upstream publisher declares stays in the
presentation data and is shown as **Upstream category** in the inspector's
identity disclosure. A category says nothing about scanning, qualification or
policy.

Against an older Catalog without the export the rail row keeps its place and reads
**Not published** with both counts from the presentation data, and the badge shows
the upstream category where one is declared, as before. A dataset Catalog's own
reader refuses reads **Not published** with that reason.

### One current collection per owner

The index keeps every entry Catalog ships, including older content kept for
evidence and reference: Core-derived entries for Core 0.6.0, 0.6.1 and 0.6.2 in
this checkpoint, plus the default profile, whose `1.0.0` is the profile's own
version and not a Core release. Which of them is current cannot be worked out from
the entries -- not from ids, and not by taking the highest release -- and the page
does not try.

Catalog publishes it: `@aihq/catalog/catalog-collections.json`, read in the backend
with Catalog's `readCatalogCollectionsV1` and bound to the exact index bytes. It
names the source types it governs, and each collection's owner package, current
content release and exact members (entry id and subject digest). The page applies
it as given:

- an entry of a collected source type is current only if a collection names it;
- Core-derived content is ONE `@aihq/core` row holding exactly those members;
- older releases stay addressable in the index but are neither rows nor counted --
  the provenance disclosure reports how many entries are kept for reference only;
- the default profile is its own collection row, named by its collection id,
  because the package that owns it is the one transporting the index.

A collection's release is compared with an installed package only when Catalog
identified it as that package's version. When the installed `@aihq/core` differs
from the Core content Catalog indexes, the strip shows `content <release>` beside
the running version and the row carries a marker. Older content is never relabelled
as the installed release. Selected entry ids and digests are never changed or
rebound.

Without the collection view the page cannot tell current from reference-only
content, so the preview does not start: it says which Catalog it needs.

### The package strip and the AI tools control

The strip under the header is the Workbench design's compact line:
`@aihq/core <version> • @aihq/scan <version> • @aihq/catalog <version>`. Each
version is the one npm recorded installing in the throwaway consumer
(`node_modules/.package-lock.json`), cross-checked against the installed manifest
and the exact tarball -- never parsed from a filename and never taken from the
index's own package block. These are local packages that can share a released
version number, so each also shows its short checkpoint. Hashes, full commits, raw
entry counts, the collection view and index admission are behind "provenance".

The AI tools control lists the AI clients `@aihq/core` supports as targets, from its
public `nativeClientIds` (exported by `@aihq/core/harness`), read by the backend from
the installed package, with the display labels Harness publishes for those ids. The
list's order is Core's, not a ranking. The page keeps no list of its own, so
reinstalling a different Core changes the list and the version with no UI edit. It
reads `<selected> of <supported>`. Supported, selected and connected are kept apart:

- supported is Core's list;
- selected is the user's explicit choice, saved in the workspace setup file -- not a policy;
- installed or connected reads *not checked*: nothing here checks a tool.

The Workbench design's `3 of 11` was sample data and is not restored as state.

A client adapter is tied to its client by the `clientId` Catalog release format 1.4 puts on
the item, never by its item id. Three facts stay apart wherever an adapter is shown
(`src/app/client-identity.js`, mirrored byte for byte for the headless readers in
`tools/consumer/client-identity.mjs`): the adapter's **target** (`clientId`, or *not declared
by this release format* for an adapter from an earlier format, which is never guessed from
its id); whether Core **supports** that client (membership in `nativeClientIds`; an adapter
for a client Core does not list is shown as not Core-supported, and support is unknown when
Core publishes no list); and whether the client is **installed or connected**, which only an
observed check supplies and is otherwise *not checked*. A check's answer is read in the words
Core's diagnostic contract defines for a tool (`runnable`, `binary`, `broken`, `config-only`,
`absent`): each of these has its own wording (found; found but not run; found but its check
failed; only its configuration found), only an explicit `absent` reads as *the last check did not
find it*, and any unrecognised value reads as *the check could not tell*. Guided setup replaces its earlier
answers on every re-check, so a client the new check does not find is no longer detected and a
suggestion made from the old answer is withdrawn. The headless improvements check takes Core's
list from the installed `@aihq/core/harness` on the host; a list in a request is ignored.

### Recurring friction from stored Core results

Rules 1.5.0 added one rule, `friction.recurrence`, and name what the check could not know; 1.6.0 also reads the readiness journal and the Core targets a selected item's
executables run on, with new wording for the two trusts below (suggestion identity and dismissals ignore the rules version, so nothing saved is reset). No new data source is added and nothing is collected: the
host passes the Core results it already stores as `evidence` (never a request field), at most 256 of `{ id, sha256?, capturedAt, fixture?, result }` where
`id` is a stable stored-result id (a machine-local path is refused), `capturedAt` is when the host captured it and `fixture: true` marks controlled
demo or test evidence. `tools/consumer/friction.mjs` (pure; no clock, network or file) normalizes the published Core results and the Workbench's readiness
records into claims 1.1.0 and asks Core's `recurrence` 1.0.0 method (`@aihq/core/report`) whether a failure came back after a verified recovery:

| Stored result | Subject | Condition | Claim `method` | Failed | Passed | Unknown |
|---|---|---|---|---|---|---|
| `checkFileState` (file-state-result 1.0.0) | the policy selection, by its management id | `condition:file-state` | none | any of its targets `changed` or `absent` | all its targets `match` | otherwise |
| `verifyNativeClient` (native-verification-result 1.0.0) | the client in its environment, `claude@win32-native` | `condition:native-use` | none | verdict `failed` | `verified` | `unverified` |
| a readiness `machine-check` record, its own check (this host's trust) | the check target | `condition:<check id>` (the published id as is, `/` included, as in `claude/version`) | none | `failed` | `passed` | `unavailable`, `skipped` |
| a readiness `machine-check` record, its `persistedCheck`, and a readiness `repair` record's recheck (both made with the trust Core's repairs persist) | the check target | `condition:<check id>`, the same condition | `{ id: 'aih-ui/persisted-configuration', version: '1.0.0' }` | `failed` | `passed` | `unavailable`, `skipped` |

A check has two timelines because a long-running host never loads a CA a repair persists: after a verified repair its own readings keep failing, so one
timeline would call fail, persisted pass, fail a recurrence. Core's mapping makes the check `id` the condition for both, keeps one scope and check method
per subject and condition, and has the adapter request each method separately (a request that mixed them would come back `incomparable-method`). So the
persisted readings carry the claim `method` above, `friction.mjs` groups by subject, condition and method, and issues one `recurrence` request per group
with its own calculation id; each result says which trust it was made with, and the suggestion words it as the "persisted-configuration" check and
keys it apart from the host's. Only a projection that reports `configuration: 'persisted'` gives persisted readings; the
scope is the same `{ machine, [target] }` in both. A claim's source is the record's own id and its revision the record's `sha256`, so a record supplied
twice is one claim. The `maintenance-check` journey record (`{ id: 'maintenance-check', checkedAt, categories }`) is a known record that makes no claim:
it has no `subject`, no per-check `outcome` of passed or failed, and no history beyond the latest check (its `id` is the constant `maintenance-check` and
each save replaces it). `checkImprovements` reads the envelope's own note beside the host's results; on its own it never turns `history-unavailable` into
anything else.

A selection's targets fold to one outcome per capture, so a passed and a failed target never tie at one instant. Only subjects the draft ties to a selected
root or pin are asked about: a policy selection of that item, the client or check a selected client adapter names, or the Core target an executable its
Catalog item declares runs on (`tools/consumer/executable-ties.mjs`: an executable that is a Core target id ties it, `npx` ties `npm`, installed with npm and
using its registry trust, and any other name such as `uvx` or `python3` ties nothing). A result of any other schema is ignored, never an error. The same
stored result imported twice counts once; one id with other content is a Core conflict and is left out of the count.

In the Workbench the evidence is the readiness journal itself: the machine-check and repair records the host wrote for checks and repairs the person ran
(`records()` on the readiness adapter, read afresh on each improvements check; no new record, store or background check). It is held in the readiness child's
memory, at most 64 records and lost when the server or child restarts. A child that has not started holds none (`history-unavailable`, and asking does not
start it); a timeout or failure reads as unreadable. The records are not labelled fixture; `AIH_FRICTION_EVIDENCE`, when set, takes precedence and stays
fixture-labelled.

A recurrence on a tied subject suggests `mattpocock.diagnosing-bugs` (when offered and not already selected) at the narrowest scope that fits: the
selection's own scope if the item offers it, else project, else its first scope. The scope is resolved for each recurring reason and a suggestion is
one item at one scope, so a project selection and a user selection that both recur (where the item offers both) are two suggestions, each with its own
reasons. A suggestion lists at most 16 reasons (the record's limit): the recurring conditions beyond what fits, taken in key order, are not listed and
the suggestion's unknowns say how many ("N more recurring conditions are not listed"). The reason names the condition in words, the first failure,
recovery and recurrence instants from Core, the number of recurrences and of stored results, and is recorded as an ordinary `add-item` suggestion (no
record schema changes), so dismissing it works like any other. A failure that never recovered (failed, failed), a recovery without recurrence,
unknown-only history and an untied subject suggest nothing. Fixture evidence says so in the reason and the coverage: "fixture evidence, not observed
on this computer".

Coverage for `recurring-friction` is `checked` (some tied condition has a verified recovery, so Core could say whether it recurred), or `unknown` with
a reason: `history-unavailable` (the host passed no stored results, or its configured store could not be read; the coverage text says which: "this
host supplied no stored Core results" or "this host's stored Core results could not be read") or `no-recurrence-evidence` (it passed some, but none
settles a tied condition; Core never turns missing history into zero). The same unknowns are written on each suggestion's unknowns, and the check
reports `core-evidence` among what it read when stored results were passed.

Content-change coverage gains `version-order-unknown`: a configured source offers a different release of a package this policy was saved from, from
the same input, and neither the order the host's update source declares nor semantic-version precedence orders the two (unversioned, not a semantic
version, or the same version with other content, and no declared position that separates them). It is never called newer, so it suggests nothing,
other candidates still do, and the coverage names the package. A release the host's declared order does place, even one that shares its version with
the saved release, is ordered: a newer one is suggested and says so ("newer by the order declared by this host's update source"). The relation is one
function, `releaseRelation(saved, candidate, releaseOrder)`: the declared order first, then semantic-version precedence, else none; revising a saved
release and `version-order-unknown` both read it. Of the content reasons, the source's own (`no-configured-source`, `sources-unavailable`,
`sources-partly-unavailable`, `saved-release-not-supplied`) come before `version-order-unknown`.

The Governance pane's **Target** field reads that same list and keeps no copy
either: its options are Core's clients in Core's own order (not a ranking), shown
with their Harness label where one is published, so a Core listing different ones
changes the field with no UI edit. A Core that publishes no list
leaves the field disabled reading **Not connected**, and nothing can be prepared
— the page no longer falls back to a target nobody chose.

### One theme icon

The theme button holds ONE icon naming the destination: a sun on a dark page
("Switch to light mode"), a moon on a light page ("Switch to dark mode"), in the
Workbench design's size and colours. `mode.js` owns the theme state and sets the icon
and the label; the colour follows the same `html.dark` class, so nothing can
disagree with it. Repaint settling (`app/theme.js`) and the saved preference are
unchanged.

### The source header keeps its composition

The source header is the Workbench design's: the context line and the source title;
the Source Policy label with its three controls (Allow all / Allow with exceptions /
Hold back) in the same row, right-aligned; then ONE source status line, then the
filter row. At 1600x1000, fonts loaded, the selected ECC header matches the design
source's positions in dark and light.

The status line holds the Workbench design's slots, filled only from real state:

- `ENABLED` -- organization and Core state: **Not connected**;
- `recorded <commit>` -- the commit Catalog recorded. It is not this
  organization's pin, and is never labelled as one;
- the source identity Catalog published (`affaan-m/ECC`, linked);
- `scope` -- the organization's input: **Not supplied**;
- `pinned` -- an installation pin is Core state: **Not connected**.

The three policy controls stay, disabled, and none is shown as chosen. No release
label or enabled state is invented.

### Cards keep each slot's meaning

A card's slots mean what the Workbench design says they mean: the category badge,
the publisher's description, the scan status and the token estimate. Where a slot
has no published value it keeps its place, its look and its size and reads
**Not published**. Card descriptions use the dedicated 10.5px type token and a
1.5 line height, reserving three lines even for unavailable text. The inspector
retains the fuller description. This keeps
the Workbench design's card proportions.

### Publisher titles and descriptions come from Catalog

Catalog publishes the upstream publisher's own title, description and category
for the sources it covers (`@aihq/catalog/catalog-presentation.json`, read in the
backend with Catalog's `readCatalogPresentationV1`). Today that is
`affaan-m/ECC` at `5064474`. The backend serves Catalog's validated records as
`publisher-metadata.json`, and the page rebinds each one to the served index
entry by entry id and subject digest. The page carries no dataset and extracts
nothing.

- A published title names the card and the inspector. Otherwise the card keeps
  `subject.id`.
- A published description fills the card body and Publisher Overview, set as
  text, never markup. Its tooltip names the upstream field and file. The file
  path and sha256 are in the identity disclosure.
- A category the upstream file declares is shown as **Upstream category**. It is
  the card badge only when the installed Catalog publishes no curated categories
  (see "Curated categories"). No taxonomy is inferred.
- An unavailable value reads **Not published**, and its tooltip gives Catalog's
  reason: not declared upstream, not in the source file, and so on.
- Search matches published titles, descriptions and categories too.

Publisher text is not a scan result or a policy decision. Scan status, the local
preference control and the policy slots are independent. Updating only `@aihq/catalog` changes
this text with no UI or Core edit.

The card's local preference control remains unavailable. Core's public authoring
selections identify assets with `assetId`, `sourceId`, `sourceRevisionId` and
`contentDigest`; displayed Catalog entries use `entryId` and `subjectDigest`.
The installed Catalog does not publish a complete, exact mapping between these
identities, and its authoring bundle covers different sources/revisions. A
future preference store needs that published mapping, including explicit
unavailability for entries that cannot be selected. No saved preference or
policy decision is inferred from the disabled control.

Nothing is borrowed into an empty slot. The Catalog's own evidence statements are on
the inspector's Security tab, labelled as statements; the source identity is in
Upstream Provenance; exact ids and digests are behind one disclosure.

The card is titled with the item's published name, `subject.id`, as the design
source titles it. With every source shown at once, the same name can appear more
than once -- the same agent ships in several aih releases -- and the full entry id
is on the tooltip and in the inspector. Scoping the grid to one source removes the
repetition.

The skill icon is `bolt` in the skill primitive's colour, as the Workbench design
renders it; agents and MCP servers use their own primitive colours.

### The toolbar keeps the Workbench design's task

The primary toolbar is **All Items**, **Needs Review**, **Egress Out**, with the
"need review" and "send data out" summaries on the right, in their original
places. Only "All Items" can be derived, so it is the selected state and counts the
cards matching the active filters. The other two keep their purpose but are unavailable, with no count:

- no scan result or Core disposition is published per item, so no review state can
  be derived;
- no item declares egress, and an empty declaration is not a measurement of none.

The technical filters that ARE available -- kind, source type and sort -- are in the
grid header, where the Workbench design puts its sort control.
Kind counts include the current source, category and search filters before the
kind selection itself. Kinds with no matches stay visible and can be cleared.

### Four words for four kinds of absence

- **Not published** -- a field the index does not carry.
- **Not declared** -- a field the index carries as an empty list. Every item's
  capability lists are empty; that is a declaration, not a measurement, so it is
  never shown as "none".
- **Not supplied** -- the user's own input, such as the organization.
- **Not connected** -- an action with no Core contract wired yet.

### First-run setup and local persistence

Without valid saved setup, the page opens a wizard: Vibe coder or Enterprise;
Enterprise then chooses Admin or Developer. Admin records organization name,
short ID, policy repository and contact emails. Developer setup does not ask for
organization details; the developer opens the admin-supplied policy in the Policy
workspace after setup. Existing Developer settings with organization details remain
readable but those details do not select or approve a policy. Vibe does not require
enterprise details. No repository is read or verified by setup.

Optional assistance requests (code review, codebase memory, workspace help,
Headroom, Serena and context/token optimization) start selected in new setups.
Each can be deselected, and **Skip all assistance** clears the six selections.
This is a UI default for these six choices, not a package recommendation. Saved
choices, including an intentionally empty list, are restored exactly on edit.
Each explains its proposed benefit and the consequence of skipping. All are
recorded preferences only: integrations are not installed or connected, no code
is accessed, and no data is sent to those integrations. The separate client step
uses Core's public `nativeClientIds`; it never infers clients from capabilities.

Completing setup atomically writes the version-1 `aih-ui-settings` record to
`.aih-ui/settings.v1.json` under this repository, a fixed gitignored location.
The same file survives preview restarts and different disposable consumers.
The API accepts only the defined fields, validates choices and size, and does not
accept a browser-supplied filename. JSON mutations require same-origin requests.
Malformed or unknown-version files show the wizard with an explanation and are
replaced only when the user completes setup. Old browser-local organization and
client drafts are no longer used to determine or restore setup.

On reopening, valid saved settings enter the saved experience. The existing
catalog and governance remain available; a self-declared Admin/Developer role
does not enforce permissions. The header shows the saved role and a setup summary
with the full, copyable settings path returned by the server. **Update my Workbench
information** opens a draft of the saved Admin organization details (when applicable),
assistance choices and AI clients. Cancel (or Escape) discards the draft; **Save changes** validates
and atomically replaces the same local file. Experience and enterprise role are
fixed in both the edit UI and its server endpoint. To change either, delete the
settings file at the displayed path and restart the Workbench. AI client choices
can also be updated from the AI tools control.

The installed public packages do not expose an assistance-card contract for
recommendations, links or recipes: Core's `CAPABILITIES` is a CLI command inventory;
Catalog runtime descriptors distribute framework runtime material. Richer
assistance cards await an appropriate published presentation contract.

This local file is not proof of enterprise authorization or an approval shared
with developers on other machines. Those workflows require future public
interfaces; policy artifacts continue to go through Core independently.

Enterprise users can open a local PolicyBundle or Decision V2 for read-only
structure review. The preview sends at most 1 MiB of chosen UTF-8 JSON to its
same-origin local API, which uses Core's public `parsePolicyBundle` or
`parseGovernanceDecisionV2`. The original text stays visible in the dialog.
Neither parser verifies a signature, organizational authority, effective
approval or CLI file handling, and neither action saves or publishes the file.

`node --test tools/tests/settings.test.mjs` checks validation, atomic replacement,
reopening, editing, immutable experience/role, new-draft defaults and deleting
settings using isolated fixtures inside `.tmp/`.

### Keyboard and focus

The page is driven from the keyboard as readily as from the mouse, and nothing
moves the operator's focus or state without their asking:

- Activating a card with Enter or Space selects it and leaves focus on that
  card: the two cards concerned are updated in place, and the grid is not
  rebuilt. Activating the selected card again is not a new selection; it shows
  the inspector if it was collapsed and leaves the Governance workflow for that
  entry exactly as it is.
- The inspector tabs are one tab stop. Left and Right move to the neighbouring
  tab and show it, Home and End jump to the first and last; each tab names its
  pane (`aria-controls`) and each pane its tab.
- Escape belongs to whichever layer is open - the saved setup view, the AI
  tools popover - and closes that layer only. With none open it does nothing;
  in particular it never changes the inspector tab.
- Setup uses native modal dialogs: the background is inert and keyboard focus
  stays inside. The first-run wizard keeps Escape from bypassing setup; the
  read-only saved setup view can be closed normally.
- A rail link to a screen with no contract yet is marked unavailable: it is
  followed nowhere and is not a tab stop. The Sources link is this page
  (`aria-current="page"`) and is not followed either.
- Every focusable control shows a focus ring under `:focus-visible`, the metric
  tiles and the toolbar selects included.
- Text is selectable inside the inspector and the provenance panel, so a
  digest, a commit or an entry id can be copied; the shell chrome around them
  stays `select-none` as the Workbench design draws it.

### Unavailable states keep their component's size

A metric tile with nothing published is still a tile of the same size reading
**Not published**, never an invented count or percentage. The same holds for the
source-policy segment, the egress readout and the policy determination choices.

## The Governance pane: one vertical slice through Core

The inspector's **Governance** tab runs the whole contract end to end:

catalog selection -> inspect published information -> import evidence -> supply
the operator's own authority, verifier trust and attestation material -> select
an operator-supplied decision, target and effect -> prepare through
`@aihq/core` -> save the exact bytes Core returned -> reopen them, in this
session or a fresh one -> consume them independently -> display the result.

### Operator-supplied inputs

Everything the operator owns is supplied by the operator, as three separate
files, because they are three separate things and one of them is a trust
decision:

| Input | Where it goes | Why separate |
| --- | --- | --- |
| Authority bundle | `operator/authority-bundle.json` | Outside the consumption root, as the contract requires |
| Verifier trust | `operator/operator-trust.json` | `roots` and `expected` must be yours, never the evidence's |
| Attestation material | `attestation-material.json` | Canonical envelope and candidate text, plus annex bytes |

The page sends a **kind** and the bytes; the server decides the path, and what
comes back describes the bytes - name, length, sha256 - never their contents.
Nothing is generated: a file nobody supplied reads **Not supplied**, and
consumption refuses on that basis with the reason named.

The refusals that matter are all reachable from these inputs and were exercised
through them: material carrying its own `roots` is refused before verification;
scan material with no trust file is refused; a trust file declaring no roots is
refused.

### Reopening downloaded files in a fresh session

Step 6 takes the exact two files the operator downloaded and opens a session
that knows nothing about the one that produced them - no digests, no status, no
binding claim, not even which catalog entry it was. It holds only those bytes,
and consumption re-derives the whole verdict from them plus the operator
configuration supplied to that session.

That is what makes it independent rather than a replay. A pretty-printed copy of
a valid document is refused: Core's parser requires the exact canonical bytes,
and the pane reports `reopened=false` with the reason. Reopening the unaltered
bytes reproduces the original verdict exactly, from a different session.

`src/governance/` collects input and renders answers. It holds no policy, digest
or compile logic: every derivation happens in `@aihq/core` behind `/api/*`. The
workflow state is in `controller.js`; the displays it drives are independent
components, and the HTTP calls and exact-byte downloads are their own modules.

Binding route. When the saved document carries no selected-file binding claim,
the backend supplies Core's optional assessment resolver, which returns the
installed Catalog's published assessment artifact for the identity Core derived
from the saved subject; Core hashes it and proves the assessment declares the
scanned material. A saved claim keeps Core on its subject-content route. The
verdict shows the material root, the scanned files, the declared-file count and
an explicit "Not scanned:" list; coverage is never folded into the binding
status. The execution axis can now read "observed" when an operator-supplied
manifest and install root under the consumption root let Core check every
installed file against the verified scan one to one; the page never says Applied
or Installed, and an observed result still lists the declared files the scan did
not reach.

### Observation inputs: what the operator supplies, what Core checks

Step 4b is optional and is the operator's statement about their own machine.
Three inputs, because they are three separate statements:

| Input | What it is |
| --- | --- |
| Upstream artifact manifest | The `aih-upstream-artifact-manifest` v1 file, exactly as written |
| Install root | The root-relative directory the files sit under, e.g. `packs/governance-quality/aih-gov-doctor` |
| The folder itself | A directory selection; each file keeps the relative path the selection carried, without the selected folder's own name |

The page collects and sends bytes. It parses no manifest, hashes nothing for
verification, derives no path from any file's contents and decides nothing. The
server validates every path as a bounded root-relative POSIX path, bounds the
request (at most 256 files and 16 MiB), stores the bytes exactly as they
arrived beside the session, and answers with what it stored - name, length and
sha256 - never the contents. Anything malformed is refused with a reason.

A consume rebuilds its consumption root from nothing, writes the evidence at the
path the saved document names, copies the manifest to `manifest.json` and the
files to `<install root>/**` byte for byte, and hands Core
`observation: { manifestPath, installRoot }`. Everything after that is Core's:
the manifest must declare the saved decision, subject, target and effect; the
manifest's paths must be exactly the sealed paths under that root, one to one;
each file's bytes must be the sealed bytes at that exact path; and the minted
receipt must resolve to an effective observation. Identical bytes under another
filename are a path mismatch, never a match.

**Nothing installs, applies or executes.** The copy exists only so Core has
bytes to read. The verdict says `Execution: observed` with what was read and
where - sealed path, observed path, digest, length - or `Execution: refused`
with Core's own refusal code and its plain-language sentence. An observed result
still lists the declared files the scan did not reach.

**What an observation proves, and what it does not.** Core reads the copies
this session uploaded into its own temporary workspace, never the operator's
machine. So `observed` proves that the snapshot they supplied is byte for byte
the verified scan, at the same paths; it does not independently prove those
files are still in place where they came from. The step note, the observation
readout and the verdict's closing sentence all say that, because a reader who
takes `observed` for "your installation is verified" has been told something
the contract never established.

### One verdict, one set of inputs

Files are read asynchronously and requests answer in any order, so a folder
chosen first can be read, sent and answered after the folder chosen second.
Left alone, that puts a verdict on screen for inputs the session does not hold.
The pane keeps the two together:

- `src/governance/revisions.js` keeps a revision per verification input
  (`authority`, `trust`, `material`, `observation`, `evidence`, `reopen`) and
  one that moves on any of them. Every input change takes a token BEFORE a byte
  is read, capturing the input's revision and the session it was supplied
  under.
- A token that is no longer current is not sent, and an answer that arrives for
  one changes nothing: no state, no session id, no render. The input that
  replaced it has its own send, and that one answers.
- Moving to another session - a new selection, a reopen, a validation fixture -
  stales every open token, so an upload in flight can never attach to the new
  session or bring the old session id back. The one exception is the session an
  upload's own answer opens: the uploads already in flight were supplied for
  exactly that session, before it had an id.
- Any verification input changing clears the previous verdict, statuses and
  detector readout rather than leaving them beside inputs they do not answer
  for.
- Consume is offered only when nothing is in flight and every supplied input is
  stored for the revision it is on now, and a consumption's answer is discarded
  if the session or the inputs changed while it was being derived.
- A prepare or a validation fixture answers for the selection it was asked for.
  If the operator has left that selection by the time it answers, nothing of it
  is applied.
- A reopened session holds the two files it was handed and nothing to prepare
  from: the evidence, binding claim, decision and fixture of the session that
  was left go with it, so Prepare is withdrawn and cannot write over those
  files. Choosing a different card forgets the files chosen for reopening, and
  the evidence file, so the same file chosen again is a change the browser
  reports.
- A request that never reaches the preview server is an answer too: it is
  reported in the step that started it, never left as an unhandled rejection
  with nothing on screen.
- The session enforces the same ordering itself, because the page is not what
  holds the bytes: `/api/operator-file` and `/api/observation` carry the
  revision their input is on, and a store older than or equal to what that
  input last stored in that session is refused as `superseded` without touching
  a byte. A request with no usable revision is refused for the same reason.

`tools/tests/` holds the offline regressions for both halves - the tracker's
ordering rules and the session store's guard - with Node's own runner and no
dependency:

```
node --test "tools/tests/*.test.mjs"
```

### What the pane will not do

It never manufactures a decision, an approval, verifier trust or a signing key.
Those are operator inputs, and what is not supplied is reported as **Not supplied**
and refused. The one exception is the explicitly labelled **validation mode**,
which generates a fixture and its matching operator trust so the plumbing can be
exercised. Its output carries "Signed test fixture — no detector executed"
wherever it appears.

### Six statuses, six fields

`structure`, `evidence`, `binding`, `authority`, `plan` and `execution` are
rendered as six separate fields. Never one badge, and never one implying another.
`execution` is `not-attempted`, `observed` or `refused`. `observed` means Core
read the files under an explicit install root and found them one to one identical
to the verified scan. Nothing is ever installed, applied or executed, so no screen
says Applied, Installed, Executed or Published.

A saved artifact may only ever *claim* a binding — the pane shows `claimed` there.
Only independent consumption can report `bound`, and it re-derives the whole
verdict from the bytes on disk.

### Verification is about a signature, never a measurement

"Attestation verified" and detector execution are two rows, always shown together.
A signature proves who signed; it never establishes that the claimed measurements
occurred. Only the operator's own `evidenceProvenance` declaration distinguishes
them, and it is never inferred from the evidence.

Imported material that carries `roots`, `expected`, `trust`, `publicKey` or
`publicKeyPem` is refused outright: if the party supplying the evidence also
supplies the key that validates it, nothing has been verified.

### Known blocked states, rendered honestly

- 429 of the 457 entries cannot bind on the `subject-content` route. `github`
  sources refuse with `missing-repository-commit-provenance-record` and the one
  `npm` source with `missing-tarball-sha512-record`. The pane shows the named
  reason and what it would take to resolve it, never a generic failure. The
  `assessment-material` route applies only to an `aih` identity, so it does not
  change this count: a github or npm subject still refuses with the named reason.
- Without an observation the furthest a route reaches is `observation-missing` /
  `partial`. With the operator's manifest, install root and folder, a route
  reaches `observed` / `observed` — Core read the uploaded copies and found them
  identical to the verified scan; nothing was installed, applied or executed.
- Publisher qualification is Catalog's statement, never organizational
  authorization. A Catalog that ships its qualification sidecar is shown on the
  Security tab (see "Publisher qualification"); `organizationAdmission` stays
  `"not-authoritative"` and the pane surfaces it verbatim.
- Genuine detector evidence is used: the isolated-organization lane runs on
  genuine detector facts. What is still a fixture is (a) the explicitly labelled
  validation mode, which manufactures a fixture and its matching operator trust,
  and (b) the **authority** — every positive authority result is a fictional test
  organization's policy file and a disposable key, and the genuine capture's
  validation signature expires 2026-09-22T19:50:20.085Z, after which that lane
  reports an honest refusal.

These Catalog inspector slots keep their place and explain which upstream input
is missing. Governance can also inspect operator-supplied scan material after
verification, independently of the selected Catalog entry:

| Slot | Owner | What is missing |
| --- | --- | --- |
| Rail categories row | `@aihq/catalog` older than the curated dataset | a curated category taxonomy with membership. The presentation sidecar publishes a category for a handful of entries and no taxonomy; the row counts both numbers at run time and states them. A Catalog with `readCatalogCategoriesV1` fills it. |
| Inspector evidence statement text | `@aihq/catalog` older than the reader's `summary` | the evidence `summary`: that reader validates it and then drops it, so the slot reads **Not published** with that reason. A Catalog whose reader returns `summary` fills it, verbatim. |
| Security pane Qualification block | `@aihq/catalog` older than the qualification sidecar | publisher qualification. The block reads "Not published: the installed Catalog publishes no qualification sidecar." |
| Security pane per-detector rows | `@aihq/scan` | a `detectors[]` array with a per-detector run state. A record carries one detector object, so "4 of 4 scanners ran" cannot be stated. |
| Security pane finding detail | `@aihq/catalog` | a verified per-entry scan result and its annex bytes. Scan 0.5.0 now exports `readScanFindingsV1`; Governance uses it for operator-supplied, verified material, but the Catalog inspector has no per-entry verified result to read. |

The slot keeps its place, size and reason until its owner supplies the input.

## Running it

The current execution-policy consumer is `node tools/consumer-preview.mjs`.
Supply reviewed `CORE_TGZ`, `CATALOG_TGZ` and `SCAN_TGZ` artifacts. It installs
them with lifecycle scripts disabled in a temporary consumer and prints the
loopback URL and exact package hashes. Without `AIH_CONSUMER_PROJECT`, browsing,
authoring, download and reopen work while Prepare/Apply stay unavailable. An
explicit host-configured disposable target enables review and approval; the
browser cannot supply target paths or material roots. `AIH_CONSUMER_CONTROLS`
may name a host-owned controls JSON file. Use Node 24.15 through 24.x.

The page saves ordinary execution policy JSON plus namespaced
`aih.workbench` metadata describing exact source identity, explicit roots and
optional exclusions. Core alone interprets executable selections. Reopening
recomposes through the same public validators and refuses contradictory intent.
Policies without that annotation remain consumable, with editing unavailable.
The adapted public consumer examples retain their Apache-2.0 attribution in
`tools/consumer/NOTICE` and `LICENSE`. The older preview below is retained as a
separate presentation reference and is not the current contract consumer.

`tools/consumer/fixture-admin.mjs` is solely an acceptance fixture helper adapted
from the public example. Its identity calculation and admission mirror construct
test inputs for `prove-enterprise-fixture.mjs`; no page or server imports it, and
it is not a Workbench administrator capability. The proof emulates GitHub REST
responses for a fictional organization and tests admission through public Core.
Both fixture Apply attempts require project file writes and file hash checks;
no process, hook or user-scope operation is accepted by that proof.

```
node tools/preview.mjs
```

It serves `http://127.0.0.1:4173/`. Two halves: a static page, and a backend that
runs `tools/service/` inside a throwaway consumer. All Node-only package APIs and
all filesystem access live on that side; the page never sees a path it did not
supply. Where a result names an operator-side file - the authority source, the
verifier trust, the provenance declaration - it is the session-relative name the
file was stored under (`operator/authority-bundle.json`), the same string
`/api/operator-file` answered with, never the run directory's location on this
machine (`tools/tests/session-relative.test.mjs`).

For the supplied candidate tarballs on Windows, run this in PowerShell from the
repository root and open the HTTP URL it prints:

```powershell
$env:CORE_TGZ = 'D:\dev\aih-ui\packages\aihq-core-0.6.2.tgz'
$env:SCAN_TGZ = 'D:\dev\aih-ui\packages\aihq-scan-0.5.0.tgz'
$env:CATALOG_TGZ = 'D:\dev\aih-ui\packages\aihq-catalog-0.3.0.tgz'
node tools/preview.mjs
```

`aih-policy-workbench.html` is the retiring standalone snapshot. Opening it as a
local file does not install or read these tarballs. The live `src/` page is the
HTTP preview; its package strip reports the installed versions and its
provenance disclosure reports the exact tarball hashes. The Catalog inventory
line distinguishes current entries from older entries retained in the index.

```
tools/
  preview.mjs           builds the run directory and serves it
  packages.mjs          the three tarballs, from committed checkpoints only
  server/               HTTP, sessions, and the seam to the consumer
    api.mjs             routing and request handling, nothing else
    sessions.mjs        server-owned session directories and operator paths
    service-client.mjs  one request, one child process, in the consumer
    static.mjs          the static half of the server
    assets.mjs          what is copied where, discovered rather than listed
    core-targets-summary.mjs  the package summary's coreTargets, from the service answer
  service/              COPIED INTO THE CONSUMER, run from there
    core-service.mjs    the operation dispatcher (stdin -> stdout)
    catalog-access.mjs  the installed @aihq/catalog, through its export map
    core-adapter.mjs    calls to @aihq/core's public API; never a reimplementation
    scan-verifier.mjs   the Scan verifier wiring and its trust boundary
    artifacts.mjs       exact-byte artifact I/O
    catalog-collections.mjs  Catalog's current collection view, via its reader
    core-targets.mjs    Core's supported AI client ids and labels, via its public export
    catalog-publisher.mjs  Catalog's publisher titles and descriptions, via its reader
    catalog-served.mjs  the catalog document the page is served, from the reader's result
    catalog-qualification.mjs  Catalog's publisher qualification, via its reader
    catalog-categories.mjs  Catalog's curated categories, via its reader
    validation-fixture.mjs  VALIDATION ONLY: the one module that manufactures
                            anything, and it labels everything it makes
```

The run directory mirrors `src/` at its root, so `src/catalog/cards.js` is served
at `/catalog/cards.js` and the module tree the page imports is the module tree
that is served. Page and service files are DISCOVERED by walking those
directories, never listed, so a new module cannot be left out; the preview then
fetches every page asset before it prints its URL.

`tools/packages.mjs` resolves all three packages into tarballs and installs them
there with `--ignore-scripts`. Everything is reached through published export
maps — no `npm link`, no `dist/` deep import, no sibling source, no fallback.

**Installing @aihq/core@0.6.2, @aihq/scan@0.4.0 or @aihq/catalog@0.2.0 from npm
does not provide these APIs.** The published versions predate them; only the local
tarballs carry the governance-input contract.

The page also needs Catalog's collection view (`readCatalogCollectionsV1`) and
Core's public `nativeClientIds`. Until those reach the checkouts the preview reads
by default, point it at checkouts that have them:

```
CORE_REPO=<core checkout> CATALOG_REPO=<catalog checkout> node tools/preview.mjs
```

A Core without `nativeClientIds` leaves the AI tools control reading **Not
published** and the Governance pane's Target field disabled reading **Not
connected**; a Catalog without the collection view stops the preview.

A checkout another worker is mid-change is never built and never packed. Its
committed checkpoint is extracted with `git archive` into a workspace outside
every repository, built there, and packed from there; the checkout itself is only
read through git. Tarballs are cached by commit, and each run prints the commit
and sha256 of what it actually installed. `CORE_TGZ` / `SCAN_TGZ` / `CATALOG_TGZ`
supply a tarball directly, and then no checkout is read at all.

### Reading the packages through what they publish

`@aihq/catalog` publishes its own reader, and the backend uses it rather than
restating any of it: `CATALOG_CONTENT_INDEX_ROOT_URL` and
`CATALOG_CONTENT_INDEX_SUBPATH_V1` locate the index, `readCatalogContentV1`
validates the bytes and returns the entries, and `resolveCatalogContentPathV1`
joins every descriptor path and refuses one that escapes the package root. The
relationship between the subpath export and the root-relative location is
checked, not assumed; a failure is reported and no internal directory is guessed.

**The page is served the reader's output, never the raw index.** The raw
`defaults/catalog-index-v1.json` bytes do not reach the page. At start the
backend reads the index with `readCatalogContentV1` and serves, at the same
`catalog-index.json` URL, `{ format, version, digest, package,
organizationAdmission, entries }` built member by member from the reader's
result type (`tools/service/catalog-served.mjs`). A field the installed reader
does not return cannot be rendered, whatever the index file holds: against a
Catalog whose reader returns the evidence `summary` the statements show it
verbatim, and against an older one the slot reads "Not published: Catalog's
public reader does not surface the evidence summary." The provenance
disclosure's index sha256 is the reader's digest over the exact published bytes,
not a hash of the served projection. The regression
`tools/tests/catalog-served.test.mjs` feeds the builder a reader result carrying
extra members at every level and asserts none of them is served.

The same rule holds for every other Catalog view: collections, presentation,
qualification and curated categories each come from their own reader, as plain
data, and nothing on the page is read around a reader.

**Remaining gap for @aihq/catalog, backend only:** it publishes artifact paths
but not the directory that contains them, so Core's subject derivation still
takes that directory from a path, in `entryContentDir`
(`tools/service/catalog-access.mjs`). It works from a path
`resolveCatalogContentPathV1` has already validated, never reaches the page, and
is the single place to change when Catalog publishes an accessor for it.

### Publisher qualification

When the installed Catalog exports `readCatalogQualificationV1` and
`@aihq/catalog/catalog-qualification.json`, the backend reads the sidecar at
start with `verifyReceipts` and `verifySignature` - the reader re-verifies the
shipped signed head (`@aihq/catalog/signed-catalog.json`) against the shipped
public signer root and hashes every receipt - at the preview's own clock, and
serves the reader's words as `catalog-qualification.json`. The Security tab's
**Qualification** block shows, for the selected entry:

- the reader's state word, verbatim (`qualified`, `expired`, `not-yet-valid`,
  `receipt-absent`, `receipt-digest-mismatch`, `receipt-malformed`,
  `basis-mismatch`, `member-mismatch`, `subject-mismatch`, `not-evaluated`), with
  the instant it was evaluated at;
- the receipt window, `notBefore` and `expiresAt`;
- `signature`, the signed head's state;
- `attestation`: today `absent`, with "absent: receipts are not attested until
  the owner's signed-catalog dispatch" and the sidecar's own `requiredOperation`
  verbatim.

Every state carries the same footer: **Publisher qualification is not
organizational authorization.** `qualified` is never coloured or worded as
approval. An entry the sidecar does not cover reads **Not published** with that
reason; against an older Catalog without the export the block reads "Not
published: the installed Catalog publishes no qualification sidecar."

`@aihq/scan` publishes `readScanResultRecordV1`,
`readScanResultSubjectBindingV1` and `readScanFindingsV1`. They accept only a value
`verifyScanAttestationV2` produced, so a cloned or hand-written object is
refused. They provide **presentation facts, not proof of execution**:

- the result record carries occurrence fingerprints and multiplicities. The
  typed findings reader can additionally return detector, rule, SARIF level,
  message, location and supporting annex from digest-verified annex bytes.
  Each unavailable field and gap remains explicit; nothing is inferred from
  the attestation alone.
- `run.state` and `signer.class` are values the attestation declares. The pane
  labels them "(declared)". An ephemeral test key reports
  `signer.class: "organization"` too.
- `readScanResultSubjectBindingV1` returns the digest of the **source tree that
  was scanned**. It does not establish that the selected catalog item was in
  that scan. Core's source-seal check, selected-file binding, configured-trust
  check and evidence reprojection remain the only things that do, and they are
  unchanged.

This preview consumes the supplied Core 0.6.2, Catalog 0.3.0 and Scan 0.5.0
tarballs through their public export maps while their releases are pending.

### Six results, six owners

The Governance pane never merges answers that belong to different owners:

| Result | Owner | Where it comes from |
| --- | --- | --- |
| Catalog artifact integrity | Catalog | `readCatalogContentV1` with `verifyArtifacts`, via `/api/catalog-integrity` |
| Published evidence | Catalog | the index's qualification records — **declared, and not byte-checked by that reader** |
| Publisher qualification | Catalog | `readCatalogQualificationV1`, on the Security tab — **not organizational authorization** |
| Scanner attestation | Scan, under operator trust | `verifyScanAttestationV2` inside Core's consumption |
| Scanner result facts | Scan | `readScanResultRecordV1`, read after verification |
| Binding | Core | the six status axes |
| Authority | Core | the six status axes |

"artifacts: verified" covers the four declared artifacts of an entry — closure,
profile, prose and recipe. It does not cover the qualification evidence files,
which are separate paths in the same index, so the pane shows the record count
beside `Bytes checked here: 0` rather than letting one read as the other.

The page's own calls are `/api/subject`, `/api/catalog-integrity`,
`/api/evidence`, `/api/operator-file`, `/api/observation`,
`/api/validation-fixture`, `/api/prepare`, `/api/reopen`, `/api/consume` and
`/api/saved`. The page never
names a filesystem path in any of them: it holds an opaque session id, and every
location is derived from that id inside the run directory.

Malformed requests are the client's problem, not the server's: a request URL or percent
escape that does not parse is answered with `400` and the preview keeps serving. The
classification lives in `tools/preview-request.mjs`.

`tools/tests/` holds the offline regressions described under "One verdict, one
set of inputs", run with `node --test "tools/tests/*.test.mjs"`.

After `npm ci`, `tools/check-page-contract.mjs` builds CSS and runs three offline
regressions with no server — that every element id the page modules collect exists in `index.html`
exactly once, that the module graph resolves and every asset the page references
is one the preview copies, and that request paths classify as above. The required
id set is derived by reading EVERY module under `src/` rather than restated, so
splitting a module cannot move an id out of the check's view:

```
node tools/check-page-contract.mjs
```

`tools/acceptance-sweep.mjs` runs against a RUNNING preview, with no browser. It
makes the same `/api/*` calls the Governance pane makes, in the same order, and
checks what the page would be shown: that no answer names a filesystem location;
that a fixture, a prepare and a consume for one entry share one session and the
verdict names its operator files by their session-relative names; that the two
saved files reopen into a fresh session, consume, and read back byte for byte;
and that an unknown session and an unparseable body are each refused with a JSON
reason rather than a crash. One line per check, non-zero exit on any failure:

```
node tools/acceptance-sweep.mjs http://127.0.0.1:4173/
```

Where the Workbench design showed a field the index does not publish, the page keeps the
layout, shows **Not published**, **Not supplied** or **Not connected** as above, and
disables the control. The current list:
organization scope; Vibe/Enterprise and the AI tools counter; Review Changes count,
Check Policy and Publish; the Commands, Hook Events and Token Budget ledger kinds;
allowed/active numerators and percentages; the source-policy posture segment;
search-result egress classification; per-engine scanner telemetry and detector
identities; network egress, execution sandbox and required secrets; the policy
determination choices; Reset Item and Apply; and the Policy JSON pane with its Copy
and Download.

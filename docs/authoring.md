# Mixed-source authoring contract

The application-tier entry is `aih-ui/authoring` (this private application is
not an npm authoring library or SDK). It uses public Core and Catalog interfaces and is
shared with the ordinary prototype-derived application at `/` and the separate
`/authoring` contract exploration page. Install reviewed Core/Catalog/Scan
archives through `tools/preview.mjs` and open its printed local URL for the
application. `tools/consumer-preview.mjs` serves the exploration page.
No source checkout imports or `npm link` are needed.

### Existing application workflow

The ordinary application retains its shell, onboarding, catalog, inspector and
role-specific Policy workspace. Choose a content family in the rail or family
selector, browse producer capability facts for a target, then choose an item
from its card or the inspector's **Add to project policy** action. Review the
proposal in Policy workspace and accept it before saving. Configuration changes
and removal use the same proposal boundary. **Check Policy** validates current
bytes and exact available sources; it establishes no organization approval.

**Choose personal folder** supplies only explicitly selected bytes to the
existing bounded intake contract. Invalid formats and changed saved roots show
actionable diagnostics. Fresh pages must open the saved policy, select its
personal input binding and reselect the exact folder, then validate and reopen.
A saved artifact grants no filesystem access. Target/family filters never change
policy bytes, roots or executable selections.

Portable declaration snapshots, source reconciliation and optional evidence
review are part of the same workspace. Human review decisions retain checked
subject/finding bindings and history; they do not authenticate the reviewer or
producer. Operator-host configuration independently controls authority,
Prepare/Apply and managed-removal availability. The connection summary keeps
scan queue, audit, compliance, Git publication and native execution gaps visible.

Ordinary `/authoring` loads the installed default release plus the public
`release-extensions.json`, `release-ecc.json`, `release-superpowers.json` and
`release-anthropic.json` exports. All items are browsable, with family counts,
family filtering and search; fresh drafts have no selected content. Matt's
skills appear under Extensions. Grouping changes no item, source, dependency or
saved identity: each item's disclosure shows its exact release/item digests,
original upstream origins and declared dependencies. The independent note and
its authored demonstration template remain separately labeled.

### Browse target support

The browse target lists clients declared in installed items' checked
`metadata.discovery.clientCapabilities`. It starts with `claude-code` when
declared, otherwise the first declared client. **With supported facts** is the
default: an item appears when it has at least one declared supported capability
for that client. Each card still shows its unsupported and unknown capabilities,
their surfaces and producer reasons. Supported material format does not establish
native loading, execution, tool interception or automatic guardrails.

Visible counts describe items with supported, unsupported and unknown facts in
the current family/search scope, before the support filter. Mixed-capability items
can count in more than one group. **Full inventory**, **With unsupported facts**
and **With unknown facts** expose the remaining content. No facts for the client
means unknown, not unsupported. An inventory with no declared clients remains
discoverable through Full inventory or With unknown facts.
Catalog's checked release permits arbitrary descriptive metadata. Malformed
capability lists or records remain unknown; usable records still display their
individual facts. Unusable records cannot qualify an item as supported or hide
its unknown status, including when mixed with a usable supported declaration.

All family options retain their installed counts even when the current target
has no supported items in that family. Exact identity disclosures retain the
published recipe targets and all declared client capability facts. Empty recipe
targets do not establish support. Browse target, family, search and support
filters change presentation only: they preserve selected roots, dependency pins,
saved bytes and headless intent. The host independently owns execution targets
and Core checks actual applicability during preparation.

### Focused regression command

With Node 24.15–24.x and reviewed local archives, run:

```sh
npm ci --ignore-scripts
node node_modules/playwright/cli.js install chromium
CORE_TGZ=/path/to/core.tgz CATALOG_TGZ=/path/to/catalog.tgz SCAN_TGZ=/path/to/scan.tgz npm run check:workbench
```

PowerShell users can set the same three environment variables with `$env:NAME`.
An optional output directory follows `--`; otherwise a fresh temporary consumer
is retained. The command installs only those archives with scripts disabled,
records their SHA-256 identities in `reviewed-packages.json`, and writes
`checks.log` and `browser-check.log`. The pinned Playwright Chromium journey writes
its exploration-page evidence beneath `personal-folder-evidence/` and the normal
application's downloaded policy, screenshots and `browser-evidence.json` beneath
`prototype-evidence/`. The normal journey exercises the same `createWorkbench()`
startup as `tools/preview.mjs`, including `/`, all four required families,
rail/dropdown synchronization, five-source proposals, actual download,
missing/changed personal-root refusals, exact explicit rebinding and public
headless agreement. Removing a required export in the isolated installation
proves normal startup refuses incomplete families. Presentation tests also check
stale catalog responses and draft/reopen invalidation. Selection/save/fresh reopen
checks preserve
exact identities, required dependencies and original Matt provenance, with
headless reader agreement. Ordinary installed-page interaction additionally
checks supported-first browsing, mixed capability statuses and reasons, unknown
declarations, scoped counts, target changes, and exact choice preservation.
Existing mixed-source authoring
regressions run alongside it. This focused check complements the full consumer
test suite; it does not replay native acceptance.

The actual headless Chromium check uses ordinary `/authoring`, chooses a disposable
real directory through its directory file input, refuses unrecognized content,
selects a personal skill alongside one representative from every maintained family,
downloads the policy, and imports it in a fresh browser context against the same
server. Fresh reopen cannot recover the local root until explicit folder reselection;
changed support bytes refuse rebinding and the original exact bytes restore it.
The same bytes resolve through the headless public validators. A supplied marker
script remains unexecuted. HTTP regressions additionally check client-specific
preparation/approval handles, bounded malformed input and stale approval invalidation.

The Workbench families CI job builds pinned public Core, Catalog and Scan
checkpoints in separate directories, packs them and runs this same command.
The UI never imports those source directories. Updating these independent
checkpoints is explicit; no registry publication, native acceptance replay or
broader candidate acceptance is implied by this focused check.

```js
import { freshAuthoring, readAuthoring, composeAuthoring,
  reconcileAuthoring, editAuthoring } from 'aih-ui/authoring';
import { intakeDeclaration } from 'aih-ui/intake';
```

Portable authoring operations are deterministic and effect-free. Byte arguments are
`Uint8Array`; JSON transport uses arrays of bytes. Inventories are
`{release, materialSource, input?, materials?, templates?}`: `release` must be
an actual public Catalog checked reader value, never a JSON clone. `materials`
contains exact `{path,bytes,sha256,byteLength}` outputs from the producer or host.
Templates are consumer-supplied `{id,sha256,roots}` snapshots; a template root has
the same root fields except `originIds`. The host owns acquisition and bindings.

## Save and reopen

The execution policy contains `metadata["aih.workbench"]` with exact schema
`urn:aihq:workbench:saved-intent:3.0.0`. See the shipped
[saved-intent schema](../schemas/saved-intent-3.0.0.json) and
[review schema](../schemas/review-decisions-1.0.0.json).
Document schema versions are independent of package versions.

| Field | Representation and meaning |
| --- | --- |
| origins | Unique direct `{id,kind:"direct"}`, template `{id,kind:"template",releaseSha256,templateId,templateSha256}`, or organization `{id,kind:"organization",organizationPolicySha256,organizationSelectionId}` records. Organization provenance grants no current authority. |
| roots | `{releaseSha256,itemId,itemSha256,scope,configuration,originIds,reason?}`. Scope is project/user, configuration is a JSON object. Nonempty unique originIds reference existing origins. Configuration must agree for shared exact item/scope. |
| exclusions | `{originId,releaseSha256,itemId,scope,reason?}`. A deliberate optional/template exclusion cannot suppress a required edge. To trim a template root, remove that root explicitly. |
| pins | One `{releaseSha256,itemId,itemSha256,recipe,materials}` per resolved exact item. Recipe/material descriptors retain Catalog paths, SHA-256 and byteLength. |
| provenance | `{releaseSha256,package?,sources,materialSource}` copied from checked releases and their supplied Core material sources. |
| inputs | Unique `{id,kind,locator,resolvedIdentity,releaseSha256}` acquisition records below. |
| reviews | Required review-v1 `{schema,records,history}`. Empty arrays are valid. |

Digests are lowercase SHA-256 hex. IDs are bounded nonempty identifiers. Pins,
inputs and provenance are deterministic. Shared dependencies have one selection
and multiple inclusion paths; optional suggestions are never silently selected.
Catalog's resolver and validator own dependencies and configuration.

`freshAuthoring()` creates an empty v3 document. Add a root using identities from
the checked inventory, then call:

```js
const result = await composeAuthoring({ intent, inventories });
if (result.status === 'ok') save(result.value.policyBytes);
const reopened = await readAuthoring({ policyBytes: downloadedBytes, inventories });
```

`composeAuthoring({basePolicyBytes?,intent,inventories})` returns
`{status:"ok",value:{policyBytes,intent,...},diagnostics:[]}` or
`{status:"refused",diagnostics,...}` with no executable partial policy.
With a base it preserves unrelated policy fields, metadata, known evidence,
managed selections and removals, then validates the resulting policy through Core.
Selection IDs and management IDs are retained for unchanged exact recipes/scopes.
Output is a draft, never an authorization handle.

`readAuthoring({policyBytes,inventories})` returns an independently Core-validated
`policy`, `intent`, `editing:"available"|"unavailable"`, `diagnostics` and exact
`originalBytes` inside `value`. An unsupported annotation, unavailable snapshot,
unsafe field or contradictory projection does not invalidate a valid execution
policy. Unsupported policies themselves receive tagged Core diagnostics.
Original bytes survive migration and refusals, including CRLF; importing a file
does not make the textarea's normalized projection the original artifact.
V1 explicit roots migrate only with an available exact release and unambiguous
scope; v2 retains recorded origins and pins. Missing template/acquisition
identities are unresolved. No origin or approval is guessed. A new v3 artifact
is emitted only by explicit successful composition, with originals retained.

## Bring your own declaration

`intakeDeclaration({input,declarationBytes,sourceFiles,materialSource,archiveBytes?})`
checks exact declaration bytes, source identities and required files, invokes
Catalog's public producer compiler, and returns a checked inventory. Supported
declarations use `urn:aihq:catalog:producer-declaration:3.0.0`, or 3.1.0 for
explicit local origins, with explicit
discovery and relationships. Unsupported raw formats are refused, not inferred
from prose. The host supplies `sourceFiles:[{source,revision,files}]` where
files map relative source paths to bytes. Git/organization revisions must match
the acquired identity. npm intake additionally verifies SRI against supplied
archive bytes. Hosts must acquire/extract those bytes and supply truthful source
files; this portable operation performs no network, extraction or execution.

| kind | locator | resolvedIdentity |
| --- | --- | --- |
| local | `{input}` | `{sha256}` |
| git | `{repository,ref?}` | `{revision,sha256}` |
| npm | `{name,range?}` | `{version,integrity,sha256}` |
| organization | `{authorityId,sourceId}` | `{revision,sha256}` |

`sha256` binds the declaration snapshot; `releaseSha256` binds its normalized
checked inventory. Mutable refs and ranges are discovery hints for explicit
refresh. Reopen never substitutes latest. Local input is a portable host binding
name, never an absolute path or credential. MaterialSource is independently
host supplied and validated by Catalog/Core. Organization content is ordinary
declared content, not an authority service. BYO requires no Catalog publication.
The browser accepts a JSON snapshot envelope with the same fields and byte
arrays; the host keeps its checked handles, never trusts serialized handles.

### Choose a personal folder

Ordinary `/authoring` also accepts a directory through **Choose and validate
folder**. The browser grants access to selected file bytes; the server receives
canonical relative paths, never an absolute root or a permission imported from
JSON. Selection does not execute any supplied code, initialize Git, contact a
remote or publish content. **Advanced: bring a declaration** remains available.

The recognized layout is `skills/<name>/SKILL.md`. Catalog's public
`extractSourceFacts` interprets the `agent-skills` profile, including multiline
YAML scalars and supported extensions, exactly as for Catalog compilation.
Profile errors and malformed input return Catalog-attributed source diagnostics;
no body text substitutes for missing required purpose. Directory names must
match each skill's declared name. All skills share one license identifier
and a nonempty UTF-8 root `LICENSE`, `LICENSE.txt` or `LICENSE.md`. When the optional
native license identifier is absent, the delivery declaration uses
`LicenseRef-Personal` for those root terms; it is not an authored source field. License text is
retained exactly; recognition does not independently verify the license claim.
Each skill's directory files form its support closure. These are delivery bytes,
including scripts; recognition does not establish native use or execution admission.
No dependency is inferred from prose. Required dependencies beyond this subset
need an explicit advanced declaration.

Limits are 32 skills, 256 selected files, 250,000 bytes per file and 1,000,000 bytes
total. Paths must be relative and canonical, with no traversal, case aliases,
Windows reserved names or Git metadata. Snapshot revision is SHA-256 over UTF-8
`JSON.stringify` of sorted `[relativePath, sha256(fileBytes), byteLength]` tuples,
without a trailing newline; every selected file contributes. The portable input
name is `personal-` plus the first 24 revision hex characters. Catalog's public
3.1 producer emits checked release 1.3 local provenance and exact material pins;
no remote repository is invented. The generated configuration mirrors Catalog's
public skill recipe input. Catalog, then Core, own configuration and policy validity.

The live page uses a fresh random client token, held only in memory and sent as
`x-aih-client`. Dynamic personal and advanced inventories are scoped to that
client. Personal intake creates an opaque host grant; only validated compiled
materials are staged for that client's execution host when a target is configured.
Neither client tokens nor grants enter saved intent. Prepared snapshots remain
authoring inputs and acquire no material root. A different page, reload, browser
context or restarted server requires reacquisition. Host approval handles are
client-specific; a new material binding discards prior preparations. Idle clients
expire after one hour; at most 64 clients and 16 distinct personal grants per client
are retained, and personal staging is removed on expiry or server shutdown.

Open the saved policy, choose its **Rebind saved** input under **Folder purpose**
and explicitly select the original folder. One saved personal input is displayed
by default. Both the compiled release and declaration identity must match before
the grant is bound; then **Validate and reopen** recovers exact choices. A changed
folder receives `LOCAL_ROOT_CHANGED`, acquires no inventory/grant and preserves
the policy bytes. Restore the original snapshot to rebind, or download the original
policy and explicitly start a fresh draft to select changed content. This bounded
route cannot recover unavailable historical bytes or automatically migrate them.

## Choose, trim, Keep and reconcile

`editAuthoring({policyBytes,inventories,operation})` proposes `select`, `template`,
`remove-origin`, `remove-root`, `skip`, or `unskip` using the fields shown in the
page. A removal can carry `keep:[{releaseSha256,itemId,scope}]` for previously
selected items. A kept orphan becomes a direct root with its original explicit
configuration; there is no competing Keep flag. Removing an origin preserves
other origins and shared requirements. `select` may omit `itemSha256`: it is
filled from the checked inventory and a different supplied hash is refused as
`SOURCE_IDENTITY_MISMATCH`. All candidates require explicit acceptance.

`reconcileAuthoring({savedPolicyBytes,inventories,candidateInventories})` returns
`value:{status:"unchanged"|"needs-decisions",affectedRoots,retainedRoots,choices}`
and retains `originalBytes`. It compares exact closures and offers keep-exact,
remove and available explicit update candidates. It neither mutates nor applies.
Choices enter subsequent composition; unavailable historical bytes cannot be
recovered by selecting a newer revision. Updating one source retains other exact
sources and requires explicit changes to its roots/input records.

Consumer refusal codes include INTENT_VERSION_UNSUPPORTED,
INTENT_POLICY_CONTRADICTION, SOURCE_REVISION_UNAVAILABLE,
SOURCE_IDENTITY_MISMATCH, ORIGIN_UNAVAILABLE, FIELD_SEMANTICS_UNSUPPORTED,
POLICY_BOUND_EXCEEDED and REVIEW_BINDING_UNAVAILABLE (a new decision without a complete checked binding, or
review records changed outside the review workflow).
Underlying failures retain `details:{owner:"core"|"catalog",diagnostics:[...]}`
when wrapped; public Catalog resolver diagnostics retain their shape directly.
Paths are JSON pointers; message prose is explanatory. The consumer limits
intent to 850,000 UTF-8 bytes, 4,096 entries per choice array and 32 inventories;
Core's independent policy bounds also apply. Reduce selected state after a bound
refusal; no partial artifact is produced.

## Unresolved drafts and the journey envelope

When the only problem is that an exact source, release, template snapshot or
input record is not among the supplied inventories, `readAuthoring` returns
`editing:"unresolved"` instead of `"unavailable"`. The original `intent` and
`originalBytes` are unchanged, `unresolved` lists what is missing and `roots`
marks every choice `resolved`, `unresolved` (availability) or `refused` (Catalog contradiction). Each unresolved entry is
`{kind:"root"|"dependency"|"origin"|"exclusion"|"input",ref,reason,dependents}`;
`reason` is `revision-unavailable` when a different revision of the same package
or input is supplied and `source-unavailable` otherwise. A different
revision is never substituted. Unsupported semantics, contradictions, identity mismatches
and review-binding problems stay `"unavailable"`. `editAuthoring`,
`composeAuthoring` and `reconcileAuthoring` still refuse an unresolved document
because they produce or compare executable policies.

The draft operations work on the exact recorded choices:

| Function | Result |
| --- | --- |
| `openDraft({bytes,inventories})` | `bytes` is a policy or a journey envelope. Returns `{envelopeBytes,envelope,projection,intent,editing,unresolved,roots,savedIntentBytes,compile,diagnostics,reviewJudgments,reviewSummary}`. Each root carries `status` and `dependencies`, its displayed required closure as `{releaseSha256,itemId,scope}`. `compile` is `{status:"available"}` or `{status:"refused",reasons}`; an envelope with an unsupported required record always advertises `JOURNEY_RECORD_UNSUPPORTED` as the reason. Unsupported semantics refuse with the original bytes and produce no envelope. |
| `editDraft({envelopeBytes,inventories,operation})` | New envelope revision. Operations: `remove-root`, `remove-origin` (with `keep`), `select`, `replace`, `skip`, `unskip`. Returns the `openDraft` value plus `changes`. |
| `compileDraft({envelopeBytes,inventories,roots?})` | `{policyBytes,intent,policy,scope,reviewJudgments,reviewSummary}` for a resolved, dependency-correct scope; the only executable output. |

`select` and `replace` fill `itemSha256` from the checked inventory; a different
supplied hash is `SOURCE_IDENTITY_MISMATCH`. `replace` keeps the choice's
origins, configuration, reason and every exclusion. Removing an unavailable item
that a retained choice still requires is refused as `DEPENDENCY_RETAINED` with
`details.dependents`. `skip` needs a resolvable item; a recorded skip can always
be removed. `compileDraft` refuses an unresolved scope as `SCOPE_UNRESOLVED`
with `details:{unresolved,blocked}`. A scoped compile keeps origins used by the
kept roots plus `direct`; saved review decisions are kept exactly as recorded and
their applicability is reported in `reviewJudgments`. Pins, provenance and inputs in
a draft are retained facts pruned to what the kept choices reach; identities are
added only from supplied checked inventories. A choice added in a draft is not in the
saved policy's recorded graph, so its required closure is resolved live. An
availability gap and a contradiction are kept apart:

- **Availability gap.** Required content lives in a release or item that is not
  among the supplied inventories (a dependency's inventory is no longer supplied).
  The choice is `unresolved` and names each missing dependency with
  `source-unavailable` or `revision-unavailable`. Supplying the content resolves it.
- **Contradiction.** Everything the choice needs is supplied but Catalog refuses it
  (an invalid configuration, a recorded skip of a required item, a conflicting
  set). The choice is `refused`, not `unresolved`: it carries
  `refusal:{owner:"catalog",diagnostics}` with Catalog's own diagnostics, is never
  listed in `unresolved`, and `compileDraft` of any scope containing it returns
  those diagnostics. The draft stays openable and can be fixed (for example with
  `select` and a valid configuration) or the choice removed.

`editDraft` refuses an edit that would introduce such a contradiction for content
that is fully supplied, returning Catalog's diagnostics and the original envelope
bytes with no new revision, exactly as ordinary authoring would. Availability gaps
remain editable. While any choice's closure is undetermined, every recorded pin
and its provenance and inputs are retained, because an item behind a missing one
cannot be seen; they are pruned again once the closure resolves.

`aih-ui/journey` is a pure module (bytes in, bytes out; Web Crypto digests only).
Its envelope, [schema](../schemas/journey-envelope-1.0.0.json), is versioned
separately from saved intent:

```json
{ "schema": "urn:aihq:workbench:journey-envelope:1.0.0",
  "id": "journey-<32 hex>", "executable": false,
  "revision": { "sequence": 1, "sha256": "<hex>", "previousSha256": "<hex, from 2>" },
  "savedIntent": { "type": "urn:aihq:core:execution-policy-bytes", "mediaType": "application/json",
                   "sha256": "<hex>", "byteLength": 0, "base64": "<exact original bytes>" },
  "records": [{ "id": "draft", "schema": "urn:aihq:workbench:journey-record:unresolved-draft:1.0.0",
                "required": true, "savedIntentSha256": "<hex>", "intent": {} }] }
```

The envelope is never an execution policy. `id` derives from the first
revision's saved-intent digest and stays stable; `revision.sha256` covers the
canonical envelope without itself. The saved-intent bytes are carried verbatim, so
a reopened journey yields the same meaning and the original bytes. Functions:
`readJourneyEnvelope(bytes)`, `writeJourneyEnvelope({savedIntentBytes,records,previous})`
and `projectJourneyEnvelope(envelope)`. Every record has `id`, a versioned
`schema` URN and `required`. An unknown optional record is preserved verbatim and
reported as `JOURNEY_RECORD_PRESERVED`; an unknown required record reads as
`supported:false` with `JOURNEY_RECORD_UNSUPPORTED` and every change or compile
refuses. Other codes: `JOURNEY_VERSION_UNSUPPORTED`, `JOURNEY_REVISION_MISMATCH`,
`JOURNEY_REFERENCE_MISMATCH`, `INPUT_INVALID`, `FIELD_SEMANTICS_UNSUPPORTED`.
Refusals keep the original bytes and no refused read or write rewrites them.
Bounds: 1,000,000 saved-intent bytes and 2,000,000 envelope bytes. The page accepts
an imported envelope up to the envelope bound and a policy up to 1,000,000 bytes.

Improvement suggestions check goal-relevant content changes against the configured
update source using the order declared by this host's update source when known,
falling back to strictly later semantic versions when that order is unknown.

## Evidence and review lifecycle

Review-v1 records contain id, owner `{kind:"individual"|"organization",id}`,
actor, recordedAt (UTC), disposition (false-alarm/accepted-risk), reason, subject
`{releaseSha256,itemId,itemSha256,recipeIdentity,materials}`, finding
`{detectorId,ruleId,findingId}`, evidence `{observationIdentity,detectorIdentity,
rulesIdentity,configurationIdentity,profileIdentity,scopeIdentity,coverageIdentity}`,
state (current/reconsider) and optional supersedes pointing to prior history.
Materials are sorted exact Core identities. Every evidence dimension, including
absent optional dimensions, needs an explicit checked identity.

The `/authoring` page and `aih-ui/authoring` share these effect-free operations:

```js
import {
  inspectReviewEvidence, recordReview, reconsiderReviews
} from 'aih-ui/authoring';
const target = { releaseSha256: inventory.release.sha256, itemId };
const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId });
const candidate = await recordReview({
  policyBytes, inventories, evidenceBytes, target,
  finding: inspected.value.bindings[0].finding,
  decision: {
    id: 'license-review', owner: { kind: 'individual', id: 'reviewer' },
    actor: 'reviewer', recordedAt: '2026-10-13T18:00:00Z',
    disposition: 'accepted-risk', reason: 'Reviewed for this exact local use.'
  }
});
// Save only a successful candidate after explicit review. Other current
// decisions can supply their evidence via reviewEvidence: Uint8Array[].
```

The inventory must be an actual checked Catalog value with exact recipe bytes in
`materials`. Core's `deriveRecipeIdentity` validates those bytes and describes the
material identities. Scan's public reader checks the original report/artifact
bytes and observation digests. Inspection never invokes `runScan`. Source
association means the checked capture, successful observation input and covered
paths contain the exact recipe and all item materials. This byte association
does not claim Core's live source sealing or organization admission.

`value` separates `sourceAssociation`, `reportSupport`, `producerAuthentication`,
`annexBytes`, the Core-derived `subject`, usable `bindings` and the complete
report `view`. Failed/refused detectors, incomplete coverage and gaps remain in
the view even when they cannot support a decision. Missing optional evidence
affects review availability, never independent Core policy validity. A portable
reader always reports authentication as `unchecked`, including signed artifacts.

The Node-only review host (`tools/consumer/review-host.mjs`, application-internal) supplies
`inspectAuthenticatedReviewEvidence({evidenceBytes,inventory,itemId,trust,expectedScanId?})`.
It adds the public Scan `authenticateArtifact` result as `producerAuthentication`.
Trust comes independently from the host, never the imported report/policy.
The local server may load it through host-selected `AIH_REVIEW_TRUST` JSON.
No configured trust leaves portable inspection unchecked; no authentication
result proves that the human named in a decision acted or that scanning occurred.

Bindings use checked `observationId` with the exact relevant annex descriptors
(ID, media type, digest and byte length; an empty list explicitly means absent), native rule ID (or explicit
`absent:rule:<reason>`) and raw occurrence fingerprint. Detector identity is an
exact `detector:` JSON projection of detector ID/version, adapter digest and
platform; rules and configuration use their checked `sha256:` identities.
Profile identity is an exact `profile:` projection of ID/digest. Scope identity
is `<observationId>#input`, binding the observation's exact scope, targets,
entries and platform. Coverage identity is `<observationId>#coverage:` plus the
exact sorted-key JSON projection of checked detector coverage; the observation
ID additionally binds its coverage and gaps. These projections encode public
checked values without inventing digests or custody. The `observation:` projection
binds the observation ID plus its referenced annex closure, so changed annex
bytes cannot hide behind an unchanged observation ID. Optional unavailable
location/support fields have explicit `absent:<field>:<reason>` display
identities and remain bound by the observation. Required missing/incomparable
dimensions, or projections exceeding the record's 1,000-character bound, cannot
mint a reusable decision (`REVIEW_BINDING_UNAVAILABLE`).

Supply `reviewEvidence:[originalBytes,...]` when reading, composing, editing or
reconciling documents containing current decisions. The page retains up to 32
loaded reports/artifacts, with a 750,000-byte aggregate limit to leave room for
the policy's byte-array JSON transport, and lets the user select which to inspect.
Headless readers keep the owning Scan byte bounds. Reopen checks each current
binding again. A changed report Scan ID alone does not invalidate an unchanged
relevant observation. Changed detector/rule/configuration/profile/scope/coverage,
finding or reviewed material changes a judgment's **applicability**; it never
forces another personal review and never blocks editing. Reading, composing,
editing and drafting return `reviewJudgments`, one entry per saved record, in
order: `{recordId,state,owner,actor,disposition,reason,recordedAt,subject,finding,evidence,applicability,applicabilityReason,origin}`.
`subject`, `finding` and `evidence` are the original stored values, never replaced
by current evidence. `applicability` is `applies`, `changed` (reason
`subject-not-selected`, `subject-changed` or `evidence-changed`), `unverified`
(reason `evidence-not-supplied` or `source-unavailable`) or
`reconsideration-requested` for a reconsider record. `origin` is `recipient` only
when the optional `recipient:{kind,id}` equals the record's `owner`; otherwise,
including an absent or invalid recipient, it is `imported`. `reviewSummary` is
`{recipientDecisions,importedDecisions,applies,changed,unverified}` over current
records, so an imported judgment is never counted as the recipient's decision.
Authoring and draft results carry this derivation as `reviewJudgments`;
comparison results gain `reason`, and a selected subject whose release is not
supplied is now `unavailable` (`source-unavailable`) rather than `changed`. If the
judgments cannot be described (for example malformed `comparisons`), results carry
`reviewJudgmentDiagnostics` instead; editing is unaffected. Direct edits to review records
during ordinary composition are refused. `recordReview` creates exact current
decisions only after the new decision's own checked binding, and is not blocked by
other records; its optional `decision.supersedes` moves an active prior record
into history or references retained history.

### Changes for headless callers

`REVIEW_RECONSIDER_REQUIRED` is no longer returned. A missing or changed review
binding is reported as `applicability` instead of making reads or edits
unavailable. Nothing automatically converts a record to `reconsider`, and
`reviewsReconsidered` is removed from draft results. `reviewJudgments`,
`reviewSummary` and the optional `recipient` input are new.
`REVIEW_BINDING_UNAVAILABLE` remains for new decisions whose binding cannot be
minted and for changes to decisions made outside the review workflow.

`reconsiderReviews({policyBytes,inventories,reviewEvidence?,comparisons?})` is an
explicit, optional operation for an organization that requires review during its
authoring process: it moves changed/unavailable original records unchanged into
history and adds reconsider records that supersede them. No edit, composition or
draft operation invokes it. History and the original reviewed subject remain
intact. Unrelated policy metadata, evidence, managed selections and removals
continue through ordinary Core validation.

For an explicitly selected new release with unchanged relevant item material,
supply `comparisons:[{recordId,target:{releaseSha256,itemId}}]` to the authoring
and draft operations. The
comparison returns separate `reviewedSubject` and `comparedSubject`; exact Core
recipe/material identities and checked finding/evidence must match. The saved
record is never silently retargeted. The comparison is host-owned context and
must be supplied again on reopen; it is not an extra field in review-v1.

Existing Scan-managed retained handles and independently authenticated prior
artifacts retain their owning API semantics. A serialized handle or JSON cache
copy grants no trusted custody. Human records are portable claims, not human
authenticity or execution authorization. There is no expiry or zero-findings gate.

## Current organization authority and execution host

The Node-only execution host (`tools/consumer/host.mjs`, application-internal and
not a package entry) provides `createHost`. The `/authoring`
page and headless consumers use this same host for current authority, preparation,
approval and managed recovery. Configure `projectRoot`, `materialRoots`, exact
`recipeMaterials`, optional `organizationSource`, and private `controls` independently
of imported policy/source/review JSON. The local preview also accepts a host-owned
`AIH_ORGANIZATION_SOURCE` JSON file and `AIH_CONSUMER_CONTROLS`; credentials never
enter the browser or exported policy. Supply authentication to both Prepare and
Apply through host controls. Portable organization origins remain provenance only.
The Policy workspace shows the configured source read-only (repository, path, requested
revision, resolved commit, blob and digest) or, when none is configured, the setup
instructions. Refresh reads it again and reports the revision as unchanged or changed; a
changed revision marks an already prepared review stale and disables Apply until the
effects are prepared again. No browser control sets or overrides the source.
`check:workbench` demonstrates the not-configured, configured and changed-revision states
against a controlled in-process GitHub fixture through `tools/check-authority-source.mjs
<consumerDir> <evidenceDir> [--port N]`, using a consumer it installed.

```js
import { createHost } from './tools/consumer/host.mjs'; // application-internal
const host = createHost({ projectRoot, materialRoots, recipeMaterials,
  organizationSource, controls });
const advisory = await host.inspectAuthority({ policyText });
const prepared = await host.prepareSession({ policyText });
// Present the exact Core review, then obtain explicit approval.
if (prepared.status === 'ready') {
  const result = await host.applyApproved({ sessionId: prepared.sessionId,
    reviewDigest: prepared.review.reviewDigest });
}
```

`inspectAuthority` uses Harness `readGitHubPolicy`, Core organization parsing,
`deriveRecipeIdentity` and `previewOrganizationAdmission`. It returns exact source,
resolved commit, blob, digest, policy ID and reader accounting, and separates
`affectedChoices` from `stillValidChoices`. Recipe materials are exact bytes from
host-selected checked inventories. Preview does not capture runtime material or
observe installed lifecycle state and is always advisory. Refused or unreachable
authority has no cached fallback. Vibe explicitly has no organization boundary;
invalid Enterprise never silently becomes Vibe.

Open/import, reopen, explicit Refresh and preparation refresh current authority.
Core independently acquires it again during Prepare and Apply. A changed source,
commit, blob or digest rejects stale approval, even if some choices remain allowed.
Draft/context changes discard the page's previous approval; only opaque host session
IDs and exact review digests cross HTTP. Serialized reviews cannot recreate handles.

`managedInventory()` reads Core's project managed inventory.
`prepareRemovalSession({managementId,scope,mode})` delegates to Core's existing
managed-removal API, returning its disposition and a serializable inner preparation.
Only a ready inner preparation enables explicit Apply. Missing lifecycle grants
require organization action; changed/unowned members may require reconciliation.
Installed files are untouched by authority refresh/withdrawal alone. Replacement
uses ordinary policy preparation; explicit Core `resolutionInputs` can inform a
subsequent `prepareSession({policyText,resolutions})`. Nothing silently repins,
uninstalls, chooses a resolution or claims remote enforcement.

The preview binds startup host-selected inventories and explicitly selected,
validated personal folders to execution material roots. Personal roots are scoped
to the granting page's client. Later uploaded declaration envelopes remain portable
authoring inputs; their locator cannot grant a filesystem root. An unknown execution
binding is refused by Core. Optional evidence and attributed organization-owned human decisions
remain separate from authority regardless of Catalog or independent provenance.

`tools/consumer/prove-real-organization.mjs` runs one finite real GitHub acceptance
scenario through installed packages. It performs no repository mutation: an operator
coordinates a single current-source advance while a browser preparation is held,
using the bounded signal file named by the runner. Prepublished scenario refs cover
admitted/denied/withdrawn/unavailable authority, permitted and blocked recovery,
mixed Vibe/Enterprise lifecycle, original evidence, and actual download/fresh import.
The dedicated test repository and mutation plan are external operator responsibilities.
Use retained transition evidence when rerunning against immutable scenario refs;
never imply a new authority change occurred in that rerun.
`AIH_ORG_TEST_ROOT` optionally selects an independently host-owned disposable target
directory, separate from the evidence output directory. Record both locations and
use a short task-owned target on Windows; retain any failed path-dependent runtime
receipt instead of claiming that a different target validates the failed one.

## Proof boundaries

The page mixes the real independent `consumer-proof.review-note` fixture and
maintained Catalog content. Its template and changed-note snapshot are authored
demonstration data. Synthetic relationship/collision tests are labelled. This
proves authoring/intake and UI/headless agreement, not native client execution,
Scan execution, organization authentication, publication or arbitrary overlays.

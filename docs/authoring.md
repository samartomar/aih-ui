# Mixed-source authoring contract

The supported consumer entry is `aih-ui/authoring` (this private application is
not an npm authoring library). It uses public Core and Catalog interfaces and is
shared with `/authoring`. Install reviewed Core/Catalog/Scan archives through
`tools/consumer-preview.mjs`; open `/authoring` on its printed local URL.
No source checkout imports or `npm link` are needed.

```js
import { freshAuthoring, readAuthoring, composeAuthoring,
  reconcileAuthoring, editAuthoring } from 'aih-ui/authoring';
import { intakeDeclaration } from 'aih-ui/intake';
```

All operations are deterministic and effect-free. Byte arguments are
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
declarations use `urn:aihq:catalog:producer-declaration:3.0.0` with explicit
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

## Choose, trim, Keep and reconcile

`editAuthoring({policyBytes,inventories,operation})` proposes `select`, `template`,
`remove-origin`, `remove-root`, `skip`, or `unskip` using the fields shown in the
page. A removal can carry `keep:[{releaseSha256,itemId,scope}]` for previously
selected items. A kept orphan becomes a direct root with its original explicit
configuration; there is no competing Keep flag. Removing an origin preserves
other origins and shared requirements. All candidates require explicit acceptance.

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
POLICY_BOUND_EXCEEDED, REVIEW_BINDING_UNAVAILABLE and REVIEW_RECONSIDER_REQUIRED.
Underlying failures retain `details:{owner:"core"|"catalog",diagnostics:[...]}`
when wrapped; public Catalog resolver diagnostics retain their shape directly.
Paths are JSON pointers; message prose is explanatory. The consumer limits
intent to 850,000 UTF-8 bytes, 4,096 entries per choice array and 32 inventories;
Core's independent policy bounds also apply. Reduce selected state after a bound
refusal; no partial artifact is produced.

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
  inspectReviewEvidence, recordReview, reconsiderReviews, compareReviewBindings
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

The Node-only `aih-ui/review-host` export supplies
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
finding or reviewed material requires reconsideration; missing bytes preserve
the original and return `REVIEW_BINDING_UNAVAILABLE`. Direct edits to review
records during ordinary composition are refused. `recordReview` creates exact
current decisions only after checked binding; its optional `decision.supersedes`
moves an active prior record into history or references retained history.

`reconsiderReviews({policyBytes,inventories,reviewEvidence?,comparisons?})` proposes
moving changed/unavailable original records unchanged into history and adding
reconsider records that supersede them. Supported content edits do the same when
their candidate removes or changes a reviewed subject. History and the original
reviewed subject remain intact. Unrelated policy metadata, evidence, managed
selections and removals continue through ordinary Core validation.

For an explicitly selected new release with unchanged relevant item material,
supply `comparisons:[{recordId,target:{releaseSha256,itemId}}]` to authoring and
`compareReviewBindings({intent,inventories,reviewEvidence,comparisons})`. The
comparison returns separate `reviewedSubject` and `comparedSubject`; exact Core
recipe/material identities and checked finding/evidence must match. The saved
record is never silently retargeted. The comparison is host-owned context and
must be supplied again on reopen; it is not an extra field in review-v1.

Existing Scan-managed retained handles and independently authenticated prior
artifacts retain their owning API semantics. A serialized handle or JSON cache
copy grants no trusted custody. Human records are portable claims, not human
authenticity or execution authorization. There is no expiry or zero-findings gate.

## Current organization authority and execution host

`aih-ui/execution-host` exports the Node-only `createHost`. The `/authoring`
page and headless consumers use this same host for current authority, preparation,
approval and managed recovery. Configure `projectRoot`, `materialRoots`, exact
`recipeMaterials`, optional `organizationSource`, and private `controls` independently
of imported policy/source/review JSON. The local preview also accepts a host-owned
`AIH_ORGANIZATION_SOURCE` JSON file and `AIH_CONSUMER_CONTROLS`; credentials never
enter the browser or exported policy. Supply authentication to both Prepare and
Apply through host controls. Portable organization origins remain provenance only.

```js
import { createHost } from 'aih-ui/execution-host';
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

The preview binds only startup host-selected inventories to execution material
roots. Later uploaded declaration envelopes remain portable authoring inputs;
their locator cannot grant a filesystem root. An unknown execution binding is
refused by Core. Optional evidence and attributed organization-owned human decisions
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

## Proof boundaries

The page mixes the real independent `consumer-proof.review-note` fixture and
maintained Catalog content. Its template and changed-note snapshot are authored
demonstration data. Synthetic relationship/collision tests are labelled. This
proves authoring/intake and UI/headless agreement, not native client execution,
Scan execution, organization authentication, publication or arbitrary overlays.

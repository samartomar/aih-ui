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

## Review preservation

Review-v1 records contain id, owner `{kind:"individual"|"organization",id}`,
actor, recordedAt (UTC), disposition (false-alarm/accepted-risk), reason, subject
`{releaseSha256,itemId,itemSha256,recipeIdentity,materials}`, finding
`{detectorId,ruleId,findingId}`, evidence `{observationIdentity,detectorIdentity,
rulesIdentity,configurationIdentity,profileIdentity,scopeIdentity,coverageIdentity}`,
state (current/reconsider) and optional supersedes pointing to prior history.
Materials are sorted exact Core identities. Every evidence dimension, including
absent optional dimensions, needs an explicit checked identity.

This authoring boundary preserves review history and reconsider records. It does
not mint new decisions or prove human authenticity. Imported current reusable
decisions require checked observation custody and receive
REVIEW_BINDING_UNAVAILABLE until the evidence review workflow establishes it;
original report/history and execution validity remain intact. Changing review
records through composition is refused. Full decision lifecycle belongs to the
subsequent evidence review workflow. `describeAuthoringSubject` uses Core's
public identity helper on exact supplied recipe bytes; arbitrary cache JSON hashes
are never evidence custody.

## Proof boundaries

The page mixes the real independent `consumer-proof.review-note` fixture and
maintained Catalog content. Its template and changed-note snapshot are authored
demonstration data. Synthetic relationship/collision tests are labelled. This
proves authoring/intake and UI/headless agreement, not native client execution,
Scan execution, organization authentication, publication or arbitrary overlays.

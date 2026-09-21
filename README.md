# aih-ui

The Policy Workbench user interface for AIH, built as an independent application.

## What this repo owns

- The screens, interaction and presentation of the Policy Workbench.
- `prototype/` is the design source. Open `prototype/index.html` in a browser to see it. Build what it shows.

## What it must never contain

- Policy rules, validation, digests or compile logic. Those belong to `@aihq/core`.
- Catalog content, categories, templates or findings. Those belong to `@aihq/catalog`.
- Scanner execution. That belongs to `@aihq/scan`.
- Imports from another repository's source tree, or from a package's private `dist` files. Public package interfaces only.

## Done means

An outside developer can build this UI from public package interfaces. The files it saves are consumed by `@aihq/core` without the UI. Updating only `@aihq/catalog` brings compatible new content without changing core.

## Testing against unpublished packages

Pack each local package with `npm pack`, install the tarballs into a throwaway consumer project, and run the scenario there. Do not use `npm link`: it hides packaging errors such as a wrong `exports` map or a missing file.

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
    workbench.css       what this page adds to the design source's stylesheets
  catalog/              Sources & Catalogs: it presents published data only
    controller.js       the ONE owner of selection and filter state
    entry.js            pure readers over a published entry
    selectors.js        search, filters, sorting, inventory counts (pure)
    index-source.js     fetch + contract assertion of the index and summary
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
    transport.js        every /api/* call
    bytes.js            base64 <-> bytes, and exact-byte downloads
    vocabulary.js       the six axes, their tones, and every typed refusal
    inputs.js           subject readout, evidence import, operator fields
    operator-files.js   the operator's own authority, trust and material
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
  content digest, so it is shown in full rather than as a shortened hash.

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
  Compliance Matrix, the AI tools counter, Egress Guard).

No entry, count or label comes from a hardcoded total: every number on the page is
counted from the installed index at run time. Absence markers are never counted as
release labels or as source identities.

## Layout parity with the design source

`prototype/screens/admin-sources.html` is the design authority. The preview serves
it from the same origin so the two can be compared at one viewport and one zoom:

```
http://127.0.0.1:4173/compare.html
```

Side by side or as a difference overlay, with a live table that reads the geometry
out of both documents at their true 1600x1000 layout size, before scaling. At
1600x1000 the left rail, metric tiles, split row, main column, inspector and first
card all agree exactly on x, y, width and height, in light and dark.

The composition the design source specifies: the metric tiles span the full width
above the split, and the inspector is a **sibling of `<main>`** inside
`#workspace-split-row` -- so it runs the full height alongside the source header,
the source policy controls, the filters and the cards. Nesting it inside the card
row instead puts it 179px too low and stretches the main column by 390px; that is
what a parity check catches and a screenshot comparison of colours does not.

### The rail lists published sources, not a parsed framework

Catalog Scopes has one row per **published source identity** -- a repository for
github, a package for npm, a release for aih -- largest first, with the item count
the index publishes for it. Nothing is read out of an entry id. `@aihq/catalog` is
not a row: it is the package that transports these sources, and it is named in the
provenance strip above the page.

Each row shows a revision only as what it is. A github repository shows its commit
(`affaan-m/ECC 5064474`), linked to that commit. An npm package shows its version,
because an integrity value is not a commit. An aih release shows the release,
because each of its items carries its own content revision and there is no single
framework commit to show.

Selecting a row scopes the grid, the "All Items" count and the masthead to that
source; selecting it again shows every source. The masthead then names the source
and its short revision, with the full value on the tooltip and in the inspector.
The selected row opens to where the design source lists categories. The index
publishes none, so that row says **Not published** rather than inventing one.
The organization's own additions come last and read **Not supplied** until
something is actually imported.

### Cards keep each slot's meaning

A card's slots mean what the design source says they mean: the category badge,
the publisher's description, the scan status and the token estimate. The index
publishes none of them for any item, so each slot keeps its place, its look and its
size and reads **Not published**. The description slot keeps its three lines, so
the grid keeps the design source's card proportions.

Nothing is borrowed into an empty slot. The Catalog's own evidence statements are on
the inspector's Security tab, labelled as statements; the source identity is in
Upstream Provenance; exact ids and digests are behind one disclosure.

The card is titled with the item's published name, `subject.id`, as the design
source titles it. With every source shown at once, the same name can appear more
than once -- the same agent ships in several aih releases -- and the full entry id
is on the tooltip and in the inspector. Scoping the grid to one source removes the
repetition.

The skill icon is `bolt` in the skill primitive's colour, as the design source
renders it; agents and MCP servers use their own primitive colours.

### The toolbar keeps the design source's task

The primary toolbar is **All Items**, **Needs Review**, **Egress Out**, with the
"need review" and "send data out" summaries on the right, in their original
places. Only "All Items" can be derived, so it is the selected state and counts the
items in scope. The other two keep their purpose but are unavailable, with no count:

- no scan result or Core disposition is published per item, so no review state can
  be derived;
- no item declares egress, and an empty declaration is not a measurement of none.

The technical filters that ARE available -- kind, source type and sort -- are in the
grid header, where the design source puts its sort control.

### Four words for four kinds of absence

- **Not published** -- a field the index does not carry.
- **Not declared** -- a field the index carries as an empty list. Every item's
  capability lists are empty; that is a declaration, not a measurement, so it is
  never shown as "none".
- **Not supplied** -- the user's own input, such as the organization.
- **Not connected** -- an action with no Core contract wired yet.

### Your organization

The header's organization control is always enabled: organization details are the
user's input, not missing Catalog data. It opens the design source's setup popup
-- name, short id, policy repository, the people who answer for it, and the
Vibe / Enterprise preference -- with the same layout and labels, and none of its
sample values.

- It starts empty, or with what the user saved. Nothing is read from git, and no
  field claims to have been.
- Save validates the fields and keeps the draft in this browser, so it survives a
  reload; the header then shows the name. Cancel, the close button, a click outside
  and Escape all leave the saved draft exactly as it was.
- Emails can be added and removed; a malformed or duplicate one is refused.
- The Vibe / Enterprise choice is recorded as a preference. Signing and verifying
  policies is not implemented here, and the popup says so.
- None of it is policy authority. A name, an id, a repository reference, an email
  or a preference establishes no decision; policy artifacts still go through Core.

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
`execution` is always `not-attempted`: nothing is ever executed, so no screen says
Applied, Executed or Published.

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

- 429 of the 457 entries cannot bind today. `github` sources refuse with
  `missing-repository-commit-provenance-record` and the one `npm` source with
  `missing-tarball-sha512-record`. The pane shows the named reason and what it
  would take to resolve it, never a generic failure.
- The furthest any route reaches is `observation-missing` / `partial`:
  qualification resolves, the effect is not executed.
- AIH-supported qualification is unavailable. The index declares
  `organizationAdmission: "not-authoritative"` and ships no signed support
  receipt; the pane surfaces that field verbatim.
- Genuine detector evidence is still outstanding. Everything shipped today is a
  labelled fixture.

## Running it

```
node tools/preview.mjs
```

It serves `http://127.0.0.1:4173/`. Two halves: a static page, and a backend that
runs `tools/service/` inside a throwaway consumer. All Node-only package APIs and
all filesystem access live on that side; the page never sees a path it did not
supply.

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
  service/              COPIED INTO THE CONSUMER, run from there
    core-service.mjs    the operation dispatcher (stdin -> stdout)
    catalog-access.mjs  the installed @aihq/catalog, through its export map
    core-adapter.mjs    calls to @aihq/core's public API; never a reimplementation
    scan-verifier.mjs   the Scan verifier wiring and its trust boundary
    artifacts.mjs       exact-byte artifact I/O
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

**Remaining gap for @aihq/catalog:** it publishes artifact paths but not the
directory that contains them, so the one place that still reads a layout off a
path is `entryContentDir` in `tools/service/catalog-access.mjs`. It works from a
path `resolveCatalogContentPathV1` has already validated, and it is the single
place to change when Catalog publishes an accessor for it.

`@aihq/scan` publishes `readScanResultRecordV1` and
`readScanResultSubjectBindingV1`. Both accept only a value
`verifyScanAttestationV2` produced, so a cloned or hand-written object is
refused. They provide **presentation facts, not proof of execution**:

- a finding record is an occurrence fingerprint and a multiplicity. Message,
  location and severity are not in the attestation, and the record's own `gaps`
  say so. The pane shows those gaps verbatim rather than filling anything in.
- `run.state` and `signer.class` are values the attestation declares. The pane
  labels them "(declared)". An ephemeral test key reports
  `signer.class: "organization"` too.
- `readScanResultSubjectBindingV1` returns the digest of the **source tree that
  was scanned**. It does not establish that the selected catalog item was in
  that scan. Core's source-seal check, selected-file binding, configured-trust
  check and evidence reprojection remain the only things that do, and they are
  unchanged.

**Installing @aihq/catalog@0.2.0 or @aihq/scan@0.4.0 from npm does not provide
these APIs.** They come from the reproducible test checkpoints
`88d7e652` (Catalog) and `4d1ebb9d` (Scan), which are not version pins.

### Six results, six owners

The Governance pane never merges answers that belong to different owners:

| Result | Owner | Where it comes from |
| --- | --- | --- |
| Catalog artifact integrity | Catalog | `readCatalogContentV1` with `verifyArtifacts`, via `/api/catalog-integrity` |
| Published evidence | Catalog | the index's qualification records — **declared, and not byte-checked by that reader** |
| Scanner attestation | Scan, under operator trust | `verifyScanAttestationV2` inside Core's consumption |
| Scanner result facts | Scan | `readScanResultRecordV1`, read after verification |
| Binding | Core | the six status axes |
| Authority | Core | the six status axes |

"artifacts: verified" covers the four declared artifacts of an entry — closure,
profile, prose and recipe. It does not cover the qualification evidence files,
which are separate paths in the same index, so the pane shows the record count
beside `Bytes checked here: 0` rather than letting one read as the other.

The page's own calls are `/api/subject`, `/api/catalog-integrity`,
`/api/evidence`, `/api/operator-file`, `/api/validation-fixture`,
`/api/prepare`, `/api/reopen`, `/api/consume` and `/api/saved`. The page never
names a filesystem path in any of them: it holds an opaque session id, and every
location is derived from that id inside the run directory.

Malformed requests are the client's problem, not the server's: a request URL or percent
escape that does not parse is answered with `400` and the preview keeps serving. The
classification lives in `tools/preview-request.mjs`.

`tools/check-page-contract.mjs` runs three offline regressions with no install and
no server — that every element id the page modules collect exists in `index.html`
exactly once, that the module graph resolves and every asset the page references
is one the preview copies, and that request paths classify as above. The required
id set is derived by reading EVERY module under `src/` rather than restated, so
splitting a module cannot move an id out of the check's view:

```
node tools/check-page-contract.mjs
```

Where the prototype showed a field the index does not publish, the page keeps the
layout, shows **Not published**, **Not supplied** or **Not connected** as above, and
disables the control. The current list:
organization scope; Vibe/Enterprise and the AI tools counter; Review Changes count,
Check Policy and Publish; the Commands, Hook Events and Token Budget ledger kinds;
allowed/active numerators and percentages; the source-policy posture segment;
search-result egress classification; per-engine scanner telemetry and detector
identities; network egress, execution sandbox and required secrets; the policy
determination choices; Reset Item and Apply; and the Policy JSON pane with its Copy
and Download.

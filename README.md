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

## The first clickable page: Sources & Catalogs

`src/index.html` and `src/catalog.js` are the Sources & Catalogs page, built from
`prototype/screens/admin-sources.html`. It shows the whole installed
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

## The Governance pane: one vertical slice through Core

The inspector's **Governance** tab runs the whole contract end to end:

catalog selection -> inspect published information -> import evidence -> select an
operator-supplied decision, target and effect -> prepare through `@aihq/core` ->
save the exact bytes Core returned -> reopen them -> consume them independently ->
display the result.

`src/governance.js` collects input and renders answers. It holds no policy, digest
or compile logic: every derivation happens in `@aihq/core` behind `/api/*`.

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

It serves `http://127.0.0.1:4173/`. Two halves: a static page, and a backend
(`tools/preview-api.mjs`) that runs `tools/core-service.mjs` inside a throwaway
consumer. All Node-only package APIs and all filesystem access live on that side;
the page never sees a path it did not supply.

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

`@aihq/catalog` exports `./catalog-index.json` and nothing for entry content. The
index publishes every artifact's package-root-relative path, so the package root
is derived from where the export map placed the index, and that relationship is
checked rather than assumed. A failure there is reported; no internal directory is
ever guessed. **Gap for @aihq/catalog: no export covers entry content.**

Malformed requests are the client's problem, not the server's: a request URL or percent
escape that does not parse is answered with `400` and the preview keeps serving. The
classification lives in `tools/preview-request.mjs`.

`tools/check-page-contract.mjs` runs two offline regressions with no install and no
server — that every element id the page modules collect exists in `index.html`
exactly once, and that request paths classify as above. The required id set is
derived from `src/catalog.js` and `src/governance.js` rather than restated, so it
cannot drift from them:

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

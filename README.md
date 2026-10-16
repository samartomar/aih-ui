# aih-ui

The Policy Workbench user interface for AIH, built as an independent application.

## What this repo owns

- The screens, interaction and presentation of the Policy Workbench.
- Consumer draft editing, selection interactions, composition through public Catalog and Core validators, and policy import/export. This is application workflow; Core retains policy validity, organization authority and execution semantics.
- Versioned consumer saved intent: explicit roots, exact template origins, optional skips, configuration, source provenance and content pins. `metadata.aih.workbench` is a consumer convention. Catalog remains the dependency/configuration validator; Core remains the policy and execution authority.
- The versioned Workbench journey envelope (`aih-ui/journey`, `schemas/journey-envelope/1.0.0.json`): a non-executable record that keeps unresolved authoring drafts beside the exact saved-intent bytes they reference. Later record kinds are added as new versioned record schemas.
- Maintenance dispositions (`aih-ui/maintenance`, `schemas/journey-record-maintenance-disposition/1.0.0.json`): an optional journey record that remembers keep current, skip this exact revision or defer (optionally until a date) for an available update, by category, subject selection, scope and exact candidate revision. Opening a draft and Check now only read the envelope and the host-configured sources; they never scan, run native checks, call a model, apply anything or schedule anything. A defer date is considered only when the Workbench opens or checks. A later revision is a separate update, authority and evidence facts stay visible whatever the choice, and unselected update categories are never checked or added. An ordinary saved policy gets the same check, and recording a choice on it saves it as a draft. A second optional record (`schemas/journey-record-maintenance-check/1.0.0.json`) keeps the time and category states of the last successful check, written only when an envelope is saved, so a reopened draft can show them while sources are unreachable. A malformed disposition or check record refuses the whole envelope, like the unresolved-draft record.
- Organization baseline drafts (`aih-ui/organization-author`, `schemas/journey-record-organization-draft/1.0.0.json`): a required journey record that keeps an organization author's entries, obligations, selectors, input permissions and declared targets beside the empty Enterprise starting policy. Preview results (admission, advisory, fulfillment, contradictions) come from Core. Export writes a candidate organization policy, an explanation and the repository, path and ref to hand to a pull request; it does not publish, authenticate or sign, and never activates authority. Developers are governed only by what is merged and read at the configured source.
- Portable human evidence-review decisions, history and reconsideration through the same supported UI/headless boundary. Exact checked evidence bindings remain separate from producer authentication and execution authority.
- Current host-selected Enterprise authority presentation and explicit recovery through public Core Prepare/Apply and managed-removal APIs; shared with the Node-only `aih-ui/execution-host` boundary.
- Explicit browser folder selection, bounded recognition of personal SKILL.md content through Catalog's public producer, and ephemeral client-scoped material grants. Saved intent records exact choices and provenance; fresh pages require explicit folder rebinding.
- `src/` owns the live screens, design tokens, and presentation. Tailwind utilities are compiled locally from the classes used in `src/`.
- `prototype/` is retained as a separate design reference. The running page does not import it.
- Local onboarding preferences (experience, organization context, requested assistance and explicit AI clients). These are UI settings, not policy artifacts or enterprise authorization.
- The machine-readiness check and host-configured npm repair: Core inspection and repair results projected as failed, unknown, applied, configured or verified, with no project, saved intent or policy. See [machine readiness](docs/readiness.md).
- Guided personal setup (`src/guided.html`): a goal sentence, an optional project folder inspected only in the browser and the chosen AI clients become explained starter choices from the served Catalog, a copyable prompt and a saved unresolved-draft envelope. The rules are fixed and local (`src/app/guided-rules.js`); no folder content, model call or upload is involved.

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
remain unavailable with an explanation. `AIH_MAINTENANCE_SOURCE` is a demonstration and test input: the path of a small JSON file naming note-fixture revisions to publish as newer revisions of the review note. Unset, the host has no update source and content updates are unknown, not checked. `AIH_UI_SETTINGS_PATH` selects an
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

The AI tools control lists the AI CLIs `@aihq/core` supports as targets, from its
public `SUPPORTED_CLIS` export, read by the backend from the installed package. The
page keeps no list of its own, so reinstalling a different Core changes the list and
the version with no UI edit. It reads `<selected> of <supported>`. Supported,
selected and connected are kept apart:

- supported is Core's list;
- selected is the user's explicit choice, saved in the workspace setup file -- not a policy;
- installed or connected is **Not connected**: nothing here checks a tool.

The Workbench design's `3 of 11` was sample data and is not restored as state.

The Governance pane's **Target** field reads that same list and keeps no copy
either: its options are Core's targets in Core's own order, so a Core listing
different ones changes the field with no UI edit. A Core that publishes no list
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
uses Core's public `SUPPORTED_CLIS`; it never infers clients from capabilities.

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
  service/              COPIED INTO THE CONSUMER, run from there
    core-service.mjs    the operation dispatcher (stdin -> stdout)
    catalog-access.mjs  the installed @aihq/catalog, through its export map
    core-adapter.mjs    calls to @aihq/core's public API; never a reimplementation
    scan-verifier.mjs   the Scan verifier wiring and its trust boundary
    artifacts.mjs       exact-byte artifact I/O
    catalog-collections.mjs  Catalog's current collection view, via its reader
    core-targets.mjs    Core's supported AI CLI targets, via its public export
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
Core's public `SUPPORTED_CLIS`. Until those reach the checkouts the preview reads
by default, point it at checkouts that have them:

```
CORE_REPO=<core checkout> CATALOG_REPO=<catalog checkout> node tools/preview.mjs
```

A Core without `SUPPORTED_CLIS` leaves the AI tools control reading **Not
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

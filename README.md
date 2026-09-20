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

`tools/preview.mjs` builds and serves it against the real published package:

```
node tools/preview.mjs
```

It runs `npm ci` and `npm run build` in `../aih-catalog` when `dist` is missing,
packs that checkout with `npm pack --json` into a new temp folder outside every
repository, `npm install --ignore-scripts` the tarball into a throwaway consumer
there, resolves `@aihq/catalog/catalog-index.json` through the installed package's
export map, refuses to serve anything but format `aih-catalog-index` version `1`,
copies the page files and that JSON into the run directory, and serves them on
`http://127.0.0.1:4173/`. It prints the run directory and the URL it actually
listened on. No `npm link`, and no catalog file is read except through the installed
package.

The page needs the network for Tailwind, Inter, JetBrains Mono and Material Symbols,
exactly as the prototype does. Catalog strings are rendered with `textContent`.

Where the prototype showed a field the index does not publish, the page keeps the
layout, shows **Not published**, and disables the control. The current list:
organization name; Vibe/Enterprise and the AI tools counter; Review Changes count,
Check Policy and Publish; the Commands, Hook Events and Token Budget ledger kinds;
allowed/active numerators and percentages; the source-policy posture segment;
search-result egress classification; per-engine scanner telemetry and detector
identities; network egress, execution sandbox and required secrets; the policy
determination choices; Reset Item and Apply; and the Policy JSON pane with its Copy
and Download.

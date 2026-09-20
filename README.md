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

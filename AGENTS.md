# Working in this repo

1. This repo owns the Policy Workbench screens only. `README.md` lists what it must never contain.
2. `src/` owns the implemented screens and their presentation. Keep Tailwind as a pinned local build and put Workbench design tokens and CSS in `src/styles/`. Define palette values only in the root themes in `tokens.css`; use semantic roles in components. Keep the per-kind, metadata and action accents theme-aware, and preserve status color meanings.
3. Use only the public interfaces of `@aihq/core`, `@aihq/catalog` and `@aihq/scan`. If something the UI needs is not published, stop and report the gap. Do not copy logic or read another repository's source to work around it.
4. Build the smallest version first, and put a clickable page in front of the owner before anything else.
5. Keep no plans, handoffs or status documents in this repo. A decision that changes what the repo owns goes in `README.md`.
6. Never publish to npm or force-push without the owner's explicit approval.

For maintainer assignments, keep the coordinating session in its supplied
workspace and target this Git root explicitly for commands and edits. Load these
product rules from that session. Coordination across repositories does not relax
the public-interface boundary above. Public contributors can use this repository
independently; private startup routing stays outside public files.

## Workflow references

Use the managed Matt Pocock skills and Extensions within this repository's rules.
Keep upstream skills in their managed installation, unchanged by repository cleanup.

- [Issue routing](docs/agents/issue-tracker.md): owning delivery issue and intake.
- [Triage](docs/agents/triage-labels.md): existing label roles and mappings.
- [Domain documentation](docs/agents/domain.md): vocabulary and decision homes.

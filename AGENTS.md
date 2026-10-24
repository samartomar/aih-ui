# Working in this repo

1. This repo owns the Policy Workbench screens only. `README.md` lists what it must never contain.
2. `src/` owns the implemented screens and their presentation. Keep Tailwind as a pinned local build and put Workbench design tokens and CSS in `src/styles/`. Define palette values only in the root themes in `tokens.css`; use semantic roles in components. Keep the per-kind, metadata and action accents theme-aware, and preserve status color meanings.
3. Use only the public interfaces of `@aihq/core`, `@aihq/catalog` and `@aihq/scan`. If something the UI needs is not published, stop and report the gap. Do not copy logic or read another repository's source to work around it.
4. Build the smallest version first, and put a clickable page in front of the owner before anything else.
5. Keep no plans, handoffs or status documents in this repo. A decision that changes what the repo owns goes in `README.md`.
6. Never publish to npm or force-push without the owner's explicit approval.

## Agent skills

Use the installed Matt Pocock engineering skills and aih-extensions within this repository's existing rules. Keep the skills in their managed user installation.

### Issue tracker

GitHub Issues on `samartomar/aih-ui`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

One product vocabulary with the existing decision authority. See `docs/agents/domain.md`.

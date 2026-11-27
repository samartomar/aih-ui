# Working in this repo

**Hard rule for maintainer sessions.** This checkout belongs to a larger maintainer workspace. Start every session at that workspace's root and target this repository from there; never start one here. Create no worktree of this repository alone: a needed worktree is created under the workspace root, with the session still at that root.

The workspace owns workflow, issue routing, triage, delivery and release process. This file holds only this repository's own rules; outside contributors without the workspace follow the public documentation and these rules.

1. This repo owns the Policy Workbench screens only. `README.md` lists what it must never contain.
2. `src/` owns the implemented screens and their presentation. Keep Tailwind as a pinned local build and put Workbench design tokens and CSS in `src/styles/`. Define palette values only in the root themes in `tokens.css`; use semantic roles in components. Keep the per-kind, metadata and action accents theme-aware, and preserve status color meanings.
3. Use only the public interfaces of `@aihq/core`, `@aihq/catalog` and `@aihq/scan`. If something the UI needs is not published, stop and report the gap. Do not copy logic or read another repository's source to work around it.
4. Build the smallest version first, and put a clickable page in front of the owner before anything else.
5. Keep no plans, handoffs or status documents in this repo. A decision that changes what the repo owns goes in `README.md`.
6. Never publish to npm or force-push without the owner's explicit approval.

Screen wording follows [GLOSSARY.md](GLOSSARY.md).

# Working in this repo

1. This repo owns the Policy Workbench screens only. `README.md` lists what it must never contain.
2. `prototype/` is the design source. Build what it shows. Do not redesign it.
3. Use only the public interfaces of `@aihq/core`, `@aihq/catalog` and `@aihq/scan`. If something the UI needs is not published, stop and report the gap. Do not copy logic or read another repository's source to work around it.
4. Build the smallest version first, and put a clickable page in front of the owner before anything else.
5. Keep no plans, handoffs or status documents in this repo. A decision that changes what the repo owns goes in `README.md`.
6. Never publish to npm or force-push without the owner's explicit approval.

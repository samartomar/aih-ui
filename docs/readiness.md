# Machine readiness

The Workbench can check, and with explicit approval repair, the developer's machine
before any project, saved intent or policy exists. Core owns every observation and
every repair; this repo projects Core's public records onto five words and puts them
in front of the developer.

- `tools/consumer/readiness.mjs` — pure projection, shared by the page and headless callers
  (application-internal; not a package entry).
- `tools/consumer/readiness-host.mjs` — Node-only host over Core `inspect`, `prepare` and
  `apply` (application-internal; not a package entry).
- `tools/server/readiness.mjs` + `tools/consumer/readiness-child.mjs` — the HTTP routes and
  the child process Core runs in.

## States

Failure sorts first. A result is **ready** only when Core reported it complete, it is
non-empty and every condition is `verified`.

| State | Meaning |
| --- | --- |
| `failed` | Core observed the condition and it is wrong (or needs changes). |
| `unknown` | Not observed: offline, unavailable, skipped, deadline, cancelled or not prepared. Never ready. |
| `applied` | A repair wrote the change but verification did not pass (not run, unavailable or skipped). |
| `configured` | Files or client setup are in place but nothing verified they work. Never ready. |
| `verified` | A check passed (or a repair verification passed and a fresh preparation finds it satisfied). |

### Machine check (Core `inspect`)

| Core record | State |
| --- | --- |
| check `passed` | `verified` |
| check `failed` | `failed` |
| check `unavailable` or `skipped` (for example `network-off`, `executable-missing`) | `unknown` |
| client observation `…/loading` (installed, loading not checked) | `configured` |
| result status other than `complete` | rows keep their states; the overall state adds `unknown`, so an observed failure still leads and the result is never ready |

### Repair preparation (Core `prepare`)

| Operation effect | State |
| --- | --- |
| `already-satisfied` | `configured` (files alone are not verification) |
| `create-file`, `replace-file`, `remove-file`, `conflict` | `failed` (changes needed) |
| `unavailable`, `opaque-process`, or preparation neither `ready` nor `partial` | `unknown` |

A `partial` preparation keeps its operation states and is approvable only when Core returned a live handle and review digest; Core's own partial-work rules then apply.

Preparing never changes anything.

### Repair outcome (Core `apply`, then a fresh recheck)

| Core result | State |
| --- | --- |
| application or verification `failed` | `failed` |
| application `not-attempted` | `unknown` |
| `applied` without passing verification | `applied` |
| `already-satisfied` without passing verification | `configured` |
| verification `passed` and a fresh preparation finds the operation `already-satisfied` | `verified` |
| verification `passed` but no fresh preparation is available | `applied` |
| verification `passed` but the fresh preparation still needs changes | `failed` |

The overall outcome also uses a fresh inspection of the repair's targets after apply:
a failed check of that condition makes the outcome `failed`; a missing, unavailable or
unchecked one leaves it at most `applied`. Fresh-preparation work outside the run is
listed as `unresolved` and follows the preparation mapping above (changes needed is
`failed`; unavailable is `unknown`). The outcome is ready only when every operation is
verified and that inspection verified every checked condition of the repair's targets.

### Recheck scope

The post-repair inspection covers only the repair's targets, so it is a
`repair-recheck`, never a machine check: its `ready` is always `false`, `scopeVerified`
says whether those targets verified, and `notRechecked` lists every other target of the
host's latest machine check with its state there (`null` when no machine check ran).
Neither a repair outcome nor a recheck is worded as machine readiness. After a repair,
the page's Result line and the guidance show the latest machine check, labelled as taken
before the repair; only a new machine check can state that the machine is ready.

### Persisted configuration

Node reads `NODE_EXTRA_CA_CERTS` only when a process starts. A long-running host that
checks with its own start-time trust therefore never sees the CA a repair persists, so a
real repair could never verify. Core's `configuration: 'persisted'` instead evaluates
Node TLS with the trust its own managed `node-npm-ca` configuration gives a new process.
`tls/os` checks still use the operating system's trust.

- **Machine check.** Core's default (`process`) inspection is the machine's readiness,
  exactly as before, so trust the developer configured themselves still counts. The host
  then inspects the same targets with the same network setting in the persisted
  configuration, and journals that inspection beside it as `persistedCheck`. The check
  returns `{ projection, persistedCheck, comparison, guidance }`. The `comparison` names
  every check whose state differs between the two. The guidance and the report say so
  plainly, and the score and blockers keep using this host's result. If the persisted
  inspection fails, the comparison is unavailable and says so.
- **Recheck.** The post-repair recheck of the repair's targets uses the persisted
  configuration.

Each projection carries `options.configuration` and `persisted`: one entry per value
Core found (`id`, `repair`, `managementId`, `state`, and when `applied` the
`certificates` count and `materialSha256`), or `null` for a process-configuration
inspection. Material and member (profile or `.npmrc`) paths are dropped. A value that
is not `applied` is not used, and Core marks the inspection incomplete. The guidance
names each value and its state, or says Core could not read that configuration
(`persisted-configuration-unavailable`) rather than that none was found.

What counts as a verified repair under this rule is in [report](report.md#what-counts-as-a-verified-repair).

## Readiness records

The host keeps the latest 64 checks and repair outcomes in memory, never on disk.
Each `urn:aih-ui:readiness-record:1.0.0` record carries a UUID, strictly increasing
UTC timestamps, the Core package name/version when known, and a SHA-256 of the
exact Core result records. A machine check also carries its persisted inspection
(`persistedCheck`). Repairs link to the machine check held when apply
started and carry Core's run identity, apply/recheck instants and projected outcome.
`records()` returns a deep copy; restarting the host loses the journal. The improvements check reads these records as friction evidence
(see the README's "Recurring friction from stored Core results").

## HTTP routes

All JSON, same-origin. POST requires `content-type: application/json` and an `Origin`
equal to the page origin; bodies are limited to 64 KiB; responses are `no-store`.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/readiness-check` | `{ targets?, network? }` — Core target ids, `declared` or `off` | `{ status: 'ok', value: { projection, persistedCheck, comparison, guidance } }` — `projection` is the machine's readiness |
| `GET /api/readiness-report` | — | `{ status: 'ok', value: { records, claimSet, projection } }` — normalized claims and Core's report projection |
| `GET /api/readiness-repairs` | — | `{ status: 'ok', value: { repairs: [{ key, id, targets, network }] } }` — never paths or inputs |
| `POST /api/readiness-repair-prepare` | `{ key }` | `{ status: 'ok', value: { sessionId?, reviewDigest?, operations, projection } }` |
| `POST /api/readiness-repair-apply` | `{ sessionId, reviewDigest, approved: true }` | `{ status: 'ok', value: { outcome, recheck, machine, guidance } }` — `machine` is the latest machine check (`beforeRepair: true`) or `null` |

A missing or already-used session answers `{ status: 'lost' }`; a wrong digest or
`approved !== true` answers `{ status: 'rejected' }` and applies nothing. Both are HTTP 200
because the body status is the decision; a session is one-shot, and a rejected attempt
keeps it. Failures are `{ status: 'error', diagnostics: [{ code, message }] }` with a 4xx
(invalid or unauthorized request) or 5xx/502 (host failure or restart) code; an error is
never presented as success.

Guidance is plain text for the developer's existing AI client. Producing it changes
nothing and nothing in the Workbench executes it.

## Host configuration

These are host and test inputs; no HTTP request can set them.

- `AIH_READINESS_REPAIRS` — path to a JSON file `{ "repairs": [{ "key", "id", "targets",
  "inputs", "network" }] }`. Only these repairs can be prepared. Inputs (such as the CA
  file path) stay in the host. Without it the repair list is empty.
- `AIH_READINESS_HOME` — a directory the Core child process uses as its home
  (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and the XDG directories beneath it).
- `AIH_READINESS_PATH` — replaces `PATH` for the Core child process.

If the child process stops or exceeds its time limit it is restarted on the next request
and earlier sessions answer `lost`.

## Controlled fixture only

Tests and demonstrations never point Core at the owner's real home or clients.
`tools/consumer/readiness-fixture.mjs` builds a disposable home, a `PATH` with one
deliberately broken `jq` and a test-only CA certificate; its `env` is passed to the host
process (`AIH_READINESS_HOME` / `AIH_READINESS_PATH` for the server). The host test fails
if the process home is not the fixture and asserts the real `.npmrc` is untouched. The
`PATH` must contain `npm`; if npm is not beside `node`, add its directory.

## Not covered

- Only host-configured `node-npm-ca` repair of the `npm` target is offered. The `node`
  target is never offered from the Workbench in this slice (on Windows it writes the
  user's environment), and the host refuses to configure it.
- No automatic execution of guidance, and no project, policy or saved-intent coupling.
- Online verification pings the public npm registry; with `network: 'off'` Core cannot
  verify, so the outcome is `applied`, never `verified`.

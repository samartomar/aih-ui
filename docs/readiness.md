# Machine readiness

The Workbench can check, and with explicit approval repair, the developer's machine
before any project, saved intent or policy exists. Core owns every observation and
every repair; this repo projects Core's public records onto five words and puts them
in front of the developer.

- `tools/consumer/readiness.mjs` — pure projection, shared by the page and headless callers
  (`aih-ui/readiness`).
- `tools/consumer/readiness-host.mjs` — Node-only host over Core `inspect`, `prepare` and
  `apply` (`aih-ui/readiness-host`).
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
| result status other than `complete` | `unknown`, not ready |

### Repair preparation (Core `prepare`)

| Operation effect | State |
| --- | --- |
| `already-satisfied` | `configured` (files alone are not verification) |
| `create-file`, `replace-file`, `remove-file`, `conflict` | `failed` (changes needed) |
| `unavailable`, `opaque-process`, or preparation not ready/partial | `unknown` |

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

## HTTP routes

All JSON, same-origin. POST requires `content-type: application/json` and an `Origin`
equal to the page origin; bodies are limited to 64 KiB; responses are `no-store`.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/readiness-check` | `{ targets?, network? }` — Core target ids, `declared` or `off` | `{ status: 'ok', value: { projection, guidance } }` |
| `GET /api/readiness-repairs` | — | `{ status: 'ok', value: { repairs: [{ key, id, targets, network }] } }` — never paths or inputs |
| `POST /api/readiness-repair-prepare` | `{ key }` | `{ status: 'ok', value: { sessionId?, reviewDigest?, operations, projection } }` |
| `POST /api/readiness-repair-apply` | `{ sessionId, reviewDigest, approved: true }` | `{ status: 'ok', value: { outcome, recheck, guidance } }` |

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

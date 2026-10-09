# Verification evidence

Verified locally on **2026-10-09**, macOS, Node **22.23.2**, npm **10.9.8**.
The source repository is public on GitHub (visibility checked on 2026-10-09).
No npm/package release has been made. Initial private-visibility evidence below
records the status at that earlier checkpoint.

## Simplified onboarding

- `npm run check` passed. Full regression: **75 passed, 0 failed, 0 skipped**
  with local loopback networking allowed.
- Three real 100x28 PTY dashboard flows completed: local OpenAPI import, no-file
  manual GET with bearer environment-variable name, and no-file local demo.
  Each started with MCP name, derived its filename/source id, required explicit
  tool selection and returned to the dashboard. No filename/source-id/schema
  customization prompts appeared. Client instructions were only displayed on
  request. Invalid API addresses and a config mistaken for an OpenAPI file were
  corrected inside their prompts. No user config was modified.
- All three generated configs passed strict validation. A focused HTTP regression
  validates the inferred string placeholder before making an authenticated GET,
  percent-encodes its value and checks exactly one request reached the fixture.
- Scripted init without `--config` derives the filename and uses an unused numbered
  path on collision; supplied flags and explicit config paths remain tested.
- A first focused test incorrectly omitted the required non-interactive API URL
  flag and waited for input. That test and its child process were stopped; the
  corrected focused run and full regression passed. It was not counted as a pass.
- Earlier filename/chapter-wizard evidence below is historical; those entry
  questions are superseded by the name-first setup.

## New-project filename recovery

- `npm run check` passed. Full regression: **72 passed, 0 failed, 0 skipped**,
  with loopback networking allowed.
- Regression checks cover occupied default filenames, numbered suggestions,
  bare-name normalization, duplicate targets, unsupported extensions and missing
  folders. Existing content remains unchanged.
- In a real 80x24 PTY, entering an existing `project0.json` showed the collision
  within the prompt while the wizard stayed alive. Ctrl+U replaced the input
  with `test`; beside an existing `test/` directory this created `test.yaml`.
  The demo wizard completed, returned to the refreshed dashboard and exited
  cleanly. The existing file was byte-for-byte unchanged, and the new config
  passed strict validation with two selected tools. All fixtures were temporary.

## Navigation and dashboard onboarding

- `npm run check` passed. Full regression: **71 passed, 0 failed, 0 skipped**,
  with loopback networking allowed. Layout tests include the source count footer.
- Frame/state regressions navigate beyond a four-entry viewport in a seven-source
  list, target wheel events by pane despite previous tool focus, bound navigation
  at list edges and ignore mouse input during settings editing.
- A real 80x24 PTY used seven synthetic project configs. Keyboard navigation
  reached entry 7; an SGR wheel event over the left pane moved to entry 6 after
  tools had focus. This verifies Terminal Kit mouse decoding, not just a state
  helper. Physical mouse behavior in desktop terminals was not separately tested.
- The same PTY pressed `n` and completed the interactive demo wizard: filename,
  project/source names, demo choice, both tool selections, no customization and
  no auth. Server/client instructions remained visible at the final Enter prompt.
  Enter returned to a dashboard with eight sources. The created config passed
  strict validation with two selected tools; `q` exited successfully. No user
  configuration was modified and no demo API was started by the wizard.

## Quiet selection animation

- `npm run check` passed. Full regression: **69 passed, 0 failed, 0 skipped**
  with loopback networking allowed. OpenAPI/manual strict validation passed.
- Frame regression checks keep title/card positions fixed through the border
  build and prove completed frames do not change during idle ticks.
- A real 80x24 PTY loaded a synthetic two-source config. Changing source emitted
  build frames, then idle produced **0 bytes** over 400 ms. Repeated Enter also
  produced **0 bytes**. Output used SGR 49 (default background), no fixed
  background SGR, and `q` exited successfully. No project settings changed.
- Native macOS Terminal at 80x24 was visually inspected with its default light
  theme: boxes remained readable and inherited the white background. `q`
  restored the shell. The short build timing was verified in the PTY rather
  than claimed from a static screenshot.
- Earlier sliding/pulsing verification below records historical behavior;
  those effects are superseded by this update.

## ASCII container refinement

- `npm run check` passed; the full suite has **68 passed, 0 failed, 0 skipped**.
  The initial sandboxed run could not bind loopback ports (EPERM); a rerun with
  local network permission passed. Strict validation passed all four examples.
- Regression checks cover non-overlapping ASCII borders, title travel and card
  reveals at 64/80/100/180 columns and 18/24/28/40 rows, including long names,
  settings selection and a visible Save entry. Repeated Enter/Right preserves
  progress and tool selection.
- Native macOS Terminal at 80x24 was visually inspected. Keyboard checks opened
  the tool pane, switched a synthetic tool OFF, opened Settings and restored
  the terminal with `q`. Disk verification confirmed only the temporary config
  changed. Layout sizes beyond 80x24 were checked by frame tests, not native
  screenshots. The animation represents enablement, not live API traffic.

## Terminal dashboard update

- `npm run check` passed. The local suite has **66 passed, 0 failed, 0 skipped**
  tests, including local project discovery, persistent enable/disable state,
  preservation of customized definitions after restart, stale edit protection,
  Settings validation, layout bounds and actual SDK rejection of disabled tools.
- A PTY session with TERM=xterm exercised the animated title/card transition,
  switching projects/sources and keyboard panes, Space toggling, Settings timeout
  editing/saving and `q` cleanup. Disk reads confirmed the changed switch and
  timeout. Fixtures were temporary copies, not user project modifications.
- `npm link --ignore-scripts` installed the local `openmcp` alias;
  `openmcp --version` returned `0.1.0`.
- Runtime `npm audit --omit=dev` reported zero known vulnerabilities after adding
  Terminal Kit 3.1.4.
- The dashboard requires an interactive terminal. Piped invocation refuses
  cleanly with no terminal escapes; explicit serve/export paths retain their
  tested stdout contracts. Live traffic monitoring is not implemented.

## Guided onboarding update

- `npm run check` passed. The updated local suite has **58 passed, 0 failed,
  0 skipped** tests, including tour side effects, clean stdout in pipes and
  accurate next commands for demo/custom API URLs.
- The recommended local-example wizard completed through all five chapters in
  a PTY with TERM=xterm. Both read/write tools were explicitly selected and
  the output configuration passed strict validation.
- The initial GitHub MVP CI passed on Linux with Node 22 and Node 24:
  [CI run](https://github.com/frickadelle/OpenMCP/actions/runs/37983619237).
  That run tested the baseline MVP; the onboarding commit will run the same CI.

## Initial MVP evidence

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed all source/test/example/script syntax checks |
| `npm test` on baseline MVP | **55 passed, 0 failed, 0 skipped**, approximately 3.63 seconds |
| `npm run smoke` on baseline MVP | Passed, **1.916 seconds** with dependencies already installed |
| `validate --strict` on OpenAPI/manual/multi/auth examples | All four passed, zero unsupported operations |
| `npm audit --omit=dev --json` | 0 known vulnerabilities at the check time |
| `npm audit --json` | 0 known vulnerabilities at the check time |
| Fresh local Git clone of the initial commit | `npm ci --offline --ignore-scripts` installed 239 packages from the prior registry cache; syntax checks passed; **55 tests passed, 0 failed/skipped**, approximately 4.40 seconds |
| Interactive OpenAPI init | PTY keyboard flow completed; getNote/createNote explicitly selected; output config passed strict validation |
| Interactive manual init | PTY keyboard flow completed; inline GET `/notes/{id}` created; output config passed strict validation; ASCII banner/ribbons displayed with TERM=xterm |

The initial dependency installation used the npm registry. The clean-clone install
used the same lockfile and a populated local package cache; it does not measure
first-install internet/download latency. The baseline MVP also passed GitHub CI on Linux with Node 22 and Node 24,
as linked above.

## Protocol and HTTP proof

The pinned **MCP Inspector 2.10.1 CLI** consumes the exact exported JSON file. Its
acceptance tests list only selected tools and call both read and write operations
for the OpenAPI and manual examples. An additional authenticated Inspector call
uses a synthetic runtime bearer credential and verifies no value in export.

The official **MCP SDK 1.32.1 Client** connects to a spawned stdio server, lists
and calls tools, tests invalid/unselected tool errors, and verifies credential
redaction. Doctor performs an actual SDK connection and listing; read probes
contact the local API, while write probes are rejected without making a request.

Mapping/error tests cover:

- Percent-encoded path values and retained base paths.
- Distinct path/query names, query booleans/integers, repeated/CSV query arrays,
  JSON request bodies, ordinary headers and case-insensitive Accept overrides.
- Customized input schemas and original mapping validation before HTTP.
- Environment-based bearer, header/query API keys; missing/empty/invalid values.
- Explicit selection, multiple sources, collisions and atomic config updates.
- Invalid JSON/YAML, duplicate keys, missing files, bad URLs, external/circular
  refs, unsupported schemas/serialization/auth/media and TRACE visibility.
- Timeout including response bodies, cancellation, network failures, HTTP
  400/401/403/404/429/500, no write retries and no redirect credential forwarding.
- Large/binary/malformed JSON responses, empty responses and secret redaction.

Tests use synthetic loopback fixtures. No cloud account or LLM key is needed.
The sandbox initially rejected local port binding with EPERM; HTTP integration
checks were rerun with local networking allowed. Blocked runs were not counted
as passes. Inspector's v2 JSON envelope required a test assertion correction;
the final tests use `result` and all client calls pass.

## Reproduce

```sh
npm ci
npm run check
npm test
npm run smoke
node src/cli.js validate --strict -c examples/openapi.config.yaml
node src/cli.js validate --strict -c examples/manual.config.yaml
node src/cli.js validate --strict -c examples/multi.config.yaml
node src/cli.js validate --strict -c examples/auth.config.yaml
```

A first-time-user study remains on the P0 backlog. Automated timing proves the
technical local flow, not that unfamiliar developers can complete all decisions
within five minutes. Inspector's browser UI and desktop AI clients were not
visually exercised; only the named Inspector CLI and official SDK client are
claimed as tested.

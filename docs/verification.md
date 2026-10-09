# Verification evidence

Verified locally on **2026-10-09**, macOS, Node **22.23.2**, npm **10.9.8**.
This is a local MVP result, not a public release or a remote CI result.

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed all source/test/example/script syntax checks |
| `npm test` on final source | **55 passed, 0 failed, 0 skipped**, approximately 3.63 seconds |
| `npm run smoke` on final source | Passed, **1.916 seconds** with dependencies already installed |
| `validate --strict` on OpenAPI/manual/multi/auth examples | All four passed, zero unsupported operations |
| `npm audit --omit=dev --json` | 0 known vulnerabilities at the check time |
| `npm audit --json` | 0 known vulnerabilities at the check time |
| Fresh local Git clone of the initial commit | `npm ci --offline --ignore-scripts` installed 239 packages from the prior registry cache; syntax checks passed; **55 tests passed, 0 failed/skipped**, approximately 4.40 seconds |
| Interactive OpenAPI init | PTY keyboard flow completed; getNote/createNote explicitly selected; output config passed strict validation |
| Interactive manual init | PTY keyboard flow completed; inline GET `/notes/{id}` created; output config passed strict validation; ASCII banner/ribbons displayed with TERM=xterm |

The initial dependency installation used the npm registry. The clean-clone install
used the same lockfile and a populated local package cache; it does not measure
first-install internet/download latency. Node 24 and Linux are configured in CI
but have not been executed remotely from this unpublished local repository.

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

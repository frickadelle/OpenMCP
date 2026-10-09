# Architecture decisions

## 1. Configuration is the source of truth

The versioned JSON/YAML configuration contains API sources, an explicit tool
allowlist and optional presentation/input-schema overrides. OpenAPI documents
remain local source files. Every process start reloads and compiles the files;
no generated server code, cached registry or cloud project can drift from them.
Restart the client connection after changing configuration.

## 2. Small Node.js runtime

Use Node 22.19+ ESM JavaScript with the built-in test runner and fetch. This avoids
a build step and allows a fresh checkout to run immediately after `npm ci`.
Ten direct runtime dependencies each own an existing concern: SDK, OpenAPI
validation, JSON Schema validation/formats, YAML, CLI parsing, prompts, the
keyboard/screen layer for the dashboard, and TOML/JSONC host-file parsing.
Inspector is a pinned development dependency, not part of the runtime dependency
set. Its larger dependency tree is accepted to test an independently shipped
client. `npm ci --omit=dev` is sufficient for serving.

The official MCP SDK **1.32.1** is the stable monolithic release available during
implementation. SDK v2's split server/client packages are not used for this MVP.
Inspector 2.10.1 negotiates the legacy protocol era with this SDK. Follow upstream
security releases and move to v2 only with compatibility tests and release notes.
No JSON-RPC framing or protocol handshake is implemented in this project.

## 3. Bounded OpenAPI normalization

Swagger Parser validates full OpenAPI documents and dereferences permitted local
references. It is prevented from resolving external references. The importer
then checks the supported subset and converts request input schemas to JSON
Schema 2020-12. Unsupported operations are visible in the catalog. Selecting one
is an error. This gives users a usable subset without pretending that unsupported
operations work.

Manual endpoints become a small synthetic OpenAPI document and pass through the
same compilation path. This prevents the two formats from acquiring different
HTTP mapping semantics. Operation ids are stable; missing ids use `METHOD /path`.
Duplicate ids and tool names fail. Path and operation parameters are merged by
location/name, with the operation taking precedence.

## 4. HTTP mapping is separate from presentation

Each compiled operation keeps its method, path, parameter mapping and original
API input validator. Tool names, descriptions and schemas are configurable.
Path, query, headers and body form separate input groups. Ajv validates both the
published schema and original mapping before fetch. Overrides can narrow the
schema but do not remove API obligations. No coercion, implicit defaults or
custom code execution occurs.

## 5. SDK owns MCP; fetch owns HTTP

The advanced SDK `Server` API exposes dynamic JSON Schemas without translating
them to function signatures or a second schema dialect. SDK handlers implement
only tool list and call behavior. The SDK owns initialization, capability checks,
transport and cancellation. `src/server.js` never writes ordinary text to stdout.

`src/http.js` constructs requests, supplies auth, enforces timeouts and response
bounds, and returns safe text/error results. No retries. Manual redirects avoid
credential forwarding. Upstream error bodies are not logged. All configured
credential values, including JSON/URL-escaped forms, are redacted from tool text
and errors. Redaction is not a data-loss-prevention system; unknown secrets in
upstream business data are outside this guarantee.

## 6. Client proof before export claims

Export targets the actual pinned Inspector CLI. Acceptance tests invoke its
launcher, consume the exact export, list tools and call both read/write examples.
Additional integration tests use the official SDK Client through spawned stdio
processes. Doctor uses that same SDK path; it only forwards named credential env
vars and never calls the API unless an explicit GET/HEAD probe is supplied.

Inspector runtime `-e` flags are necessary for arbitrary credential env values;
plain shell environment inheritance is not assumed. Export contains no values,
unsupported interpolation placeholders or machine-specific secret paths.

## Module ownership

| Module | Owns |
| --- | --- |
| `config.js` | File parsing, config schema/invariants, atomic updates |
| `schema.js` | Supported schema dialect, Ajv validators |
| `importer.js` | OpenAPI/manual normalization, catalog and selection compilation |
| `http.js` | Input validation, URL/body/header mapping, auth and response bounds |
| `server.js` | SDK tool handlers and stdio lifecycle |
| `client.js` | Export and SDK-based diagnostics |
| `hosts.js` | Known local host detection, format adapters, guarded registration and backups |
| `wizard.js`, `ui.js`, `cli.js` | Interactive configuration, terminal animation, command orchestration |

Configuration/spec files and API descriptions are trusted by the developer to
choose capabilities; upstream responses remain untrusted model content. API
permissions must be enforced by the API. No hosted service or user identity
layer is in the MVP.

## 7. Dashboard edits the existing configuration

`workbench-store.js` discovers top-level local version-1 project files, compiles
their catalogs through the existing importer, and validates edits before atomic
saves. A file-content fingerprint detects external edits before replacement.
It is a stale-edit guard, not a cross-process transactional lock.

`workbench.js` uses Terminal Kit's screen buffer and keyboard handling. A pure
frame model supports animation/layout tests. Titles/cards keep fixed positions;
selecting another source briefly builds the tool borders, then idle rendering
stops. A monotonic clock drives a 360 ms build at a target 16 ms cadence; easing
and a continuous perimeter replace large three-phase jumps. Content reveals
progressively without moving the cards. The terminal owns its default foreground/background colors. These are
view animations, not synthetic API calls or claimed live telemetry. Settings retain environment variable names
only. The dashboard does not start an API or change another client's process.

Tool definitions gain optional `enabled`, defaulting to true for compatibility.
Disabled definitions retain customization but are excluded from SDK handlers.
The CLI selection wizard shares this state; re-enabling restores names/schemas.
Clients reconnect to load updates. The existing config remains the authority;
there is no generated server, separate tool registry or UI database.

The UI owns an alternate terminal screen and restores input mode/cursor on exit.
New-project creation suspends the dashboard for the name-first wizard and then
reopens it. The wizard derives config filename/source id, preserves explicit
tool selection and makes detailed client instructions optional. Pipelines are refused for the dashboard; explicit server/export
commands preserve their stdout contract.

## 8. Host configuration is a separate local integration

`hosts.js` reuses the existing absolute stdio launch command. It registers the
whole project in each host's documented user configuration. `smol-toml` 1.9.1
validates Codex TOML; append-only tables preserve existing text/comments.
`jsonc-parser` 3.3.1 performs structural edits preserving JSONC comments. No host
file is executable code generated by Open MCP.

Existing entries with different semantics are never replaced. Parsing and
post-edit semantic comparison happen before writing. Regular-file checks reject
symlinks; private backups, private temporary files and a stale-content check
precede replacement. This guard is not a cross-process transaction. Host files
may contain existing credentials; backups preserve their bytes with mode 0600.
New credential bindings contain variable names/references only.

Installation detection, configured status and live MCP verification remain
distinct. The dashboard never restarts another host or requests an LLM response.
OpenCode's verified 1.x format is version-gated; a per-executable modification
fingerprint caches the read-only version check during the session.

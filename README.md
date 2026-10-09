# Open MCP (working title)

Turn your own HTTP APIs into explicitly selected MCP tools. Import an API, select
operations, configure environment-based auth, and let your MCP client start the
local server. No server code generation, cloud account or LLM API key.

```text
 { OpenAPI / REST }
          |
      [ import ] ==> [ choose ] ==> [ auth ] ==> [ stdio ] ==> [ client ]
          |             |             |             |
          +-------------+-------------+-------------+
                    versioned configuration
```

**Local MVP, version 0.1.0.** The package is private and unpublished. This project
is independent of the existing OpenMCP project. The working title must change
before publication; see [name research](docs/research.md). A public repository
and package have not been published by this checkout.

## Start from a fresh checkout

Requires Node.js **22.19+** and npm. Development CI targets Node 22 and 24.
Dependencies need internet access on the first install. Normal use only contacts
your configured API. No build step.

```sh
npm ci
node src/cli.js --help
npm run check
npm test
npm run smoke
```

### Five-minute local demo

In terminal A, start the included API:

```sh
npm run demo
```

In terminal B:

```sh
node src/cli.js init
```

Accept the project name. Choose **Local OpenAPI JSON / YAML file**. Accept source
id `demo`, file `examples/openapi.yaml` and base URL `http://127.0.0.1:3001`.
Choose **None / public API**. Use **Space** to select `getNote` and `createNote`,
then **Enter**. Skip customization on your first run.

```sh
node src/cli.js doctor --probe demo_getNote --args '{"path":{"id":"1"}}'
node src/cli.js export > client.local.json
```

Connect the tested MCP Inspector client and call a tool:

```sh
MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server open-mcp \
  --format json --method tools/list

MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server open-mcp \
  --format json --method tools/call --tool-name demo_getNote \
  --tool-args-json '{"path":{"id":"1"},"query":{"verbose":true}}'

MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server open-mcp \
  --format json --method tools/call --tool-name demo_createNote \
  --tool-args-json '{"body":{"title":"My first MCP note"}}'
```

Inspector 2.10.1 wraps JSON output in `{"result": ...}`. It starts `serve` as a
child process and owns that connection. You do not need a separately running MCP
process. The demo API in terminal A must keep running.

For its browser interface, omit `--cli` and the method flags. Only the CLI
interface is covered by automated acceptance tests; desktop AI clients and the
Inspector browser UI are not claimed as tested.

ASCII banners, progress ribbons and spinners run in interactive terminals on
**stderr**. They stop for CI, pipes and `serve`. Disable them with
`OPEN_MCP_NO_ANIMATION=1` or `TERM=dumb`. They never delay HTTP calls.

The five-minute target is for a supported API with a local spec and available
credentials. Automated smoke timing is recorded in [verification](docs/verification.md).
There has not yet been a first-time-user usability study.

### Ready-made examples

Skip the wizard to inspect the versioned examples:

```sh
node src/cli.js validate -c examples/openapi.config.yaml
node src/cli.js doctor -c examples/openapi.config.yaml \
  --probe notes_get --args '{"path":{"id":"1"}}'
node src/cli.js export -c examples/openapi.config.yaml > client.local.json
# Use --server notes-openapi in Inspector.
```

The fully manual example requires no OpenAPI document:

```sh
node src/cli.js validate -c examples/manual.config.yaml
node src/cli.js doctor -c examples/manual.config.yaml \
  --probe manual_get --args '{"path":{"id":"1"}}'
node src/cli.js export -c examples/manual.config.yaml > client.local.json
# Inspector: --server notes-manual --tool-name manual_create
# Arguments: {"body":{"title":"Created without OpenAPI"}}
```

The `examples/multi.config.yaml` example combines OpenAPI and manual sources.
The `examples/auth.config.yaml` example exercises bearer and header API-key auth.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Wizard for a new project; refuses to overwrite a file |
| `add` | Import another API and explicitly select its tools |
| `tools` | List every operation and whether it is selected or unsupported |
| `tools --choose` | Edit the allowlist, tool names, descriptions and input schemas |
| `tools --select api/operation,other/operation` | Replace the complete allowlist explicitly |
| `tools --select ''` | Publish no tools |
| `tools --json` | Inspect operation schemas as JSON |
| `validate` | Check documents, configuration and selected operations without auth/network |
| `validate --strict` | Also fail on unsupported unselected operations |
| `serve` | Load configuration once and run MCP over stdio |
| `doctor` | Check credentials; spawn and connect a real SDK MCP client; list tools |
| `doctor --probe tool --args '{...}'` | Also call an explicitly named GET/HEAD tool |
| `export --client inspector` | Print tested client JSON to stdout, with absolute paths |

Every command accepts `-c /path/to/config.yaml`. OpenAPI paths resolve relative
to the configuration file, independently of the MCP client's working directory.
Run `node src/cli.js <command> --help` for all flags. From an installed local
package, the equivalent executable name is `open-mcp`.

For scripts, provide every wizard value explicitly:

```sh
node src/cli.js init -c my-project.yaml --name my-project --id notes \
  --spec examples/openapi.yaml --base-url http://127.0.0.1:3001 \
  --auth none --select getNote,createNote
node src/cli.js add -c my-project.yaml --id another \
  --spec examples/openapi.yaml --base-url http://127.0.0.1:3001 \
  --auth none --select listNotes
```

Each new operation starts unselected. Adding a source preserves existing tools.
Config updates validate before an atomic replacement. Cancellation does not save
a partial wizard configuration. `tools --select` replaces the entire allowlist.

## Configuration and auth

JSON and YAML are supported. `version: 1` is required. Each source has exactly
one of `spec` (local file path) or `endpoints` (inline REST operations), plus an
explicit absolute `baseUrl` and `auth`. `tools` is the only publication allowlist.
Names must be unique across all sources; collisions fail instead of receiving
surprising automatic suffixes.

```yaml
version: 1
name: my-api
timeoutMs: 10000
sources:
  - id: private
    baseUrl: https://api.example.com/v1
    auth:
      type: bearer
      env: MY_API_TOKEN
    endpoints:
      - id: readItem
        method: GET
        path: /items/{id}
        parameters:
          - name: id
            in: path
            required: true
            schema: { type: string }
tools:
  - source: private
    operation: readItem
    name: read_item
    description: Read one item from our private API.
```

API keys use `auth: { type: apiKey, in: header, name: X-API-Key, env: MY_API_KEY }`.
Query API keys use `in: query`. Secrets only come from the named environment
variable. Literal token/value fields are rejected. URLs cannot contain userinfo,
queries or fragments. OpenAPI security requirements must match the selected
source's auth. `validate` needs no credentials; `serve` and `doctor` check them.
All configured authenticated sources currently require credentials at startup,
even if no tools are selected from that source.

Set values in the launching process, for example by your usual shell or secret
manager. No `.env` files are loaded or generated. For the **demo only**:

```sh
export DEMO_TOKEN=demo-token DEMO_API_KEY=demo-key
node src/cli.js doctor -c examples/auth.config.yaml --probe bearer_check
node src/cli.js export -c examples/auth.config.yaml > client.local.json
MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server authenticated-demo \
  -e "DEMO_TOKEN=$DEMO_TOKEN" -e "DEMO_API_KEY=$DEMO_API_KEY" \
  --format json --method tools/call --tool-name api_key_check --tool-args-json '{}'
```

Inspector does not automatically forward arbitrary shell environment variables.
The export deliberately omits `env` values and placeholders; provide runtime
`-e` overrides. Inspector's CLI flags place these values in its process
arguments. For production secrets, use a launch integration that injects them
without exposing process arguments; a native secret-manager/client integration
is on the backlog. Do not save `-e` values into client JSON. `doctor` forwards
only the configured auth variables to its SDK child process without argv values.

Edit a tool's optional `inputSchema` to narrow validation, add enums or improve
field descriptions. Preserve the `path`, `query`, `headers`, `body` structure.
Both the customized schema and the original API mapping schema are validated
before any HTTP request, so a loose override cannot bypass required API inputs.
Arguments are never coerced and schema defaults are never inserted.

## Supported boundaries

Read [the exact support matrix](docs/limits.md) before importing a large API.
The MVP supports OpenAPI **3.0.x / 3.1.x**, local non-recursive references, scalar
path/query/header parameters, form-style query arrays and JSON request bodies.
Unsupported operations remain visible with reasons and cannot be selected.
Structurally invalid documents, external/circular references and unknown config
fields fail validation. Version 3.2 is not supported yet.

HTTP requests have a configurable total timeout including body reads. There are
**no automatic retries**. Redirects are disabled. JSON/text responses are limited
to 1 MiB. Upstream HTTP failures return status and guidance without body text.
Configured credentials are redacted from returned text and error logs. Logs go
to stderr; stdout belongs to MCP when serving.

Tool selection controls exposure, not user authorization. The API token must
itself have appropriate permissions. A selected POST/PUT/PATCH/DELETE tool can
change real data; the client owns user confirmation. Imported descriptions and
response data are untrusted API content.

## Architecture and maintenance

The official `@modelcontextprotocol/sdk` implements the protocol and stdio
transport. Swagger Parser validates OpenAPI and resolves local references. Ajv
validates JSON Schemas and tool arguments. YAML, Commander and Inquirer provide
file parsing and the CLI. Node's built-in `fetch` sends requests; no HTTP service
or database sits between the client and API.

```text
 cli / wizard ----> config ----> importer ----> selected operations
                       |                              |
                       +------------------------------+
                                                      |
 MCP SDK client <== stdio ==> MCP SDK server ----> validation ----> fetch
```

See [architecture decisions](docs/architecture.md), [short comparison](docs/research.md),
[verification](docs/verification.md), [prioritized backlog](BACKLOG.md),
[contribution guide](CONTRIBUTING.md), [release steps](docs/releasing.md) and
[release notes](CHANGELOG.md). The project is MIT-licensed. No synthetic commits,
activity counters or scheduled vanity updates.

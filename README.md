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

**Local MVP, version 0.1.0.** The source repository is available at
[frickadelle/OpenMCP](https://github.com/frickadelle/OpenMCP) as public source.
The npm package remains private and unpublished. This project
is independent of the existing OpenMCP project. The working title must change
before package publication; see [name research](docs/research.md). No package
release has been made.

## Terminal dashboard

After installing dependencies, link this local checkout once:

```sh
npm link --ignore-scripts
openmcp
```

`openmcp` opens the keyboard-driven terminal dashboard. `open-mcp` remains an
alias for the same executable. Without linking, use `npm run browse` or
`node src/cli.js`. The existing commands (`init`, `serve`, `doctor`, etc.) remain
available through both names.

The left ASCII container lists projects and API sources from version-1
configuration files in the current directory. Each tool has its own ASCII box
with a right-aligned ON/OFF switch. Changing the selected MCP briefly draws the
tool borders in place, then reveals their content. Names and boxes stay fixed;
there is no sliding or idle pulsing. Opening the tools with Enter does not
restart the build. The UI uses the terminal's default background and text color.
Browsing does not call the API or claim to show live traffic. The left footer
shows the selected source position and total count. A single-source list has
no further entries; press `n` to create another project. Use Left/Tab to return
from tools to MCP navigation.

| Key | Action |
| --- | --- |
| Up/Down or `j`/`k` | Move within the focused list; stop at its first/last entry |
| Mouse wheel | Move within the list beneath the pointer (terminal mouse reporting required) |
| Click | Focus a list and select a visible entry; never toggle or call a tool |
| Enter / Right | Open the selected MCP's tools |
| Tab / Shift+Tab | Switch panes |
| Left / Esc | Return to the MCP list |
| Space | Enable/disable the selected tool and save its configuration |
| `s` | Open source settings: base URL, auth, credential variable name, timeout |
| `r` | Reload project files after external edits |
| `n` | Create another project through the wizard, then return to the dashboard |
| `?` | Explain shortcuts and the meaning of toolcalls |
| `q` / Ctrl+C | Restore the terminal and exit |

Settings have an explicit **Save** entry, visible even in short terminals. Use
Up/Down in help to scroll its explanation. Enter edits a field; Enter again accepts
its value into the form; Esc cancels an edit. Auth settings accept variable names,
never secret values. Animation preferences apply to the current session. The UI
requires an interactive terminal of at least 64 columns and 18 rows; enlarge a
smaller terminal to continue. `OPEN_MCP_NO_ANIMATION=1` disables motion.

Browse another folder or explicit projects:

```sh
openmcp --projects /path/to/my-projects
openmcp --config /path/to/project.yaml
openmcp browse --config first.yaml second.yaml
openmcp --projects examples
```

Discovery is local to the selected folder and does not recursively scan the
computer or import unrelated external MCP client configurations. The examples
command opens the versioned examples; toggling there edits those example files.

Switches persist as an optional `enabled: false` on tool definitions. Existing
entries without `enabled` remain active. Names, descriptions and custom schemas
survive disabling/re-enabling and restarts. Invalid changes fail validation
before saving. The UI detects a changed config file and asks you to reload
instead of overwriting a stale snapshot.

Reconnect a running MCP client after changing a tool switch or source setting.
The server loads its configuration at startup; the dashboard configures exposure
and does not manage another client's process or monitor live requests.

## Onboarding from the dashboard

Press `n`. The first two questions are the MCP name and whether you have an
OpenAPI YAML/JSON file. The wizard derives the config filename and API source
id automatically. Existing files stay intact; a repeated name receives a numbered
filename such as `notes-2.yaml`.

With a file, choose its path, mark the tools to expose and set authentication.
The wizard reuses a single valid API server address from the file; it asks for
an address if that choice is ambiguous or missing. Tool names and input schemas
use the imported defaults. Advanced customization stays in `tools --choose`.

Without a file, the wizard explains what is needed and offers your own API or a
local demo. For your own API, supply its address and one GET path from its
documentation. Path placeholders become required text inputs automatically.
No API requests are made during setup. Open MCP does not infer arbitrary API
endpoints from a website or invent them. Writes, query/header inputs and body
schemas remain available through `add` or a manual config.

The final summary gives the saved file and selected tool count. Client connection
instructions are optional through **Zeig mir, wie ich meinen Client verbinde**.
Choose **Zur MCP-Uebersicht** to return to the refreshed dashboard. Creating a
config does not start an API or connect a client. Outside the dashboard, use
`openmcp init`; an explicit `--config` remains available for scripts.

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

In terminal B, start with the animated explanation if you are new to MCP:

```sh
npm run tour
npm run onboard
```

The optional tour explains all five steps with moving ASCII diagrams. It creates
no files and makes no API requests. The default wizard starts with your MCP name
and the OpenAPI-file question instead of requiring the tour or showing chapters.

Enter `notes-demo` as the name. Answer **No** to the file question, then choose
**Erst ein lokales Beispiel ausprobieren**. Use **Space** to select `getNote`
and `createNote`, then **Enter**. Choose **Kein Schluessel / oeffentliche API**.
The source id is `api`; the filename is `notes-demo.yaml`. Advanced tool/schema
questions are omitted. Client instructions are optional at the final menu.

```sh
node src/cli.js doctor --config notes-demo.yaml --probe api_getNote --args '{"path":{"id":"1"}}'
node src/cli.js export --config notes-demo.yaml > client.local.json
```

Edit the selection with `node src/cli.js tools --config notes-demo.yaml --choose`.
Create another project with `node src/cli.js init`.

Connect the tested MCP Inspector client and call a tool:

```sh
MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server notes-demo \
  --format json --method tools/list

MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server notes-demo \
  --format json --method tools/call --tool-name api_getNote \
  --tool-args-json '{"path":{"id":"1"},"query":{"verbose":true}}'

MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector \
  --cli --config client.local.json --server notes-demo \
  --format json --method tools/call --tool-name api_createNote \
  --tool-args-json '{"body":{"title":"My first MCP note"}}'
```

Inspector 2.10.1 wraps JSON output in `{"result": ...}`. It starts `serve` as a
child process and owns that connection. You do not need a separately running MCP
process. The demo API in terminal A must keep running.

For its browser interface, omit `--cli` and the method flags. Only the CLI
interface is covered by automated acceptance tests; desktop AI clients and the
Inspector browser UI are not claimed as tested.

The optional tour and advanced API wizard include ASCII chapter diagrams,
animated packets and progress ribbons. Short setup spinners run in interactive terminals on **stderr**. Motion stops for CI and pipes; static tour explanations remain readable.
`serve` never emits onboarding output. Disable them with
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
| `browse` / no command | Animated terminal dashboard for projects, source settings and tool switches |
| `tour` | Explain import, tools, auth, local serving and client connection with animated ASCII diagrams |
| `init` | Guided wizard for a new project; refuses to overwrite a file |
| `add` | Import another API and explicitly select its tools |
| `tools` | List every operation and whether it is selected or unsupported |
| `tools --choose` | Edit the allowlist, tool names, descriptions and input schemas |
| `tools --select api/operation,other/operation` | Replace the complete allowlist explicitly |
| `tools --select ''` | Publish no tools; retain their definitions as disabled |
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
a partial wizard configuration. `tools --select` replaces the active allowlist and retains disabled definitions for later reactivation.

## Configuration and auth

JSON and YAML are supported. `version: 1` is required. Each source has exactly
one of `spec` (local file path) or `endpoints` (inline REST operations), plus an
explicit absolute `baseUrl` and `auth`. `tools` is the only publication allowlist; entries with `enabled: false` are excluded from serving.
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
file parsing and the CLI. Terminal Kit renders the dashboard and manages input. Node's built-in `fetch` sends requests; no HTTP service
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

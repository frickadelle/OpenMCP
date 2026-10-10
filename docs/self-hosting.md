# Self-host with your own domain

The local workflow needs no domain, hosting account or LLM key. Self-hosting is an
optional distribution path: you provide a domain and a Docker Compose server;
Open MCP prepares a portable package. Nothing is bought, published or registered
with DNS during setup.

## Prepare a package

Run `openmcp`, choose your project and press **h** (Self-host). Enter the public
domain, replace any localhost API addresses with addresses reachable from that
server, and choose a new output folder. Invalid domain/loopback inputs can be
corrected in the prompt. The existing project file remains intact.

Or script the same flow:

```sh
openmcp deploy -c notes.yaml --domain mcp.your-domain.com --output notes-hosted
# If the original API runs locally:
openmcp deploy -c notes.yaml --domain mcp.your-domain.com --output notes-hosted \
  --api-url api=https://api.your-domain.com
```

Use your actual source id instead of `api`. The API must be reachable from the
hosting server/container; localhost points to that container. Setup validates
configuration/specs but does not call or discover your API.

```text
notes-hosted/
  compose.yaml       # private app + Caddy on 80/443
  Caddyfile          # your domain and reverse proxy
  Dockerfile         # generic runtime, non-root Node
  package*.json      # runtime dependencies from lockfile
  src/               # copied application runtime
  project/
    open-mcp.yaml    # versioned API/tools + hosting URL/token variable
    spec-*.json      # portable local OpenAPI documents, when needed
  README.md          # concrete DNS, environment and client steps
```

The bundle copies only known runtime files, the selected config and its specs.
No `.env`, unrelated projects or client settings are copied. Runtime secret
values are never generated into the package. Review your own config/spec
metadata for pre-existing sensitive content before sharing it. The source
project and an existing output folder are never overwritten.

## Start on your server

1. Point your domain's A/AAAA records to the server. Allow inbound 80 and 443.
2. Transfer the package to the server and enter its directory.
3. Generate an access token in the launch environment and retain it in your
   secret manager for restarts:

   ```sh
   export OPEN_MCP_ACCESS_TOKEN="$(openssl rand -hex 32)"
   ```

4. Set the API credential variables listed by the generated README. Use your
   secret manager or hidden shell input; avoid command-line secret literals.
5. Start and check the service:

   ```sh
   docker compose up -d --build
   curl --fail https://mcp.your-domain.com/healthz
   docker compose ps
   ```

Caddy obtains and renews HTTPS certificates once DNS, ports and storage are
correct. Its certificate storage persists in named volumes. Open MCP's port 3000
is private to the Compose network. The app runs as a non-root user on a read-only
filesystem. Stop with `docker compose down`; this preserves certificate volumes.

See [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https)
and [Docker environment handling](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).
Do not paste `docker compose config` output: it expands environment values; use
`docker compose config --quiet` for validation. Docker administrators can inspect
container environments, so keep the server under trusted administration.

## Connect your clients

Copy `project/` to the client machine and keep an Open MCP checkout installed
there for the lightweight SDK stdio-to-HTTPS adapter. Set the **same access token**
in the client's environment. Client machines do not need your backend API keys.
Then select the copied project in the dashboard and press **c**, or run:

```sh
openmcp connect -c project/open-mcp.yaml --host codex
# Alternatives: --host claude-code / --host opencode
openmcp doctor -c project/open-mcp.yaml
```

Hosted registrations use `openmcp_remote_PROJECT_NAME`, separate from local
registrations. All three clients use the tested adapter, forwarding only the
access-token variable. Restart the host/session. `/healthz` checks process health;
`doctor` verifies the authenticated remote tool list. An explicit GET/HEAD doctor
probe checks API reachability. Inspector export also targets this adapter, with
its existing explicit `-e` credential-injection requirement.

The public endpoint is `https://mcp.your-domain.com/mcp`. Clients with configurable
Authorization headers can use it directly. Claude Desktop/browser connector
automation is not provided: its credential injection/OAuth path is not verified.

## Configuration and boundaries

The generated version-1 config adds:

```yaml
hosting:
  publicUrl: https://mcp.your-domain.com/mcp
  tokenEnv: OPEN_MCP_ACCESS_TOKEN
```

`serve --transport http` starts an authenticated stateless Streamable HTTP server
using the official SDK. Default bind is loopback; Compose explicitly binds the
private container interface. HTTPS is terminated by Caddy. The token is read at
startup, must contain 32–256 ASCII letters/digits/underscores/hyphens and must have
a different variable name from API credentials. Generate randomness; length alone
is not proof of entropy. Tokens never go in tool inputs, URLs or project files.

Requests enforce Host/Origin, token checks, a 1 MiB body limit and 32 concurrent
SDK requests. Unknown paths and query-string tokens are rejected. The adapter
verifies TLS and refuses redirects. Writing API requests are not retried.
Configuration/tool changes require server restart; bundled deployments are
snapshots, so regenerate a new folder and rebuild after changing the source.
Old revisions that reject `hosting` need that property removed for rollback.

This is single-operator/shared-token self-hosting. It does not implement MCP OAuth
discovery, per-user permissions, cloud provisioning, domain purchasing, DNS APIs,
remote UI management, resources/prompts, SSE resumption or horizontal session
state. Browser OAuth connectors are not claimed compatible. No unauthenticated
public-tools mode is included. The public DNS/ACME path is documented but has not
been exercised against a real owned domain.

MCP cancellation notifications across separate stateless requests are not
session-aware; aborting a connection/shutting down closes that request's SDK
instance, and API timeouts still apply. Do not assume cancellation reverses a write.

## Reproduce verification

```sh
npm run check
npm test                       # loopback HTTP/HTTPS, SDK and stdio adapter
npm run test:deployment         # Docker/Compose + isolated Caddy TLS proof
```

The Docker test validates the generated public-domain Caddyfile offline, then
substitutes localhost/internal TLS and a random loopback port. A temporary CA is
trusted only by its Node test process; certificate verification stays enabled.
It lists tools, calls one read and one write, checks unauthorized rejection,
checks the stdio adapter and confirms exactly two API requests. Containers,
volumes and the test application image are removed afterward. It does not request
public certificates, change DNS or modify the system trust store.

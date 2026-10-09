# Prior art and working-name research

Checked on **2026-10-09**. This is a short product comparison, not a comparative
benchmark or feature audit of installed competitors.

| Project | Observed approach | Decision for this MVP |
| --- | --- | --- |
| [Ogment](https://www.ogment.ai/platform/compatibility/) | MCP deployment across clients with shared governance, auth and permissions; its [GitHub listing](https://github.com/marketplace/ogment-ai-platform) describes a managed control plane and organization setup | Keep the useful import/configure/connect flow, but the local default needs no account or governance platform |
| [FastMCP](https://gofastmcp.com/integrations/openapi) | Python framework with automatic OpenAPI conversion, HTTP-client authentication and route/component customization | A strong existing option for Python applications; this product focuses on a standalone CLI and an explicit versioned allowlist, using the official Node SDK directly |
| [MCP-Generator](https://github.com/ChristopherDond/MCP-Generator) | CLI generates server code in several languages; supports filtering and preservation of customized generated handlers | Avoid generated-code ownership and regeneration complexity; load a shared configuration at runtime |
| [Existing OpenMCP](https://www.open-mcp.org/servers/creating-a-server) | Accepts an OpenAPI URL to create servers; documents a registry, remote endpoints and locally downloadable artifacts | The working name conflicts directly. Do not claim affiliation; rename before public release. Keep scope to local files and stdio |

The [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
and [MCP Inspector](https://github.com/modelcontextprotocol/inspector) own protocol
handling and client validation. The registry resolved `@modelcontextprotocol/sdk`
to **1.32.1** and Inspector to **2.10.1**. The current SDK repository documents the
new split packages; this MVP deliberately tests the published stable monolithic
SDK against Inspector's legacy era. See [architecture](architecture.md).

## npm checks

Commands used against the public registry (no packages published):

```sh
npm view @modelcontextprotocol/sdk version engines --json
npm view @modelcontextprotocol/inspector version engines --json
npm view openmcp version --json
npm view open-mcp version --json
```

| Name | Observed result | Meaning |
| --- | --- | --- |
| `openmcp` | Version `1.0.10` exists | Occupied; do not publish under this name |
| `open-mcp` | E404 with `Unpublished on 2025-02-25T15:59:32.643Z` | Prior use; E404 is not proof of availability or naming approval |
| Open MCP / OpenMCP | Existing project at open-mcp.org | Substantial identity/confusion conflict |
| `open-mcp-workbench-local` | Private local package label; availability not claimed | Placeholder only, guarded with `private: true` |

A registry check does not reserve a name or settle trademark rights. Recheck the
chosen final name, package scope, GitHub repository and registry metadata just
before release. Do not remove `private: true` until the maintainer chooses a
non-conflicting identity and the release steps are complete.

# Direct local host setup

Select a project/source and press `c`, choose a host and press Enter. Setup
registers the whole versioned project, including all selected sources/tools.
After the wizard saves, the Connect action offers the same setup. The CLI also
supports `connect --list` and `connect --host HOST_ID --config FILE`.

| Host | User configuration | New credential bindings | Actual local evidence |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/config.toml`, otherwise `~/.codex/config.toml` | `env_vars` containing names only | 0.162.0 app-server listed tools and called an authenticated GET |
| Claude Code | `~/.claude.json` (user scope); respects `CLAUDE_CONFIG_DIR` | `${NAME}` in `env` | 2.1.295 `mcp list` reported connected |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/...` | Public APIs only in direct setup | Format/adapter regression; application runtime unverified |
| OpenCode | `~/.config/opencode/opencode.json[c]`; respects `XDG_CONFIG_HOME` and `OPENCODE_CONFIG` | `{env:NAME}` in `environment` | 1.18.35 `mcp list` and headless `/mcp` reported connected |

macOS is the verified platform. Codex/Claude Code executable detection also
works on other platforms, but Windows/Linux acceptance has not been run.
If a Codex app instance uses a different profile from the shell, launch Open MCP
with that same `CODEX_HOME`. Detection does not infer arbitrary custom app
profiles or prove that the currently running app uses the chosen config file.
OpenCode 1.x requires its CLI to verify the format. Version 2.x uses a different
layout and is rejected. Unknown host types are not auto-configured.

Sources: [official Codex MCP configuration](https://developers.openai.com/codex/mcp),
[Claude Code scopes and environment expansion](https://code.claude.com/docs/en/mcp),
[Claude Desktop local server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers),
[OpenCode 1.x MCP settings](https://opencode.ai/docs/mcp-servers/).

## What Connect changes

The server name is `openmcp_PROJECT_NAME`. The command uses the current absolute
Node executable, checkout CLI and config file. Moving the checkout/config needs
setup again. A conflicting entry is left untouched; rename the project or
remove that entry yourself. Existing matching entries are idempotent.

JSON/JSONC structural edits preserve other settings and comments. Codex tables
are appended without rewriting existing text. Inline/sealed TOML layouts that
cannot safely accept a new table produce an error before any write. Duplicate
JSON keys, invalid syntax, non-object MCP sections and symlink targets are
rejected. Unknown existing settings remain intact.

Before replacing a file, setup stores the original bytes in
`FILE.openmcp-UUID.bak` with mode 0600. Restore that backup manually if needed.
An external-content change detected during setup aborts replacement. This is a
stale-edit guard, not a transactional lock across processes. Existing host files
and their backups may retain credentials already present before setup. Open MCP
never adds credential values; it adds names/references only.

## What Configured means

A file entry is present. Restart the client/session so it loads the tools. No
other host process is automatically restarted. Set private API variables in that
host's environment before launching; a desktop app may have a different
environment from your shell. Private-API Desktop setup is refused rather than
writing unverified placeholders or secret values.

In the dashboard Connect panel, `t` checks the local server with the official SDK
and lists tools. It does not probe the API or claim to inspect the selected host's
running session. Use doctor's explicit GET/HEAD probe for API reachability.

Actual Codex runtime proof used its installed app-server's experimental
`mcpServerStatus/list` and `mcpServer/tool/call` methods with an isolated temporary
home and one synthetic bearer-authenticated loopback read. No LLM request was
sent. Claude Code and OpenCode health/status proof is narrower: tool calls through
those hosts remain unverified. Desktop runtime remains unverified. Inspector
2.10.1 still supplies the pinned list/call CI gate for the MCP runtime.

Reproduce installed-CLI proof with `npm run test:hosts:installed`. It requires
Codex CLI; compatible Claude Code/OpenCode CLIs are checked when present, with
explicit SKIP output otherwise. The script uses temporary homes, a synthetic
bearer credential and a loopback fixture, and removes them on completion. It
never sends a model request. The experimental Codex app-server methods were
verified against 0.162.0 and may need updates for later versions.

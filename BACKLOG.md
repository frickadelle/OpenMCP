# Prioritized backlog

## P0 — before public release

1. **Choose a non-conflicting name and repository/package destination.** Recheck
   npm and project identity; update the package, CLI, examples and docs together.
   Done: final identity documented, owned package scope confirmed, no affiliation
   confusion, clean install and export tests still pass.
2. **Run five-minute onboarding with three first-time users.** Start from a fresh
   checkout and a supported API; measure install, wizard, auth and first call.
   Done: timings and failure points recorded; each finishes within five minutes
   after prerequisites, or release notes explain the gap.
3. **Improve secret injection for the tested client.** Evaluate a supported
   Inspector/client launch path that avoids passing values through CLI argv.
   Done: auth list/call tests work without secrets in files, logs or arguments.

## P1 — improve current MVP

4. **Finish host runtime proof and broaden deliberate support.** Delivered:
   detection/direct setup for Codex, Claude Code, public-API Claude Desktop and
   OpenCode 1.x; guarded backups and credential references; actual Codex list/call
   plus Claude Code/OpenCode connected status. Remaining: Desktop runtime and
   private credentials, actual Claude Code/OpenCode tool calls, CI coverage for
   the installed-host gate and Windows/Linux acceptance. Verify OpenCode 2.x before
   adding its different format. Detecting/configuring a host is not runtime proof.
5. **Better structural OpenAPI diagnostics.** Provide safe pointer/error summaries
   without printing request examples or secret values. Done: malformed info,
   references and path definitions identify locations in regression tests.
6. **SDK v2 migration.** Verify stable package status and transport/client support;
   preserve legacy compatibility or document a deliberate break. Done: exported
   configurations and both examples pass against the chosen protocol era.
7. **Broaden OpenAPI schema support deliberately.** Start with readOnly request
   filtering and allOf, then parameter serialization, with real API fixtures.
   Done: every new supported form has mapping/validation tests and matrix updates.

## P2 — only after the CLI remains stable

8. Local web UI over the same configuration/compiler.
9. **Broaden self-hosting proof.** Delivered: SDK HTTP, shared-token protection,
   portable Docker/Caddy/domain package, TLS adapter and isolated Docker gate.
   Remaining: real owned-domain DNS/ACME acceptance, upgrade/rollback exercises,
   client-specific remote runtime proof, per-user auth and browser OAuth support.
10. OAuth and additional import formats, each as a bounded feature with tests.

No marketplace, billing, hosted platform, user management or integration catalog
is planned. Prefer fixing onboarding and correctness before adding dependencies.

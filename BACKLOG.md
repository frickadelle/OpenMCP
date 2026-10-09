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

4. **Better structural OpenAPI diagnostics.** Provide safe pointer/error summaries
   without printing request examples or secret values. Done: malformed info,
   references and path definitions identify locations in regression tests.
5. **SDK v2 migration.** Verify stable package status and transport/client support;
   preserve legacy compatibility or document a deliberate break. Done: exported
   configurations and both examples pass against the chosen protocol era.
6. **Additional desktop client.** Pick one real client and test installation,
   list/call and credential injection end to end. Done: a client-specific export
   and reproducible evidence exist; do not label untested clients as supported.
7. **Broaden OpenAPI schema support deliberately.** Start with readOnly request
   filtering and allOf, then parameter serialization, with real API fixtures.
   Done: every new supported form has mapping/validation tests and matrix updates.

## P2 — only after the CLI remains stable

8. Local web UI over the same configuration/compiler.
9. HTTP transport with a clear authentication and process-lifecycle design.
10. OAuth and additional import formats, each as a bounded feature with tests.

No marketplace, billing, hosted platform, user management or integration catalog
is planned. Prefer fixing onboarding and correctness before adding dependencies.

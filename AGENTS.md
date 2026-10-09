# Agent maintenance

Read `CONTRIBUTING.md` before changing behavior. Select a bounded issue from
`BACKLOG.md`; complete its acceptance example before expanding scope.

The project loads versioned configuration at runtime. Preserve its explicit
allowlist and original API input validation. The official SDK owns MCP protocol
handling. HTTP calls never retry automatically. Secrets stay in environment
variables; serve stdout is protocol only.

For importer/schema changes, read `docs/limits.md` and update the support matrix
with regression proof. For client/export changes, run the actual pinned client
and update `docs/verification.md`. For architecture/dependency changes, read
`docs/architecture.md`. For publication, follow `docs/releasing.md`; the working
name conflicts and `private: true` is intentional.

Use package scripts as the check inventory. Required completion checks are
`npm run check`, `npm test` and strict validation of affected examples. Report
failed, blocked and unrun checks accurately. Keep repository text in English.

Record delivered behavior in `CHANGELOG.md`. Use synthetic fixtures. Produce
commits only for substantive changes; maintainers decide publication and merges.

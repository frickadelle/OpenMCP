# Contributing

This is an early local CLI MVP. Discuss scope in an issue before a broad feature.
Keep changes tied to user behavior; do not add commits or automation solely to
simulate project activity.

## Setup and required checks

```sh
npm ci
npm run check
npm test
```

Use Node 22.19+; CI tests Node 22 and 24. `npm test` includes local HTTP fixtures,
SDK stdio sessions, CLI configuration flows and the pinned Inspector client.
Tests bind only loopback addresses and need no external API account or LLM key.
If your sandbox blocks local ports, run them in an environment that allows
loopback fixtures. Do not reinterpret blocked integration tests as passing.

Focused checks:

```sh
node --test test/mapping.test.js test/config-import.test.js
npm run test:client
npm run test:hosts:installed # optional; installed Codex CLI required, isolated profiles
npm run test:deployment # Docker/Caddy; isolated TLS CA and loopback port
node src/cli.js validate --strict -c examples/openapi.config.yaml
node src/cli.js validate --strict -c examples/manual.config.yaml
```

All repository code, documentation, test names and internal logs use English.
Keep dependencies small. Put API mapping in `http.js`, schema rules in
`schema.js`, and source semantics in `importer.js`. Prefer one end-to-end behavior
change per PR. Add regression tests for new supported constructs, errors, auth
and side effects. Avoid tests that merely copy implementation details.

Changing the support subset requires updates to `docs/limits.md` and examples.
Changing the export target requires actual tests against the named client.
Changing dependencies requires a lockfile, a security review and clean checks.
Never commit credentials, customer specs, production responses or local client
JSON. Use synthetic local fixtures.

## Review and release

Use the issue/PR templates. PR descriptions explain the user-visible change,
verification and limits. Keep release notes honest: list only delivered behavior
and tests actually run. See [release steps](docs/releasing.md). Maintainers own
publications; neither CI nor agent instructions auto-publish or auto-merge.

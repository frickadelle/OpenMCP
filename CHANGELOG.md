# Changelog

## 0.1.0 — unreleased local MVP

- Added an interactive init/add wizard and explicit tool allowlist.
- Added local OpenAPI 3.0/3.1 JSON/YAML and manual REST endpoint sources.
- Added tool name, description and input-schema overrides; multiple API sources.
- Added environment-based bearer/header/query API-key authentication.
- Added official SDK stdio serving, input validation and HTTP parameter mapping.
- Added bounded JSON/text responses, total timeouts, cancellation, credential
  redaction, safe upstream error messages and no automatic retries/redirects.
- Added validation, SDK connection diagnostics and Inspector 2.10.1 export.
- Added local API examples, mapping/error/client tests, CI and maintenance docs.
- Added interactive ASCII banners, animated progress ribbons and spinners.

Known limits: narrow OpenAPI/schema subset, legacy MCP protocol era, stdio only,
no OAuth or UI, no desktop client proof, no human five-minute onboarding study.
Inspector runtime auth injection currently uses `-e` flags. The name conflicts
with existing projects. No public repository/package release has been made.

# Changelog

## Unreleased — simpler setup

- Start interactive setup with MCP name and an OpenAPI-file question; derive the
  filename and source id instead of asking users to name implementation details.
- Reuse a single supported API address from the spec, preserve explicit tool
  selection and omit advanced name/schema customization during first setup.
- Explain the no-file path and offer one documented GET action or the local demo.
  Derive required text inputs for path placeholders; validate file/URL/path input
  before proceeding. No endpoint discovery or API calls happen during setup.
- Replace the mandatory chapter and command wall with a short saved summary and
  optional client connection instructions. Keep advanced `add`/`tools --choose`
  and scripted init flags available.

## Unreleased — terminal dashboard

- Validate new-project filenames within the prompt, suggest an unused filename
  and append `.yaml` to bare names so the resulting config is discoverable.
- Reject existing targets and missing target folders before starting the wizard,
  allowing correction without exiting the dashboard flow.

- Added pointer-targeted mouse-wheel navigation and click selection, bounded
  keyboard navigation, source position/count and visible new-project guidance.
- Keep the wizard's final server/client instructions visible until Enter before
  returning to the refreshed dashboard.

- Replaced sliding titles/cards and idle pulsing with a brief, fixed-position
  border build only when changing the selected MCP. Startup and pane focus are
  static; idle rendering stops when the build completes.
- Use the terminal's default background and foreground instead of forcing black
  and white, preserving both light and dark terminal themes.

- Added ASCII containers for the MCP list, tool cards and source settings, with
  readable disabled names and right-aligned ON/OFF switches.
- Reserved a separate lane for the moving title to prevent heading overlap.
- Repeated Enter/Right no longer restarts an already-open tool animation.
- Kept Save visible in short settings panels and made help scrollable.

- Added `openmcp` / no-argument launch with project/source navigation, sliding
  titles, staggered tool cards and enabled-state animation.
- Added Space switches, source Settings (`s`), reload (`r`), new project (`n`),
  help (`?`) and terminal restoration on quit.
- Added optional version-1 `tools[].enabled`; disabled tools retain customization
  and are excluded from SDK listing/calls after reconnecting the client.
- Preserved the scripted CLI and protocol/export stdout behavior.
- Added stale-edit checks, settings validation and actual SDK disabled-tool proof.

## Unreleased — clearer onboarding

- Added `tour` / `npm run tour`: five narrated ASCII chapters with moving packets.
- Added `npm run onboard`, a recommended local example choice, and step explanations.
- Moved explicit tool selection before auth in the wizard.
- Added descriptive read/write choices, selected-tool reveals and concrete next commands.
- Added German onboarding copy and examples for API plans, tools, credentials and clients.
- Preserved non-interactive CLI flags and protocol-only serve stdout.
- Uploaded the tested MVP to the private GitHub repository; public/npm release remains pending.

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
with existing projects. The source repository is now public; no npm/package release has been made.

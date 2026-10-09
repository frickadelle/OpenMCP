# Release steps

There is no automatic publication. The working title conflicts with existing
OpenMCP; the package stays private until the maintainer chooses a final name.

1. Choose the final project identity, owned npm scope and public GitHub
   repository. Verify current npm metadata and similar project names. Record
   findings in `docs/research.md`. Update the executable and documentation.
2. Resolve the P0 release backlog or explicitly document deferred items. Confirm
   which clients, Node versions and protocol era are actually tested.
3. From a clean source checkout, run `npm ci`, `npm run check`, `npm test`, and
   strict validation of all example configurations. Run the README flow.
4. Review `npm audit --omit=dev` and the full development audit. Patch relevant
   vulnerabilities and rerun tests. Never use an unreviewed force update.
5. Set the version and write release notes with delivered features, evidence and
   known limitations. Keep changelog unreleased until a real release exists.
6. For npm distribution, add an explicit `files` allowlist and package metadata
   for the actual public repo, then remove `private: true` as an intentional
   reviewed change. Run `npm pack --dry-run`; inspect the file manifest and
   tarball for credentials/local files. Install the tarball into a temporary
   directory and verify the executable/examples with the exported client.
7. Commit the actual release change, tag that commit and publish to the confirmed
   destination using the maintainer's credentials. Do not invent activity or
   backdate release history. Attach the CI result and tested client versions.
8. Verify the public install path from a fresh directory and publish truthful
   release notes. If publication fails, record the failure rather than reporting
   success. A rollback means deprecating the affected release and publishing a
   corrected version; never silently replace an existing version.

This checkout is ready for review, not permission to claim a public release.

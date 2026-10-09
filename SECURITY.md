# Security reporting

Use the repository's private GitHub vulnerability reporting feature once a public
repository exists. Do not post real credentials or private API responses in public
issues. A reporting destination has not yet been established for this local MVP.

The bridge runs with the permissions of its launching process and API tokens.
Only select operations the client should be able to invoke. Tool annotations are
advisory and do not enforce authorization. Use appropriately scoped API tokens.
Credentials are read from named environment variables and are not persisted.

Security changes require regression tests for exposure, error output and request
behavior. Review runtime and development dependency audit results during release.

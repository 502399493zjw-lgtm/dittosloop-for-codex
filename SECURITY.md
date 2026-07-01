# Security Policy

## Reporting Vulnerabilities

Please report security issues through GitHub Security Advisories for this
repository when available. If advisories are not enabled, open a minimal issue
asking the maintainers to enable a private report path before sharing details.

Do not include exploit details, private keys, tokens, or user data in public
issues.

## Scope

Security reports are in scope when they affect:

- The local MCP runtime.
- The Codex plugin manifest or marketplace install flow.
- Runtime state handling.
- Reminder hooks.
- The local preview server.

This project is local-first. It should not upload loop state, secrets, or local
workspace data to a hosted Dittos Loop service.
